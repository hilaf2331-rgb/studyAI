import { Router } from "express";
import { db, materialsTable, summariesTable, flashcardDecksTable, flashcardsTable, questionSetsTable, questionsTable, activityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateSummary, generateFlashcardsAI, generateQuestionsAI } from "../lib/ai";

const router = Router();

router.post("/materials/:id/generate-all", async (req, res) => {
  const userId = req.user!.userId;
  const materialId = Number(req.params.id);
  if (isNaN(materialId)) return res.status(400).json({ error: "Invalid material id" });

  const [material] = await db.select().from(materialsTable)
    .where(and(eq(materialsTable.id, materialId), eq(materialsTable.userId, userId)));
  if (!material) return res.status(404).json({ error: "Not found" });

  const content = material.extractedText || material.title;
  const language = "he" as const;

  // חישוב דינמי: אם הטקסט קצר מאוד (פחות מ-600 תווים), נבקש פחות פריטים כדי למנוע שכפולים וחרטוטים
  const isShortText = content.length < 600;
  const targetCards = isShortText ? 6 : 15;
  const targetQuestions = isShortText ? 5 : 10;

  const [summaryResult, flashResult, questionResult] = await Promise.all([
    generateSummary({
      language,
      materialContent: content,
      materialTitle: material.title,
      summaryType: "detailed",
    }),
    generateFlashcardsAI({
      language,
      materialContent: content,
      materialTitle: material.title,
      cardCount: targetCards, // עבר לחישוב דינמי וחכם!
      cardTypes: ["definition", "qa", "formula", "concept"],
    }),
    generateQuestionsAI({
      language,
      materialContent: content,
      materialTitle: material.title,
      questionCount: targetQuestions, // עבר לחישוב דינמי וחכם!
      questionTypes: ["multiple_choice", "true_false"],
      difficulty: "mixed",
    }),
  ]);

  const [[summary], [deck], [qSet]] = await Promise.all([
    db.insert(summariesTable).values({
      materialId,
      summaryType: "detailed",
      language,
      content: summaryResult.content,
      keyPoints: summaryResult.keyPoints,
    }).returning(),

    db.insert(flashcardDecksTable).values({
      materialId,
      title: `${material.title} — כרטיסיות`,
      language,
    }).returning(),

    db.insert(questionSetsTable).values({
      materialId,
      title: `${material.title} — חידון`,
      language,
    }).returning(),
  ]);

  await Promise.all([
    flashResult.length > 0
      ? db.insert(flashcardsTable).values(
          flashResult.map(c => ({
            deckId: deck.id,
            front: c.front,
            back: c.back,
            difficulty: c.difficulty || "medium",
            cardType: c.cardType || "qa",
          }))
        )
      : Promise.resolve(),

    questionResult.length > 0
      ? db.insert(questionsTable).values(
          questionResult.map(q => ({
            setId: qSet.id,
            questionType: q.questionType || "multiple_choice",
            question: q.question,
            answer: q.answer,
            explanation: q.explanation || null,
            options: q.options || [],
            difficulty: q.difficulty || "medium",
          }))
        )
      : Promise.resolve(),

    db.insert(activityTable).values({
      userId,
      activityType: "summary",
      description: `Generated full exam kit for "${material.title}"`,
      materialTitle: material.title,
    }),
  ]);

  res.status(201).json({
    summary: { id: summary.id, keyPointCount: summaryResult.keyPoints.length },
    deck: { id: deck.id, cardCount: flashResult.length },
    questionSet: { id: qSet.id, questionCount: questionResult.length },
  });
});

export default router;