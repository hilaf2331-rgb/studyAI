import { Router } from "express";
import { db, flashcardDecksTable, flashcardsTable, materialsTable, activityTable } from "@workspace/db";
import { eq, count, and } from "drizzle-orm";
import {
  ListFlashcardDecksParams, GenerateFlashcardsParams, GenerateFlashcardsBody,
  GetFlashcardDeckParams, DeleteFlashcardDeckParams, ReviewFlashcardParams, ReviewFlashcardBody
} from "@workspace/api-zod";
import { generateFlashcardsAI } from "../lib/ai";
import { rejectIfTooShort, clampToContentLength } from "../lib/validation";
import { generationRateLimiter } from "../lib/rate-limit";
import { requireTokenBalance, deductTokensForGeneration } from "../lib/tokens";
import { recordStudyActivity } from "../lib/streaks";

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

router.post("/materials/:id/flashcard-decks", generationRateLimiter, async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GenerateFlashcardsParams.parse({ id: Number(req.params.id) });
  const body = GenerateFlashcardsBody.parse(req.body);

  const [material] = await db.select().from(materialsTable)
    .where(and(eq(materialsTable.id, id), eq(materialsTable.userId, userId)));
  if (!material) return res.status(404).json({ error: "Not found" });

  if (rejectIfTooShort(res, material.extractedText, body.language === "en" ? "en" : "he")) return;

  const cardTypes = body.cardTypes?.length ? body.cardTypes : ["qa", "definition"];
  // No fallback to the title or any other metadata -- rejectIfTooShort above
  // already guarantees extractedText clears the minimum.
  const materialContent = material.extractedText || "";
  const contentLength = materialContent.trim().length;
  const cardCount = clampToContentLength(body.cardCount || 10, contentLength, "flashcards");

  await requireTokenBalance(userId);

  const cards = await generateFlashcardsAI({
    language: body.language as "he" | "en",
    materialContent,
    materialTitle: material.title,
    cardCount,
    cardTypes,
    materialId: id,
  });
  await deductTokensForGeneration(userId, materialContent, JSON.stringify(cards));

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
        concept: c.concept || null,
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

  const difficultyMap: Record<string, string> = { again: "hard", hard: "hard", good: "medium", easy: "easy" };

  // SM-2 spaced-repetition scheduling. "result" maps onto the standard 0-5
  // recall-quality scale: again=0 (blackout), hard=3 (recalled with serious
  // difficulty), good=4 (recalled correctly), easy=5 (recalled effortlessly).
  // easeFactor is persisted as an integer x100 (250 = EF 2.50) since the
  // column type is integer; interval is whole days.
  const qualityMap: Record<string, number> = { again: 0, hard: 3, good: 4, easy: 5 };
  const q = qualityMap[body.result] ?? 4;

  const prevEf = card.easeFactor / 100;
  const nextEf = Math.max(1.3, prevEf + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  let nextInterval: number;
  if (q < 3) {
    // Failed recall: SM-2 resets repetitions to 0 and restarts the spacing
    // ladder from day 1. We don't persist a separate "repetitions" counter --
    // an interval of 1 day doubles as "no successful streak built up yet",
    // which is exactly the state a fresh card is in too.
    nextInterval = 1;
  } else if (card.interval <= 1) {
    nextInterval = 6;
  } else {
    nextInterval = Math.round(card.interval * nextEf);
  }

  const nextReviewAt = new Date(Date.now() + nextInterval * 86400000);

  const [updated] = await db.update(flashcardsTable)
    .set({
      reviewCount: card.reviewCount + 1,
      difficulty: difficultyMap[body.result] || card.difficulty,
      nextReviewAt,
      interval: nextInterval,
      easeFactor: Math.round(nextEf * 100),
    })
    .where(eq(flashcardsTable.id, id))
    .returning();

  await recordStudyActivity(userId);

  res.json(updated);
});

export default router;
