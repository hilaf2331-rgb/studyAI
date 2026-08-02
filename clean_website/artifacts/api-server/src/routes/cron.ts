import { Router, type IRouter } from "express";
import { timingSafeEqual } from "crypto";
import { db, usersTable, materialsTable, flashcardsTable, flashcardDecksTable } from "@workspace/db";
import { eq, and, or, isNull, lte, gte, count, asc } from "drizzle-orm";
import { sendDailyReminderEmail } from "../lib/email";
import { logger } from "../lib/logger";

// Public: triggered by a scheduled GitHub Actions workflow (see
// .github/workflows/daily-reminders.yml), once a day. No user JWT exists for
// a scheduler, so this is secured by a shared secret header instead -- same
// pattern as billing.ts's Zapier payment webhook, including the "unset
// secret rejects everything with 404" fail-closed default.
export const cronRouter: IRouter = Router();

// Users past due for another reminder: never emailed, or last emailed more
// than 20h ago. A rolling window rather than calendar-day, since the cron
// has no reliable notion of any individual user's local "today" and this
// only ever fires once/day anyway.
const REMINDER_COOLDOWN_MS = 20 * 60 * 60 * 1000;

// How far out an exam counts as "upcoming" for the reminder -- matches the
// urgency window Cram Mode itself is meant for (material-detail.tsx).
const UPCOMING_EXAM_WINDOW_DAYS = 3;

function isValidSharedSecret(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

cronRouter.post("/cron/daily-reminders", async (req, res) => {
  const sharedSecret = process.env.CRON_SECRET;
  if (!sharedSecret) {
    logger.warn("[cron] daily-reminders called but CRON_SECRET is unset -- rejecting");
    return res.status(404).json({ error: "Not found" });
  }

  const provided = req.headers["x-cron-secret"];
  if (!provided || typeof provided !== "string" || !isValidSharedSecret(provided, sharedSecret)) {
    logger.warn("[cron] daily-reminders called with missing/invalid X-Cron-Secret");
    return res.status(401).json({ error: "Invalid or missing X-Cron-Secret" });
  }

  const now = new Date();
  const cooldownCutoff = new Date(now.getTime() - REMINDER_COOLDOWN_MS);
  const examWindowEnd = new Date(now.getTime() + UPCOMING_EXAM_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(and(
      eq(usersTable.dailyReminderEmailEnabled, true),
      or(isNull(usersTable.lastReminderEmailSentAt), lte(usersTable.lastReminderEmailSentAt, cooldownCutoff)),
    ));

  let emailsSent = 0;
  let emailsFailed = 0;

  for (const user of candidates) {
    try {
      const [{ dueCardsCount }] = await db.select({ dueCardsCount: count() })
        .from(flashcardsTable)
        .innerJoin(flashcardDecksTable, eq(flashcardsTable.deckId, flashcardDecksTable.id))
        .innerJoin(materialsTable, eq(flashcardDecksTable.materialId, materialsTable.id))
        .where(and(
          eq(materialsTable.userId, user.id),
          or(isNull(flashcardsTable.nextReviewAt), lte(flashcardsTable.nextReviewAt, now)),
        ));

      const [upcoming] = await db.select({ title: materialsTable.title, examDate: materialsTable.examDate })
        .from(materialsTable)
        .where(and(
          eq(materialsTable.userId, user.id),
          eq(materialsTable.cramMode, true),
          gte(materialsTable.examDate, now),
          lte(materialsTable.examDate, examWindowEnd),
        ))
        .orderBy(asc(materialsTable.examDate))
        .limit(1);

      const dueCount = Number(dueCardsCount);
      const upcomingExam = upcoming?.examDate
        ? { materialTitle: upcoming.title, daysLeft: Math.max(0, Math.ceil((upcoming.examDate.getTime() - now.getTime()) / 86_400_000)) }
        : null;

      // Nothing worth a nudge -- skip silently, don't burn the cooldown.
      if (dueCount === 0 && !upcomingExam) continue;

      await sendDailyReminderEmail({ to: user.email, name: user.name, dueCardsCount: dueCount, upcomingExam });
      await db.update(usersTable).set({ lastReminderEmailSentAt: now }).where(eq(usersTable.id, user.id));
      emailsSent++;
    } catch (err) {
      emailsFailed++;
      logger.error({ err, userId: user.id }, "[cron] daily reminder failed for user");
    }
  }

  return res.json({ usersChecked: candidates.length, emailsSent, emailsFailed });
});
