import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { materialsTable } from "./materials";

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  materialId: integer("material_id").notNull().references(() => materialsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("user"),
  content: text("content").notNull(),
  language: text("language"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessagesTable).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
