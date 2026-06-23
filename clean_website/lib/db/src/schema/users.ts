import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
