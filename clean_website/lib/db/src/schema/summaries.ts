import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { materialsTable } from "./materials";

export const summariesTable = pgTable("summaries", {
  id: serial("id").primaryKey(),
  materialId: integer("material_id").notNull().references(() => materialsTable.id, { onDelete: "cascade" }),
  summaryType: text("summary_type").notNull().default("quick"),
  language: text("language").notNull().default("en"),
  content: text("content").notNull(),
  keyPoints: text("key_points").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSummarySchema = createInsertSchema(summariesTable).omit({ id: true, createdAt: true });
export type InsertSummary = z.infer<typeof insertSummarySchema>;
export type Summary = typeof summariesTable.$inferSelect;
