import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

function toDateOnly(d: Date): string {
  return d.toISOString().split("T")[0];
}

// Call once per genuine study action (flashcard review, exam submission --
// NOT generation actions like uploading a material or generating a deck).
// Idempotent per calendar day: calling it twice on the same day is a no-op,
// so a student doing 20 flashcard reviews in one sitting only advances the
// streak once.
export async function recordStudyActivity(userId: number): Promise<void> {
  const [user] = await db.select({
    lastStudyDate: usersTable.lastStudyDate,
    currentStreak: usersTable.currentStreak,
    longestStreak: usersTable.longestStreak,
  }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return;

  const today = toDateOnly(new Date());
  const lastDay = user.lastStudyDate ? toDateOnly(user.lastStudyDate) : null;
  if (lastDay === today) return;

  const yesterday = toDateOnly(new Date(Date.now() - 86400000));
  const nextStreak = lastDay === yesterday ? user.currentStreak + 1 : 1;

  await db.update(usersTable)
    .set({
      lastStudyDate: new Date(),
      currentStreak: nextStreak,
      longestStreak: Math.max(nextStreak, user.longestStreak),
    })
    .where(eq(usersTable.id, userId));
}
