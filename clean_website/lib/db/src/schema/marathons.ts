import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { materialsTable } from "./materials";

// Marathon Mode: a cram session across several materials the student is
// behind on, distilled down to one continuous run (exam-focused summary ->
// flashcards -> quiz per material, then on to the next) instead of the old
// per-material Cram Mode toggle that had no visible in-app effect.
export const marathonsTable = pgTable("marathons", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  examDate: timestamp("exam_date", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("active"), // active | completed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marathonMaterialsTable = pgTable("marathon_materials", {
  id: serial("id").primaryKey(),
  marathonId: integer("marathon_id").notNull().references(() => marathonsTable.id, { onDelete: "cascade" }),
  materialId: integer("material_id").notNull().references(() => materialsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  status: text("status").notNull().default("pending"), // pending | summary_done | flashcards_done | completed
});

export const insertMarathonSchema = createInsertSchema(marathonsTable).omit({ id: true, createdAt: true });
export const insertMarathonMaterialSchema = createInsertSchema(marathonMaterialsTable).omit({ id: true });
export type InsertMarathon = z.infer<typeof insertMarathonSchema>;
export type InsertMarathonMaterial = z.infer<typeof insertMarathonMaterialSchema>;
export type Marathon = typeof marathonsTable.$inferSelect;
export type MarathonMaterial = typeof marathonMaterialsTable.$inferSelect;
