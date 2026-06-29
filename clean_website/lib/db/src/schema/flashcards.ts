import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { materialsTable } from "./materials";

export const flashcardDecksTable = pgTable("flashcard_decks", {
  id: serial("id").primaryKey(),
  materialId: integer("material_id").notNull().references(() => materialsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  language: text("language").notNull().default("en"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Manual "I've gone through this deck" marker, separate from each card's
  // own spaced-repetition reviewCount/nextReviewAt below.
  studied: boolean("studied").notNull().default(false),
  studiedAt: timestamp("studied_at", { withTimezone: true }),
});

export const flashcardsTable = pgTable("flashcards", {
  id: serial("id").primaryKey(),
  deckId: integer("deck_id").notNull().references(() => flashcardDecksTable.id, { onDelete: "cascade" }),
  front: text("front").notNull(),
  back: text("back").notNull(),
  difficulty: text("difficulty").notNull().default("medium"),
  cardType: text("card_type").notNull().default("qa"),
  concept: text("concept"),
  reviewCount: integer("review_count").notNull().default(0),
  nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
  easeFactor: integer("ease_factor").notNull().default(250),
  interval: integer("interval").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFlashcardDeckSchema = createInsertSchema(flashcardDecksTable).omit({ id: true, createdAt: true });
export const insertFlashcardSchema = createInsertSchema(flashcardsTable).omit({ id: true, createdAt: true });
export type InsertFlashcardDeck = z.infer<typeof insertFlashcardDeckSchema>;
export type InsertFlashcard = z.infer<typeof insertFlashcardSchema>;
export type FlashcardDeck = typeof flashcardDecksTable.$inferSelect;
export type Flashcard = typeof flashcardsTable.$inferSelect;
