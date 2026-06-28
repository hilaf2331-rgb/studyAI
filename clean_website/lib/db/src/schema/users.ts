import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Free monthly allotment for every user. Sized generously against the
// chunker's CHUNK_TOKEN_LIMIT (22000) so a normal month of summaries/exams
// doesn't run dry, while still being a finite, trackable budget.
export const DEFAULT_MONTHLY_TOKEN_QUOTA = 200_000;

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  tokensRemaining: integer("tokens_remaining").notNull().default(DEFAULT_MONTHLY_TOKEN_QUOTA),
  monthlyTokenQuota: integer("monthly_token_quota").notNull().default(DEFAULT_MONTHLY_TOKEN_QUOTA),
  // Beta-only hard cap on total processing actions (material uploads +
  // recordings) -- separate from the token budget above, which limits AI
  // generation cost. This caps upload volume itself so one user can't
  // create unlimited materials while the app is in free beta.
  actionsUsed: integer("actions_used").notNull().default(0),
  // Real engagement streak, advanced by recordStudyActivity() whenever the
  // user reviews a flashcard or submits a quiz/exam -- not derived from
  // activityTable on read, since that would conflate generation actions
  // (uploading a material, generating flashcards) with actual studying.
  lastStudyDate: timestamp("last_study_date", { withTimezone: true }),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  // 'user' | 'admin'. Admins bypass premium gating entirely (see
  // lib/subscription.ts's isPremium()) -- the durable, DB-backed override
  // for testing/production access, separate from the legacy ADMIN_EMAILS
  // allowlist in lib/tokens.ts.
  role: text("role").notNull().default("user"),
  // 'free' | 'premium'. Drives access to gated features (e.g. the targeted
  // rescue-question endpoint, full-size daily review queue) ahead of the
  // Stripe billing integration that will eventually set this.
  subscriptionTier: text("subscription_tier").notNull().default("free"),
  // Set true the first time a payment-webhook credit lands for this user
  // (see routes/billing.ts) and never reset back to false -- a one-way flag
  // that lifts the free tier's 20-minute audio-transcription cap
  // (lib/tokens.ts's getFreeTierAudioCapSeconds) for anyone who has ever
  // bought a token package, independent of their current token balance.
  isPayingCustomer: boolean("is_paying_customer").notNull().default(false),
  // The display name the student uses in their Bit/PayBox app -- set by the
  // purchase flow (POST /billing/bit-name) before they're shown the payment
  // instructions, so the Zapier webhook (routes/billing.ts) can match an
  // incoming `{ bitName, amount }` payment back to this account.
  bitName: text("bit_name"),
  // Purchased token credits, separate from tokensRemaining (the monthly free
  // quota). Spent only after tokensRemaining is exhausted -- see
  // lib/tokens.ts's combined-balance deduction helpers -- so a free monthly
  // refill never "absorbs" tokens the student actually paid for.
  tokenBalance: integer("token_balance").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
