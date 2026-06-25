import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface UserPlan {
  role: string;
  subscriptionTier: string;
}

// Single source of truth for premium access: admins always pass regardless
// of billing state (the DB-backed override requested for testing/production
// access ahead of Stripe), otherwise it's a straight subscriptionTier check.
export function isPremium(plan: UserPlan): boolean {
  return plan.role === "admin" || plan.subscriptionTier === "premium";
}

export async function getUserPlan(userId: number): Promise<UserPlan | null> {
  const [user] = await db.select({
    role: usersTable.role,
    subscriptionTier: usersTable.subscriptionTier,
  }).from(usersTable).where(eq(usersTable.id, userId));
  return user ?? null;
}

export async function userIsPremium(userId: number): Promise<boolean> {
  const plan = await getUserPlan(userId);
  return !!plan && isPremium(plan);
}

// Thrown before a premium-only feature runs. Callers should check this
// before any generation work starts, same fail-fast pattern as
// requireTokenBalance()/requireActionsRemaining() in lib/tokens.ts.
export class PremiumRequiredError extends Error {
  readonly code = "PREMIUM_REQUIRED";
  constructor(message = "This feature is part of studyAI Premium. Upgrade to unlock it.") {
    super(message);
    this.name = "PremiumRequiredError";
  }
}

export async function requirePremium(userId: number): Promise<void> {
  if (!(await userIsPremium(userId))) {
    throw new PremiumRequiredError();
  }
}
