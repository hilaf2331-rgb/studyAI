import { Router } from "express";
import { db, coursesTable, materialsTable, flashcardsTable, examResultsTable, activityTable } from "@workspace/db";
import { count, avg, desc, eq, and } from "drizzle-orm";
import { getTokenBalance } from "../lib/tokens";

// Rough estimated token cost of one generation of each kind, used only to
// turn a raw token balance into a friendly "enough for ~X" estimate on the
// frontend. Based on a typical chunk-sized material (well under
// CHUNK_TRIGGER_CHAR_LENGTH) going through ai.ts's prompt + response.
const ESTIMATED_TOKENS_PER_SUMMARY = 3000;
const ESTIMATED_TOKENS_PER_EXAM = 6000;

const router = Router();

router.get("/dashboard/stats", async (req, res) => {
  const userId = req.user!.userId;

  const [{ totalMaterials }] = await db.select({ totalMaterials: count() }).from(materialsTable).where(eq(materialsTable.userId, userId));
  const [{ totalCourses }] = await db.select({ totalCourses: count() }).from(coursesTable).where(eq(coursesTable.userId, userId));

  const userMaterialIds = await db.select({ id: materialsTable.id }).from(materialsTable).where(eq(materialsTable.userId, userId));
  const totalFlashcards = userMaterialIds.length;

  const [{ totalExamsTaken }] = await db.select({ totalExamsTaken: count() }).from(examResultsTable)
    .innerJoin(activityTable, and(eq(activityTable.userId, userId), eq(activityTable.activityType, "exam")));

  const avgResult = await db.select({ avg: avg(examResultsTable.score) }).from(examResultsTable)
    .innerJoin(activityTable, and(eq(activityTable.userId, userId), eq(activityTable.activityType, "exam")));

  const averageScore = Number(avgResult[0]?.avg || 0);
  const examReadinessScore = totalExamsTaken > 0 ? Math.min(100, Math.round(averageScore)) : 0;

  res.json({
    totalMaterials: Number(totalMaterials),
    totalCourses: Number(totalCourses),
    totalFlashcards: Number(totalFlashcards),
    totalExamsTaken: Number(totalExamsTaken),
    averageScore: Math.round(averageScore),
    studyMinutesThisWeek: Number(totalExamsTaken) * 15,
    examReadinessScore,
    masteredFlashcards: 0,
  });
});

router.get("/dashboard/recent-activity", async (req, res) => {
  const userId = req.user!.userId;
  const activity = await db.select().from(activityTable)
    .where(eq(activityTable.userId, userId))
    .orderBy(desc(activityTable.createdAt))
    .limit(20);
  res.json(activity);
});

router.get("/dashboard/study-streak", async (req, res) => {
  const userId = req.user!.userId;
  const recent = await db.select().from(activityTable)
    .where(eq(activityTable.userId, userId))
    .orderBy(desc(activityTable.createdAt))
    .limit(1);
  const lastStudyDate = recent[0]?.createdAt?.toISOString().split("T")[0] || null;
  const today = new Date().toISOString().split("T")[0];
  res.json({
    currentStreak: lastStudyDate ? 1 : 0,
    longestStreak: 1,
    lastStudyDate,
    todayStudied: lastStudyDate === today,
  });
});

router.get("/dashboard/tokens", async (req, res) => {
  const userId = req.user!.userId;
  const balance = await getTokenBalance(userId);
  if (!balance) return res.status(404).json({ error: "Not found" });

  res.json({
    tokensRemaining: balance.tokensRemaining,
    monthlyTokenQuota: balance.monthlyTokenQuota,
    estimatedSummariesRemaining: Math.floor(balance.tokensRemaining / ESTIMATED_TOKENS_PER_SUMMARY),
    estimatedExamsRemaining: Math.floor(balance.tokensRemaining / ESTIMATED_TOKENS_PER_EXAM),
  });
});

export default router;
