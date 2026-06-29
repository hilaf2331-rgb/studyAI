import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { estimateTokenCount } from "./chunker";
import { FREE_TIER_MAX_AUDIO_SECONDS } from "./validation";

// Every balance is stored and spent internally in raw cost-estimation units
// (the same scale estimateTokenCount produces, easily thousands per
// generation) so per-request metering stays exactly as fine-grained as
// before. RAW_UNITS_PER_TOKEN is the one conversion rate between that
// internal scale and the simple whole "Tokens" shown to users everywhere
// (Profile, Sidebar, Purchase Modal) -- 75,000 raw units per Token, chosen to
// match the existing "1 Token ~= 30 min of recording" pricing-card copy
// (150,000 raw units/hour, see routes/billing.ts, halved). Convert raw ->
// Tokens only at API read boundaries (routes/dashboard.ts); never change how
// deductCombinedTokens/estimateTokenCount work internally.
export const RAW_UNITS_PER_TOKEN = 75_000;

// Ongoing free-tier trickle once the one-time signup grant (see
// DEFAULT_MONTHLY_TOKEN_QUOTA in lib/db) is gone -- one whole Token, small
// enough to not undercut the purchase flow, but enough to keep a casual user
// engaged between top-ups. Applied by maybeApplyMonthlyRefill below.
export const FREE_TIER_MONTHLY_REFILL = RAW_UNITS_PER_TOKEN;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Render's free tier has no shell/cron access, so there's no scheduled job
// that resets balances on the 1st of the month. Instead, every read of a
// user's balance (via getTokenBalance below) opportunistically checks
// whether 30+ days have passed since their last refill and, if so, tops
// tokensRemaining up to FREE_TIER_MONTHLY_REFILL -- but only ever up, never
// down, so a user who still has more left from their welcome grant or a
// purchase keeps every token of it. Once a refill has fired once,
// monthlyTokenQuota is pinned to FREE_TIER_MONTHLY_REFILL for display, since
// the one-time welcome-grant period is over.
async function maybeApplyMonthlyRefill(userId: number): Promise<void> {
  const [user] = await db.select({
    tokensRemaining: usersTable.tokensRemaining,
    lastTokenRefillAt: usersTable.lastTokenRefillAt,
  }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return;
  if (Date.now() - user.lastTokenRefillAt.getTime() < THIRTY_DAYS_MS) return;

  await db.update(usersTable).set({
    tokensRemaining: Math.max(user.tokensRemaining, FREE_TIER_MONTHLY_REFILL),
    monthlyTokenQuota: FREE_TIER_MONTHLY_REFILL,
    lastTokenRefillAt: new Date(),
  }).where(eq(usersTable.id, userId));
}

// Admin/dev accounts that bypass token-balance checks entirely -- so testing
// large documents never burns down (or gets blocked by) the same quota a
// real user's plan is metered against. Looked up from the DB row's email
// (set at signup, not anything client-supplied), so this can't be spoofed by
// sending a different email in a request -- only an account that actually
// owns one of these addresses gets the bypass.
// EDIT THIS: replace with your real account email(s).
const ADMIN_EMAILS = new Set<string>([
  "hila@gmail.com",
  "hilaf2331@gmail.com",
]);

async function isAdminUser(userId: number): Promise<boolean> {
  const [user] = await db.select({ email: usersTable.email, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  return !!user && (user.role === "admin" || ADMIN_EMAILS.has(user.email.toLowerCase()));
}

// Thrown before a generation call when the user has no tokens left. Callers
// should check this BEFORE spending any time/money on a Gemini call, the
// same way checkCircuitBreaker() in ai.ts fails fast before chunking work.
export class InsufficientTokensError extends Error {
  constructor() {
    super("You've used up your token balance for this period. Please wait for it to reset or upgrade your plan.");
    this.name = "InsufficientTokensError";
  }
}

export async function getTokenBalance(userId: number): Promise<{ tokensRemaining: number; monthlyTokenQuota: number; tokenBalance: number } | null> {
  await maybeApplyMonthlyRefill(userId);
  const [user] = await db.select({
    tokensRemaining: usersTable.tokensRemaining,
    monthlyTokenQuota: usersTable.monthlyTokenQuota,
    tokenBalance: usersTable.tokenBalance,
  }).from(usersTable).where(eq(usersTable.id, userId));
  return user ?? null;
}

// Call right before a generation request. Throws InsufficientTokensError if
// the user has nothing left in either pool (monthly quota + purchased
// credits), so a request never starts work it can't afford. Admin accounts
// (see ADMIN_EMAILS above) always pass.
export async function requireTokenBalance(userId: number): Promise<void> {
  if (await isAdminUser(userId)) return;
  const balance = await getTokenBalance(userId);
  if (!balance || balance.tokensRemaining + balance.tokenBalance <= 0) {
    throw new InsufficientTokensError();
  }
}

// Spends `amount` from tokensRemaining (the monthly free quota) first, then
// from tokenBalance (purchased credits) for whatever's left -- so a free
// monthly refill is used up before tokens the student actually paid for.
// Floored at 0 on both pools. Returns silently (no-op) once amount is fully
// covered or the user has nothing left to spend.
async function deductCombinedTokens(userId: number, amount: number): Promise<void> {
  if (amount <= 0) return;
  const balance = await getTokenBalance(userId);
  if (!balance) return;
  const fromMonthly = Math.min(balance.tokensRemaining, amount);
  const fromPurchased = Math.min(balance.tokenBalance, amount - fromMonthly);
  await db.update(usersTable).set({
    tokensRemaining: balance.tokensRemaining - fromMonthly,
    tokenBalance: balance.tokenBalance - fromPurchased,
  }).where(eq(usersTable.id, userId));
}

// Call after a generation request succeeds, with the actual input + output
// text that was sent to / received from Gemini. Admin accounts are never
// deducted, so their balance can't be run down by repeated testing.
export async function deductTokensForGeneration(userId: number, inputText: string, outputText: string): Promise<void> {
  if (await isAdminUser(userId)) return;
  const used = estimateTokenCount(inputText) + estimateTokenCount(outputText);
  await deductCombinedTokens(userId, used);
}

// Beta-only hard cap on total processing actions (material uploads +
// recordings) per user, independent of the token budget above -- the token
// budget limits AI generation cost, this caps upload volume itself so a
// single beta tester can't create unlimited materials. One flat number for
// the whole beta period, not a daily/monthly rate.
export const MAX_BETA_ACTIONS = 10;

// Thrown before a material/recording is processed once a user has used up
// all MAX_BETA_ACTIONS. Callers should check this before any
// extraction/transcription work starts, same fail-fast pattern as
// requireTokenBalance().
export class BetaActionLimitError extends Error {
  readonly code = "BETA_LIMIT_REACHED";
  constructor() {
    super("הגעת למגבלת הבטא החינמית! תודה שעזרת לנו לבדוק את האתר 🙏");
  }
}

export async function getActionsStatus(userId: number): Promise<{ actionsUsed: number; maxBetaActions: number } | null> {
  const [user] = await db.select({ actionsUsed: usersTable.actionsUsed }).from(usersTable).where(eq(usersTable.id, userId));
  return user ? { actionsUsed: user.actionsUsed, maxBetaActions: MAX_BETA_ACTIONS } : null;
}

// Call right before a material/recording is processed. Throws
// BetaActionLimitError if the user is already at (or past) the cap, so a
// request never starts extraction/transcription work it isn't allowed to
// finish. Admin accounts (see ADMIN_EMAILS above) always pass.
export async function requireActionsRemaining(userId: number): Promise<void> {
  if (await isAdminUser(userId)) return;
  const status = await getActionsStatus(userId);
  if (!status || status.actionsUsed >= status.maxBetaActions) {
    throw new BetaActionLimitError();
  }
}

// Call once a material/recording row has actually been created, regardless
// of whether extraction/transcription itself succeeded -- the processing
// slot was spent either way. Uses an atomic SQL increment (not read-modify-
// write) so concurrent requests from the same user can't both read a stale
// count and slip past the cap.
export async function incrementActionsUsed(userId: number): Promise<void> {
  if (await isAdminUser(userId)) return;
  await db.update(usersTable)
    .set({ actionsUsed: sql`${usersTable.actionsUsed} + 1` })
    .where(eq(usersTable.id, userId));
}

// Free-plan ceiling on transcribable audio length, lifted entirely for
// admins and for anyone who has ever bought a token package (isPayingCustomer,
// set one-way by routes/billing.ts's webhook on first credited purchase) --
// returns null to mean "no cap", or the numeric cap in seconds otherwise.
export async function getFreeTierAudioCapSeconds(userId: number): Promise<number | null> {
  if (await isAdminUser(userId)) return null;
  const [user] = await db.select({ isPayingCustomer: usersTable.isPayingCustomer }).from(usersTable).where(eq(usersTable.id, userId));
  if (user?.isPayingCustomer) return null;
  return FREE_TIER_MAX_AUDIO_SECONDS;
}

// Whether this user gets priority treatment (e.g. jumping the processing
// queue ahead of free-tier jobs, see lib/processing-queue.ts) -- true for
// admins and for anyone who has ever bought a token package, same
// isPayingCustomer flag used by getFreeTierAudioCapSeconds above.
export async function isPayingCustomer(userId: number): Promise<boolean> {
  if (await isAdminUser(userId)) return true;
  const [user] = await db.select({ isPayingCustomer: usersTable.isPayingCustomer }).from(usersTable).where(eq(usersTable.id, userId));
  return user?.isPayingCustomer ?? false;
}

// Flat per-execution token cost for the advanced AI features that sit on
// top of (not instead of) the dynamic generation-cost accounting above --
// PAYG features users pay a small fixed amount for regardless of how much
// the underlying AI call ends up costing. Kept at exactly 1 whole Token each
// (RAW_UNITS_PER_TOKEN) so the UI never needs to show a fraction of a Token.
export const FEATURE_TOKEN_COSTS = {
  targetedQuestion: RAW_UNITS_PER_TOKEN,
  dailyReviewQueue: RAW_UNITS_PER_TOKEN,
} as const;

// Call right before running a PAYG-gated feature. Throws InsufficientTokensError
// if the balance can't cover the flat cost, otherwise atomically deducts it.
// Admin accounts (see isAdminUser above) always pass and are never deducted.
export async function requireAndDeductFeatureTokens(userId: number, cost: number): Promise<void> {
  if (await isAdminUser(userId)) return;
  const balance = await getTokenBalance(userId);
  if (!balance || balance.tokensRemaining + balance.tokenBalance < cost) {
    throw new InsufficientTokensError();
  }
  await deductCombinedTokens(userId, cost);
}
