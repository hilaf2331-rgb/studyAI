import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { coursesTable } from "./courses";

// Student-authored course-specific terminology (jargon, abbreviations,
// formulas) that the AI summary/transcription pipeline is grounded against
// -- see ai.ts's buildGlossaryContext, injected into the Gemini prompt so
// the model uses the student's own definitions instead of guessing at
// course-specific shorthand.
export const glossaryTermsTable = pgTable("glossary_terms", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  term: text("term").notNull(),
  definition: text("definition").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertGlossaryTermSchema = createInsertSchema(glossaryTermsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGlossaryTerm = z.infer<typeof insertGlossaryTermSchema>;
export type GlossaryTerm = typeof glossaryTermsTable.$inferSelect;
