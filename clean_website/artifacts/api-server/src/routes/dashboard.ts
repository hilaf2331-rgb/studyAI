import { Router } from "express";
import { db, coursesTable, materialsTable, flashcardsTable, flashcardDecksTable, examResultsTable, activityTable, usersTable } from "@workspace/db";
import { count, avg, desc, eq, and, or, isNull, lte, asc, sql } from "drizzle-orm";
import { getTokenBalance, isPayingCustomer, requireAndDeductFeatureTokens, FEATURE_TOKEN_COSTS, RAW_UNITS_PER_TOKEN, TRANSCRIPTION_SECONDS_PER_TOKEN, SUMMARY_PAGES_PER_TOKEN } from "../lib/tokens";

// Today's Review queue is capped at this many cards across ALL of the
// user's materials -- a daily review session should feel doable in one
// sitting, not turn into "every overdue card you've ever skipped." Access
// itself is gated by tokens (FEATURE_TOKEN_COSTS.dailyReviewQueue), not tier.
const DAILY_REVIEW_CAP = 15;

// Rough estimated token cost of one generation of each kind, used only to
// turn a raw token balance into a friendly "enough for ~X" estimate on the
// frontend. Expressed directly in the granular ~0.3 Token-per-generation
// pricing model (mirrors ESTIMATED_TOKEN_COST in material-detail.tsx) and
// converted to raw units here since `total` above stays in raw units.
const ESTIMATED_TOKENS_PER_SUMMARY = Math.round(0.3 * RAW_UNITS_PER_TOKEN);
const ESTIMATED_TOKENS_PER_EXAM = Math.round(0.6 * RAW_UNITS_PER_TOKEN);

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
  const [user] = await db.select({
    lastStudyDate: usersTable.lastStudyDate,
    currentStreak: usersTable.currentStreak,
    longestStreak: usersTable.longestStreak,
  }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return res.status(404).json({ error: "Not found" });

  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const lastStudyDateStr = user.lastStudyDate ? user.lastStudyDate.toISOString().split("T")[0] : null;

  // currentStreak is only advanced lazily (on the next study action), so a
  // student who studied two days ago still has a stale nonzero value sitting
  // in the column -- decay it to 0 on read once a day has actually been
  // missed, rather than waiting for their next study session to notice.
  const isActive = lastStudyDateStr === today || lastStudyDateStr === yesterday;
  const currentStreak = isActive ? user.currentStreak : 0;

  res.json({
    currentStreak,
    longestStreak: user.longestStreak,
    lastStudyDate: lastStudyDateStr,
    todayStudied: lastStudyDateStr === today,
  });
});

router.get("/dashboard/daily-review-count", async (req, res) => {
  const userId = req.user!.userId;
  const now = new Date();

  const [{ value }] = await db.select({ value: count() })
    .from(flashcardsTable)
    .innerJoin(flashcardDecksTable, eq(flashcardsTable.deckId, flashcardDecksTable.id))
    .innerJoin(materialsTable, eq(flashcardDecksTable.materialId, materialsTable.id))
    .where(and(
      eq(materialsTable.userId, userId),
      or(isNull(flashcardsTable.nextReviewAt), lte(flashcardsTable.nextReviewAt, now))
    ));

  // Cap the reported count to what the queue can actually return, so the
  // dashboard CTA ("Review N Cards") never promises more than the
  // daily-review-cards endpoint below will hand back.
  res.json({ count: Math.min(Number(value), DAILY_REVIEW_CAP) });
});

router.get("/dashboard/daily-review-cards", async (req, res) => {
  const userId = req.user!.userId;
  await requireAndDeductFeatureTokens(userId, FEATURE_TOKEN_COSTS.dailyReviewQueue);
  const now = new Date();
  const cap = DAILY_REVIEW_CAP;

  const cards = await db.select({
    id: flashcardsTable.id,
    deckId: flashcardsTable.deckId,
    front: flashcardsTable.front,
    back: flashcardsTable.back,
    difficulty: flashcardsTable.difficulty,
    cardType: flashcardsTable.cardType,
    concept: flashcardsTable.concept,
    reviewCount: flashcardsTable.reviewCount,
    nextReviewAt: flashcardsTable.nextReviewAt,
    createdAt: flashcardsTable.createdAt,
    materialId: materialsTable.id,
    materialTitle: materialsTable.title,
  })
    .from(flashcardsTable)
    .innerJoin(flashcardDecksTable, eq(flashcardsTable.deckId, flashcardDecksTable.id))
    .innerJoin(materialsTable, eq(flashcardDecksTable.materialId, materialsTable.id))
    .where(and(
      eq(materialsTable.userId, userId),
      or(isNull(flashcardsTable.nextReviewAt), lte(flashcardsTable.nextReviewAt, now))
    ))
    // Never-reviewed cards (nextReviewAt is null) are the most overdue by
    // definition, so they sort first; the rest follow oldest-due-first.
    .orderBy(sql`${flashcardsTable.nextReviewAt} asc nulls first`, asc(flashcardsTable.id))
    .limit(cap);

  res.json({ cards });
});

router.get("/dashboard/tokens", async (req, res) => {
  const userId = req.user!.userId;
  const balance = await getTokenBalance(userId);
  if (!balance) return res.status(404).json({ error: "Not found" });

  const total = balance.tokensRemaining + balance.tokenBalance;
  // Convert raw cost-estimation units -> simplified Tokens only here, at the
  // API read boundary -- every internal check/deduction above keeps working
  // in raw units exactly as before. Rounded down to one decimal place (never
  // up) so the UI never claims a fraction of a Token the user doesn't fully
  // have -- whole-Token flooring would make a ~0.3-Token-per-generation
  // balance jump in large, confusing steps instead of draining smoothly.
  const toTokens = (raw: number) => Math.floor((raw / RAW_UNITS_PER_TOKEN) * 10) / 10;
  res.json({
    tokensRemaining: toTokens(balance.tokensRemaining),
    monthlyTokenQuota: toTokens(balance.monthlyTokenQuota),
    tokenBalance: toTokens(balance.tokenBalance),
    // Single combined figure -- tokensRemaining (free quota) + tokenBalance
    // (purchased, uncapped) -- so the frontend doesn't need to recompute it
    // and can show one accurate grand total after a purchase.
    totalTokens: toTokens(total),
    // Lets the frontend pick the right processing-queue message (plain vs.
    // upsell) without needing its own user/billing lookup.
    isPayingCustomer: await isPayingCustomer(userId),
    estimatedSummariesRemaining: Math.floor(total / ESTIMATED_TOKENS_PER_SUMMARY),
    estimatedExamsRemaining: Math.floor(total / ESTIMATED_TOKENS_PER_EXAM),
    // Standardized-rate capability estimates (see lib/tokens.ts): how far
    // the current total balance actually goes in real-world units, computed
    // directly from the same rates deductTokensForTranscription/
    // deductTokensForSummary bill against -- not a separate heuristic.
    estimatedTranscriptionMinutesRemaining: Math.floor(toTokens(total) * (TRANSCRIPTION_SECONDS_PER_TOKEN / 60)),
    estimatedSummaryPagesRemaining: Math.floor(toTokens(total) * SUMMARY_PAGES_PER_TOKEN),
  });
});

export default router;
