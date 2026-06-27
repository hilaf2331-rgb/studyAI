import { Router } from "express";
import { db, coursesTable, materialsTable, glossaryTermsTable } from "@workspace/db";
import { eq, count, and } from "drizzle-orm";
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
  const [deleted] = await db.delete(coursesTable)
    .where(and(eq(coursesTable.id, id), eq(coursesTable.userId, userId)))
    .returning({ id: coursesTable.id });
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
