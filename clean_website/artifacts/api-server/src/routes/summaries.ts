import { Router } from "express";
import { db, summariesTable, materialsTable, activityTable, glossaryTermsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { ListSummariesParams, GenerateSummaryParams, GenerateSummaryBody, GetSummaryParams, DeleteSummaryParams } from "@workspace/api-zod";
import { generateSummary } from "../lib/ai";
import { rejectIfTooShort } from "../lib/validation";
import { generationRateLimiter } from "../lib/rate-limit";
import { requireTokenBalance, deductTokensForSummary } from "../lib/tokens";

const router = Router();

async function assertMaterialOwner(materialId: number, userId: number) {
  const [m] = await db.select({ id: materialsTable.id }).from(materialsTable)
    .where(and(eq(materialsTable.id, materialId), eq(materialsTable.userId, userId)));
  return !!m;
}

router.get("/materials/:id/summaries", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = ListSummariesParams.parse({ id: Number(req.params.id) });
  if (!await assertMaterialOwner(id, userId)) return res.status(404).json({ error: "Not found" });
  const summaries = await db.select().from(summariesTable)
    .where(eq(summariesTable.materialId, id))
    .orderBy(summariesTable.createdAt);
  res.json(summaries);
});

router.post("/materials/:id/summaries", generationRateLimiter, async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GenerateSummaryParams.parse({ id: Number(req.params.id) });
  const body = GenerateSummaryBody.parse(req.body);

  const [material] = await db.select().from(materialsTable)
    .where(and(eq(materialsTable.id, id), eq(materialsTable.userId, userId)));
  if (!material) return res.status(404).json({ error: "Not found" });

  if (rejectIfTooShort(res, material.extractedText, body.language === "en" ? "en" : "he")) return;

  await requireTokenBalance(userId);

  // No fallback to the title or any other metadata -- rejectIfTooShort above
  // already guarantees extractedText clears the minimum, so this is always
  // the real transcript/extracted content.
  const materialContent = material.extractedText || "";
  const glossaryTerms = material.courseId
    ? await db.select({ term: glossaryTermsTable.term, definition: glossaryTermsTable.definition })
        .from(glossaryTermsTable)
        .where(eq(glossaryTermsTable.courseId, material.courseId))
    : [];
  const result = await generateSummary({
    language: body.language as "he" | "en",
    materialContent,
    materialTitle: material.title,
    summaryType: body.summaryType,
    topic: body.topic,
    materialId: id,
    glossaryTerms,
  });
  // Standardized rate: 1 Token per 5 "standard pages" of the SOURCE material
  // being summarized (see lib/tokens.ts's deductTokensForSummary) -- not the
  // generated summary's own length.
  await deductTokensForSummary(userId, materialContent);

  const [summary] = await db.insert(summariesTable).values({
    materialId: id,
    summaryType: body.summaryType,
    language: body.language,
    content: result.content,
    keyPoints: result.keyPoints,
  }).returning();

  await db.insert(activityTable).values({
    userId,
    activityType: "summary",
    description: `Generated ${body.summaryType} summary for "${material.title}"`,
    materialTitle: material.title,
  });

  res.status(201).json(summary);
});

router.get("/summaries/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GetSummaryParams.parse({ id: Number(req.params.id) });

  const [summary] = await db.select().from(summariesTable).where(eq(summariesTable.id, id));
  if (!summary) return res.status(404).json({ error: "Not found" });

  if (!await assertMaterialOwner(summary.materialId, userId)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  res.json(summary);
});

router.delete("/summaries/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = DeleteSummaryParams.parse({ id: Number(req.params.id) });

  const [summary] = await db.select().from(summariesTable).where(eq(summariesTable.id, id));
  if (!summary) return res.status(404).json({ error: "Not found" });
  if (!await assertMaterialOwner(summary.materialId, userId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await db.delete(summariesTable).where(eq(summariesTable.id, id));
  res.status(204).end();
});

export default router;
