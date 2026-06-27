import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// One row per credited payment-webhook event. providerTransactionId is
// unique so a gateway's at-least-once webhook retry can never double-credit
// the same payment -- routes/billing.ts treats a unique-constraint
// violation on insert as "already processed" rather than an error.
export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  packageId: text("package_id").notNull(),
  tokens: integer("tokens").notNull(),
  priceIls: integer("price_ils").notNull(),
  provider: text("provider").notNull().default("cardcom"),
  providerTransactionId: text("provider_transaction_id").notNull().unique(),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Transaction = typeof transactionsTable.$inferSelect;
