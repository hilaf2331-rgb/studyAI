import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { estimateTokenCount } from "./chunker";

// Thrown before a generation call when the user has no tokens left. Callers
// should check this BEFORE spending any time/money on a Gemini call, the
// same way checkCircuitBreaker() in ai.ts fails fast before chunking work.
export class InsufficientTokensError extends Error {
  constructor() {
    super("You've used up your token balance for this period. Please wait for it to reset or upgrade your plan.");
    this.name = "InsufficientTokensError";
  }
}

export async function getTokenBalance(userId: number): Promise<{ tokensRemaining: number; monthlyTokenQuota: number } | null> {
  const [user] = await db.select({
    tokensRemaining: usersTable.tokensRemaining,
    monthlyTokenQuota: usersTable.monthlyTokenQuota,
  }).from(usersTable).where(eq(usersTable.id, userId));
  return user ?? null;
}

// Call right before a generation request. Throws InsufficientTokensError if
// the user is already at (or below) zero, so a request never starts work
// it can't afford.
export async function requireTokenBalance(userId: number): Promise<void> {
  const balance = await getTokenBalance(userId);
  if (!balance || balance.tokensRemaining <= 0) {
    throw new InsufficientTokensError();
  }
}

// Call after a generation request succeeds, with the actual input + output
// text that was sent to / received from Gemini. Floored at 0 -- a user can't
// go negative, they just hit empty.
export async function deductTokensForGeneration(userId: number, inputText: string, outputText: string): Promise<void> {
  const used = estimateTokenCount(inputText) + estimateTokenCount(outputText);
  if (used <= 0) return;
  const balance = await getTokenBalance(userId);
  if (!balance) return;
  const next = Math.max(0, balance.tokensRemaining - used);
  await db.update(usersTable).set({ tokensRemaining: next }).where(eq(usersTable.id, userId));
}
