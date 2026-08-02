import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One-time welcome grant on signup, stored in raw cost-estimation units (see
// RAW_UNITS_PER_TOKEN in api-server's lib/tokens.ts) -- 150,000 raw units is
// the free-tier "2 Tokens" shown to users, under the granular pricing model
// where a single generation costs ~0.3 Tokens (good for roughly half a dozen
// generations before the much smaller ongoing FREE_TIER_MONTHLY_REFILL takes
// over) -- a hybrid model that hooks casual users without giving away
// unlimited free generation forever.
export const DEFAULT_MONTHLY_TOKEN_QUOTA = 150_000;

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  // Kept NOT NULL even for Google-only accounts (see routes/auth.ts's
  // POST /auth/google) -- rather than making this column nullable, a
  // Google-only signup gets an unguessable random hash here, which simply
  // means the plain email/password login can never match it. Avoids an
  // ALTER COLUMN in the additive-only startup migration (migrate.ts).
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  // Set once a Google sign-in (routes/auth.ts's POST /auth/google) either
  // creates this account or links it to an existing email/password one.
  // Null for accounts that have only ever used email/password.
  googleId: text("google_id").unique(),
  tokensRemaining: integer("tokens_remaining").notNull().default(DEFAULT_MONTHLY_TOKEN_QUOTA),
  // Label for whichever free-tier regime currently applies, purely for
  // display -- DEFAULT_MONTHLY_TOKEN_QUOTA until the first monthly refill
  // check fires (see lib/tokens.ts's maybeApplyMonthlyRefill), then pinned to
  // FREE_TIER_MONTHLY_REFILL forever after.
  monthlyTokenQuota: integer("monthly_token_quota").notNull().default(DEFAULT_MONTHLY_TOKEN_QUOTA),
  // Anchor for the request-time monthly-refill check in lib/tokens.ts --
  // there's no cron on Render's free tier, so each request that reads the
  // balance instead compares "now" against this column itself. Defaults to
  // signup time, so a brand-new user's first refill is ~1 month out, not
  // immediate.
  lastTokenRefillAt: timestamp("last_token_refill_at", { withTimezone: true }).notNull().defaultNow(),
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
  // Opt-out toggle for the daily reminder email (routes/cron.ts's
  // /cron/daily-reminders) -- exam-countdown / cards-due-today nudges.
  // Defaults on since it's a low-frequency, directly useful nudge, not
  // marketing; surfaced as a toggle on the profile page.
  dailyReminderEmailEnabled: boolean("daily_reminder_email_enabled").notNull().default(true),
  // Dedup marker so a cron run that fires twice in the same day (retry,
  // manual re-trigger) never double-sends -- set to the send time itself,
  // compared against a rolling 20h window rather than calendar-day, since
  // the cron has no reliable notion of the user's local "today".
  lastReminderEmailSentAt: timestamp("last_reminder_email_sent_at", { withTimezone: true }),
  // 'male' | 'female' | 'other'. Which grammatical form of address (Hebrew
  // is gendered) the app's copy uses when addressing this user. Was
  // frontend-only (lost on next login, never sent to the server) until this
  // column existed -- see routes/auth.ts's PATCH /auth/me/gender.
  gender: text("gender"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
