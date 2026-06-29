import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { materialsTable } from "./materials";

export const questionSetsTable = pgTable("question_sets", {
  id: serial("id").primaryKey(),
  materialId: integer("material_id").notNull().references(() => materialsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  language: text("language").notNull().default("en"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Manual "I've gone through this quiz" progress marker.
  studied: boolean("studied").notNull().default(false),
  studiedAt: timestamp("studied_at", { withTimezone: true }),
});

export const questionsTable = pgTable("questions", {
  id: serial("id").primaryKey(),
  setId: integer("set_id").references(() => questionSetsTable.id, { onDelete: "cascade" }),
  examId: integer("exam_id"),
  questionType: text("question_type").notNull().default("open"),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  explanation: text("explanation"),
  modelAnswer: text("model_answer"),
  options: text("options").array().notNull().default([]),
  difficulty: text("difficulty").notNull().default("medium"),
  concept: text("concept"),
  optionExplanations: text("option_explanations").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertQuestionSetSchema = createInsertSchema(questionSetsTable).omit({ id: true, createdAt: true });
export const insertQuestionSchema = createInsertSchema(questionsTable).omit({ id: true, createdAt: true });
export type InsertQuestionSet = z.infer<typeof insertQuestionSetSchema>;
export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type QuestionSet = typeof questionSetsTable.$inferSelect;
export type Question = typeof questionsTable.$inferSelect;
