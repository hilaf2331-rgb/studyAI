import { Router } from "express";
import { db, coursesTable, materialsTable, glossaryTermsTable, courseAssetsTable, questionSetsTable, questionsTable, examsTable } from "@workspace/db";
import { eq, count, and, inArray } from "drizzle-orm";
import { deleteCourseAudio } from "../lib/storage";
import {
  CreateCourseBody, UpdateCourseBody, GetCourseParams, UpdateCourseParams, DeleteCourseParams,
  ListGlossaryTermsParams, CreateGlossaryTermParams, CreateGlossaryTermBody,
  UpdateGlossaryTermParams, UpdateGlossaryTermBody, DeleteGlossaryTermParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/courses", async (req, res) => {
  const userId = req.user!.userId;
  const courses = await db.select().from(coursesTable)
    .where(eq(coursesTable.userId, userId))
    .orderBy(coursesTable.createdAt);

  const withCounts = await Promise.all(
    courses.map(async (c) => {
      const [{ value }] = await db.select({ value: count() }).from(materialsTable)
        .where(and(eq(materialsTable.courseId, c.id), eq(materialsTable.userId, userId)));
      return { ...c, materialCount: Number(value) };
    })
  );
  res.json(withCounts);
});

router.post("/courses", async (req, res) => {
  const userId = req.user!.userId;
  const body = CreateCourseBody.parse(req.body);
  const [course] = await db.insert(coursesTable).values({ ...body, userId }).returning();
  res.status(201).json({ ...course, materialCount: 0 });
});

router.get("/courses/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GetCourseParams.parse({ id: Number(req.params.id) });
  const [course] = await db.select().from(coursesTable)
    .where(and(eq(coursesTable.id, id), eq(coursesTable.userId, userId)));
  if (!course) return res.status(404).json({ error: "Not found" });
  const [{ value }] = await db.select({ value: count() }).from(materialsTable)
    .where(and(eq(materialsTable.courseId, id), eq(materialsTable.userId, userId)));
  res.json({ ...course, materialCount: Number(value) });
});

router.patch("/courses/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = UpdateCourseParams.parse({ id: Number(req.params.id) });
  const body = UpdateCourseBody.parse(req.body);
  const [course] = await db.update(coursesTable).set(body)
    .where(and(eq(coursesTable.id, id), eq(coursesTable.userId, userId)))
    .returning();
  if (!course) return res.status(404).json({ error: "Not found" });
  const [{ value }] = await db.select({ value: count() }).from(materialsTable)
    .where(and(eq(materialsTable.courseId, id), eq(materialsTable.userId, userId)));
  res.json({ ...course, materialCount: Number(value) });
});

router.delete("/courses/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = DeleteCourseParams.parse({ id: Number(req.params.id) });

  // Storage objects are cleaned up BEFORE the course row is deleted -- the
  // DB-level cascade on course_assets.course_id only removes the rows, it
  // has no way to also delete the corresponding bucket objects, so that has
  // to happen here at the application layer or the bucket accumulates
  // orphaned (still-billed) audio files.
  const orphanedAssets = await db.select({ storagePath: courseAssetsTable.storagePath }).from(courseAssetsTable)
    .where(and(eq(courseAssetsTable.courseId, id), eq(courseAssetsTable.userId, userId)));

  const [deleted] = await db.delete(coursesTable)
    .where(and(eq(coursesTable.id, id), eq(coursesTable.userId, userId)))
    .returning({ id: coursesTable.id });
  if (!deleted) return res.status(404).json({ error: "Not found" });

  await Promise.all(orphanedAssets.map((a) => deleteCourseAudio(a.storagePath)));
  res.status(204).end();
});

router.get("/courses/:id/exam-questions", async (req, res) => {
  const userId = req.user!.userId;
  const courseId = Number(req.params.id);
  if (!Number.isInteger(courseId) || courseId <= 0) return res.status(400).json({ error: "Invalid id" });

  const [course] = await db.select({ id: coursesTable.id }).from(coursesTable)
    .where(and(eq(coursesTable.id, courseId), eq(coursesTable.userId, userId)));
  if (!course) return res.status(404).json({ error: "Not found" });

  const materials = await db.select({ id: materialsTable.id }).from(materialsTable)
    .where(and(eq(materialsTable.courseId, courseId), eq(materialsTable.userId, userId)));

  if (!materials.length) return res.json([]);

  const materialIds = materials.map(m => m.id);

  // Collect questions from question sets
  const sets = await db.select({ id: questionSetsTable.id }).from(questionSetsTable)
    .where(inArray(questionSetsTable.materialId, materialIds));

  const setIds = sets.map(s => s.id);
  const fromSets = setIds.length > 0
    ? await db.select().from(questionsTable).where(inArray(questionsTable.setId, setIds))
    : [];

  // Collect questions from exams
  const exams = await db.select({ id: examsTable.id }).from(examsTable)
    .where(inArray(examsTable.materialId, materialIds));

  const examIds = exams.map(e => e.id);
  const fromExams = examIds.length > 0
    ? await db.select().from(questionsTable).where(inArray(questionsTable.examId, examIds))
    : [];

  // Deduplicate by question text (case-insensitive), then shuffle
  const seen = new Set<string>();
  const all = [...fromSets, ...fromExams].filter(q => {
    const key = q.question.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Fisher-Yates shuffle
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }

  res.json(all);
});

// Ownership of the parent course is checked on every glossary route below
// (not just a glossaryTermsTable.id lookup) since glossary terms have no
// userId column of their own -- the course is the only link back to the
// owning user.
async function getOwnedCourseId(courseId: number, userId: number): Promise<number | null> {
  const [course] = await db.select({ id: coursesTable.id }).from(coursesTable)
    .where(and(eq(coursesTable.id, courseId), eq(coursesTable.userId, userId)));
  return course ? course.id : null;
}

router.get("/courses/:id/glossary", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = ListGlossaryTermsParams.parse({ id: Number(req.params.id) });
  if (!(await getOwnedCourseId(id, userId))) return res.status(404).json({ error: "Not found" });
  const terms = await db.select().from(glossaryTermsTable)
    .where(eq(glossaryTermsTable.courseId, id))
    .orderBy(glossaryTermsTable.createdAt);
  res.json(terms);
});

router.post("/courses/:id/glossary", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = CreateGlossaryTermParams.parse({ id: Number(req.params.id) });
  if (!(await getOwnedCourseId(id, userId))) return res.status(404).json({ error: "Not found" });
  const body = CreateGlossaryTermBody.parse(req.body);
  const [term] = await db.insert(glossaryTermsTable).values({ ...body, courseId: id }).returning();
  res.status(201).json(term);
});

router.patch("/courses/:id/glossary/:termId", async (req, res) => {
  const userId = req.user!.userId;
  const { id, termId } = UpdateGlossaryTermParams.parse({ id: Number(req.params.id), termId: Number(req.params.termId) });
  if (!(await getOwnedCourseId(id, userId))) return res.status(404).json({ error: "Not found" });
  const body = UpdateGlossaryTermBody.parse(req.body);
  const [term] = await db.update(glossaryTermsTable).set(body)
    .where(and(eq(glossaryTermsTable.id, termId), eq(glossaryTermsTable.courseId, id)))
    .returning();
  if (!term) return res.status(404).json({ error: "Not found" });
  res.json(term);
});

router.delete("/courses/:id/glossary/:termId", async (req, res) => {
  const userId = req.user!.userId;
  const { id, termId } = DeleteGlossaryTermParams.parse({ id: Number(req.params.id), termId: Number(req.params.termId) });
  if (!(await getOwnedCourseId(id, userId))) return res.status(404).json({ error: "Not found" });
  const [deleted] = await db.delete(glossaryTermsTable)
    .where(and(eq(glossaryTermsTable.id, termId), eq(glossaryTermsTable.courseId, id)))
    .returning({ id: glossaryTermsTable.id });
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
