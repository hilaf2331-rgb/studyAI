import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { materialsTable } from "./materials";

export const examsTable = pgTable("exams", {
  id: serial("id").primaryKey(),
  materialId: integer("material_id").notNull().references(() => materialsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  language: text("language").notNull().default("en"),
  examType: text("exam_type").notNull().default("practice"),
  questionCount: integer("question_count").notNull().default(10),
  timeLimitMinutes: integer("time_limit_minutes"),
  difficulty: text("difficulty").notNull().default("mixed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const examResultsTable = pgTable("exam_results", {
  id: serial("id").primaryKey(),
  examId: integer("exam_id").notNull().references(() => examsTable.id, { onDelete: "cascade" }),
  score: integer("score").notNull().default(0),
  totalQuestions: integer("total_questions").notNull(),
  correctCount: integer("correct_count").notNull().default(0),
  timeSpentSeconds: integer("time_spent_seconds"),
  feedbackJson: text("feedback_json").notNull().default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExamSchema = createInsertSchema(examsTable).omit({ id: true, createdAt: true });
export const insertExamResultSchema = createInsertSchema(examResultsTable).omit({ id: true, createdAt: true });
export type InsertExam = z.infer<typeof insertExamSchema>;
export type InsertExamResult = z.infer<typeof insertExamResultSchema>;
export type Exam = typeof examsTable.$inferSelect;
export type ExamResult = typeof examResultsTable.$inferSelect;
