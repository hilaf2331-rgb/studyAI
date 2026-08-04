import { Router } from "express";
import {
  db, marathonsTable, marathonMaterialsTable, materialsTable,
  summariesTable, flashcardDecksTable, questionSetsTable,
} from "@workspace/db";
import { eq, and, inArray, asc, desc } from "drizzle-orm";
import { CreateMarathonBody, GetMarathonParams, UpdateMarathonMaterialParams, UpdateMarathonMaterialBody } from "@workspace/api-zod";

const router = Router();

async function serializeMarathon(marathonId: number, userId: number) {
  const [marathon] = await db.select().from(marathonsTable)
    .where(and(eq(marathonsTable.id, marathonId), eq(marathonsTable.userId, userId)));
  if (!marathon) return null;

  const materials = await db.select({
    materialId: marathonMaterialsTable.materialId,
    title: materialsTable.title,
    position: marathonMaterialsTable.position,
    status: marathonMaterialsTable.status,
  })
    .from(marathonMaterialsTable)
    .innerJoin(materialsTable, eq(marathonMaterialsTable.materialId, materialsTable.id))
    .where(eq(marathonMaterialsTable.marathonId, marathonId))
    .orderBy(asc(marathonMaterialsTable.position));

  return { ...marathon, materials };
}

router.get("/marathon", async (req, res) => {
  const userId = req.user!.userId;
  const rows = await db.select().from(marathonsTable)
    .where(eq(marathonsTable.userId, userId))
    .orderBy(desc(marathonsTable.createdAt));
  res.json(rows);
});

// Marathon Mode only ever runs across materials that already have a full
// kit (summary + flashcards + quiz) -- generating one from scratch is a
// multi-minute, multi-Gemini-call pipeline (see generate-all.ts) that has no
// place inside "start studying right now" bookkeeping. A material still
// missing content isn't eligible; the frontend upload flow (?autogen=1)
// already produces a full kit automatically, so by the time a student picks
// materials for a marathon they're normally all ready already.
router.post("/marathon", async (req, res) => {
  const userId = req.user!.userId;
  const body = CreateMarathonBody.parse(req.body);

  const materials = await db.select().from(materialsTable)
    .where(and(inArray(materialsTable.id, body.materialIds), eq(materialsTable.userId, userId)));
  if (materials.length !== body.materialIds.length) {
    return res.status(404).json({ error: "Not found" });
  }

  const [summaryRows, deckRows, qsetRows] = await Promise.all([
    db.select({ materialId: summariesTable.materialId }).from(summariesTable).where(inArray(summariesTable.materialId, body.materialIds)),
    db.select({ materialId: flashcardDecksTable.materialId }).from(flashcardDecksTable).where(inArray(flashcardDecksTable.materialId, body.materialIds)),
    db.select({ materialId: questionSetsTable.materialId }).from(questionSetsTable).where(inArray(questionSetsTable.materialId, body.materialIds)),
  ]);
  const hasSummary = new Set(summaryRows.map(r => r.materialId));
  const hasDeck = new Set(deckRows.map(r => r.materialId));
  const hasQSet = new Set(qsetRows.map(r => r.materialId));
  const notReady = materials.filter(m => !hasSummary.has(m.id) || !hasDeck.has(m.id) || !hasQSet.has(m.id)).map(m => m.id);
  if (notReady.length > 0) {
    return res.status(400).json({
      error: "materials_not_ready",
      message: "חלק מהחומרים שנבחרו עדיין לא מוכנים (חסר סיכום/כרטיסיות/חידון).",
      materialIds: notReady,
    });
  }

  const [marathon] = await db.insert(marathonsTable).values({
    userId,
    examDate: body.examDate,
    status: "active",
  }).returning();

  await db.insert(marathonMaterialsTable).values(
    body.materialIds.map((materialId, position) => ({ marathonId: marathon.id, materialId, position, status: "pending" as const }))
  );

  // Piggybacks on Cram Mode's existing hour-scale flashcard scheduling (see
  // flashcards.ts's /review route) and exam-reminder email (cron.ts) for
  // every material now in the marathon, instead of duplicating that logic.
  await db.update(materialsTable)
    .set({ cramMode: true, examDate: body.examDate })
    .where(and(inArray(materialsTable.id, body.materialIds), eq(materialsTable.userId, userId)));

  res.status(201).json(await serializeMarathon(marathon.id, userId));
});

router.get("/marathon/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GetMarathonParams.parse({ id: Number(req.params.id) });
  const result = await serializeMarathon(id, userId);
  if (!result) return res.status(404).json({ error: "Not found" });
  res.json(result);
});

router.patch("/marathon/:id/materials/:materialId", async (req, res) => {
  const userId = req.user!.userId;
  const { id, materialId } = UpdateMarathonMaterialParams.parse({ id: Number(req.params.id), materialId: Number(req.params.materialId) });
  const body = UpdateMarathonMaterialBody.parse(req.body);

  const [marathon] = await db.select().from(marathonsTable)
    .where(and(eq(marathonsTable.id, id), eq(marathonsTable.userId, userId)));
  if (!marathon) return res.status(404).json({ error: "Not found" });

  const [updated] = await db.update(marathonMaterialsTable)
    .set({ status: body.status })
    .where(and(eq(marathonMaterialsTable.marathonId, id), eq(marathonMaterialsTable.materialId, materialId)))
    .returning({ id: marathonMaterialsTable.id });
  if (!updated) return res.status(404).json({ error: "Not found" });

  const rows = await db.select({ status: marathonMaterialsTable.status }).from(marathonMaterialsTable)
    .where(eq(marathonMaterialsTable.marathonId, id));
  if (rows.length > 0 && rows.every(r => r.status === "completed") && marathon.status !== "completed") {
    await db.update(marathonsTable).set({ status: "completed" }).where(eq(marathonsTable.id, id));
  }

  res.json(await serializeMarathon(id, userId));
});

export default router;
