import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { materialsTable } from "./materials";

export const recordingsTable = pgTable("recordings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  materialId: integer("material_id").references(() => materialsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  durationSeconds: integer("duration_seconds"),
  mimeType: text("mime_type").notNull().default("audio/webm"),
  audioData: text("audio_data"),
  summaryId: integer("summary_id"),
  deckId: integer("deck_id"),
  questionSetId: integer("question_set_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Recording = typeof recordingsTable.$inferSelect;
