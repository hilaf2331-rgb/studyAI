import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { coursesTable } from "./courses";
import { usersTable } from "./users";

export const materialsTable = pgTable("materials", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  courseId: integer("course_id").references(() => coursesTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  contentType: text("content_type").notNull().default("text"),
  status: text("status").notNull().default("ready"),
  language: text("language").notNull().default("en"),
  extractedText: text("extracted_text"),
  sourceUrl: text("source_url"),
  fileSize: integer("file_size"),
  duration: integer("duration"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMaterialSchema = createInsertSchema(materialsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMaterial = z.infer<typeof insertMaterialSchema>;
export type Material = typeof materialsTable.$inferSelect;
