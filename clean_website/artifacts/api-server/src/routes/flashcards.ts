import { Router } from "express";
import { db, flashcardDecksTable, flashcardsTable, materialsTable, activityTable } from "@workspace/db";
import { eq, count, and } from "drizzle-orm";
import {
  ListFlashcardDecksParams, GenerateFlashcardsParams, GenerateFlashcardsBody,
  GetFlashcardDeckParams, DeleteFlashcardDeckParams, ReviewFlashcardParams, ReviewFlashcardBody
} from "@workspace/api-zod";
import { generateFlashcardsAI } from "../lib/ai";

const router = Router();

async function assertMaterialOwner(materialId: number, userId: number) {
  const [m] = await db.select({ id: materialsTable.id }).from(materialsTable)
    .where(and(eq(materialsTable.id, materialId), eq(materialsTable.userId, userId)));
  return !!m;
}

async function getDeckWithCards(deckId: number) {
  const [deck] = await db.select().from(flashcardDecksTable).where(eq(flashcardDecksTable.id, deckId));
  if (!deck) return null;
  const cards = await db.select().from(flashcardsTable).where(eq(flashcardsTable.deckId, deckId));
  const mastered = cards.filter(c => c.reviewCount > 3 && c.difficulty === "easy").length;
  return { ...deck, cardCount: cards.length, masteredCount: mastered, cards };
}

router.get("/materials/:id/flashcard-decks", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = ListFlashcardDecksParams.parse({ id: Number(req.params.id) });
  if (!await assertMaterialOwner(id, userId)) return res.status(404).json({ error: "Not found" });
  const decks = await db.select().from(flashcardDecksTable).where(eq(flashcardDecksTable.materialId, id));
  const withCards = await Promise.all(decks.map(d => getDeckWithCards(d.id)));
  res.json(withCards.filter(Boolean));
});

router.post("/materials/:id/flashcard-decks", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GenerateFlashcardsParams.parse({ id: Number(req.params.id) });
  const body = GenerateFlashcardsBody.parse(req.body);

  const [material] = await db.select().from(materialsTable)
    .where(and(eq(materialsTable.id, id), eq(materialsTable.userId, userId)));
  if (!material) return res.status(404).json({ error: "Not found" });

  const cardTypes = body.cardTypes?.length ? body.cardTypes : ["qa", "definition"];
  const cardCount = body.cardCount || 10;

  const cards = await generateFlashcardsAI({
    language: body.language as "he" | "en",
    materialContent: material.extractedText || material.title,
    materialTitle: material.title,
    cardCount,
    cardTypes,
  });

  const [deck] = await db.insert(flashcardDecksTable).values({
    materialId: id,
    title: `${material.title} - Flashcards`,
    language: body.language,
  }).returning();

  if (cards.length > 0) {
    await db.insert(flashcardsTable).values(
      cards.map(c => ({
        deckId: deck.id,
        front: c.front,
        back: c.back,
        difficulty: c.difficulty || "medium",
        cardType: c.cardType || "qa",
      }))
    );
  }

  await db.insert(activityTable).values({
    userId,
    activityType: "flashcards",
    description: `Generated ${cards.length} flashcards for "${material.title}"`,
    materialTitle: material.title,
  });

  res.status(201).json(await getDeckWithCards(deck.id));
});

router.get("/flashcard-decks/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GetFlashcardDeckParams.parse({ id: Number(req.params.id) });
  const deck = await getDeckWithCards(id);
  if (!deck) return res.status(404).json({ error: "Not found" });
  if (!await assertMaterialOwner(deck.materialId, userId)) return res.status(403).json({ error: "Forbidden" });
  res.json(deck);
});

router.delete("/flashcard-decks/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = DeleteFlashcardDeckParams.parse({ id: Number(req.params.id) });
  const [deck] = await db.select().from(flashcardDecksTable).where(eq(flashcardDecksTable.id, id));
  if (!deck) return res.status(404).json({ error: "Not found" });
  if (!await assertMaterialOwner(deck.materialId, userId)) return res.status(403).json({ error: "Forbidden" });
  await db.delete(flashcardDecksTable).where(eq(flashcardDecksTable.id, id));
  res.status(204).end();
});

router.post("/flashcards/:id/review", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = ReviewFlashcardParams.parse({ id: Number(req.params.id) });
  const body = ReviewFlashcardBody.parse(req.body);

  const [card] = await db.select().from(flashcardsTable).where(eq(flashcardsTable.id, id));
  if (!card) return res.status(404).json({ error: "Not found" });

  const [deck] = await db.select().from(flashcardDecksTable).where(eq(flashcardDecksTable.id, card.deckId));
  if (!deck || !await assertMaterialOwner(deck.materialId, userId)) return res.status(403).json({ error: "Forbidden" });

  const intervalMap: Record<string, number> = { again: 1, hard: 3, good: 7, easy: 14 };
  const difficultyMap: Record<string, string> = { again: "hard", hard: "hard", good: "medium", easy: "easy" };
  const nextReviewAt = new Date(Date.now() + (intervalMap[body.result] || 7) * 86400000);

  const [updated] = await db.update(flashcardsTable)
    .set({ reviewCount: card.reviewCount + 1, difficulty: difficultyMap[body.result] || card.difficulty, nextReviewAt })
    .where(eq(flashcardsTable.id, id))
    .returning();

  res.json(updated);
});

export default router;
