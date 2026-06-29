import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
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
  // Student-set progress flag -- separate from flashcards' spaced-repetition
  // review tracking, this is a plain manual "I've gone through this" marker
  // for item types (summaries, decks, question sets, exams) that don't have
  // their own per-card review state.
  studied: boolean("studied").notNull().default(false),
  studiedAt: timestamp("studied_at", { withTimezone: true }),
});

export const insertSummarySchema = createInsertSchema(summariesTable).omit({ id: true, createdAt: true });
export type InsertSummary = z.infer<typeof insertSummarySchema>;
export type Summary = typeof summariesTable.$inferSelect;
