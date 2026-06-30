import { Router, type IRouter } from "express";
import { db, materialsTable, summariesTable, flashcardDecksTable, flashcardsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { GetSharedMaterialParams } from "@workspace/api-zod";

// Public, unauthenticated router -- mounted in app.ts before requireAuth,
// same pattern as billingPublicRouter. Every row read here is scoped by
// shareId (an unguessable token), never by the caller's identity, since
// there isn't one.
export const sharedPublicRouter: IRouter = Router();

sharedPublicRouter.get("/shared/:shareId", async (req, res) => {
  const { shareId } = GetSharedMaterialParams.parse({ shareId: req.params.shareId });

  const [material] = await db.select().from(materialsTable).where(eq(materialsTable.shareId, shareId));
  if (!material) return res.status(404).json({ error: "Not found" });

  // Most recently generated summary stands in for "the" summary -- same
  // latest-wins choice a guest skimming the deck would expect, rather than
  // surfacing every regenerated version.
  const [summary] = await db.select().from(summariesTable)
    .where(eq(summariesTable.materialId, material.id))
    .orderBy(desc(summariesTable.createdAt))
    .limit(1);

  const [deck] = await db.select().from(flashcardDecksTable)
    .where(eq(flashcardDecksTable.materialId, material.id))
    .orderBy(desc(flashcardDecksTable.createdAt))
    .limit(1);
  const cards = deck
    ? await db.select().from(flashcardsTable).where(eq(flashcardsTable.deckId, deck.id))
    : [];

  res.json({
    title: material.title,
    language: material.language,
    summary: summary ? { content: summary.content, keyPoints: summary.keyPoints } : null,
    flashcards: cards.map(c => ({
      id: c.id,
      front: c.front,
      back: c.back,
      cardType: c.cardType,
      concept: c.concept,
    })),
  });
});

export default sharedPublicRouter;
