import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { coursesTable } from "./courses";
import { materialsTable } from "./materials";
import { usersTable } from "./users";

// "Course Media" -- generated podcast/lecture audio scoped to a course.
// Binary audio never lives here: only a pointer to the object in the
// storage bucket (storagePath/storageUrl), per the cost/architecture
// directive to keep raw binaries out of Postgres. Deleting the bucket
// object is handled at the application layer (routes/course-media.ts and
// the course-deletion route) BEFORE the DB row is removed, since the
// "courseId" cascade below only cleans up the row, not the bucket object.
export const courseAssetsTable = pgTable("course_assets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  courseId: integer("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
  materialId: integer("material_id").references(() => materialsTable.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), // "material_convert" | "lecture_upload"
  title: text("title").notNull(),
  storagePath: text("storage_path").notNull(),
  storageUrl: text("storage_url").notNull(),
  mimeType: text("mime_type").notNull().default("audio/mpeg"),
  durationSeconds: integer("duration_seconds"),
  sizeBytes: integer("size_bytes"),
  // Hash of the source text this audio was generated from -- checked before
  // calling the TTS engine again so converting the same material/summary
  // twice reuses the existing bucket object instead of re-paying for it.
  sourceTextHash: text("source_text_hash"),
  status: text("status").notNull().default("ready"), // "processing" | "ready" | "error"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCourseAssetSchema = createInsertSchema(courseAssetsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCourseAsset = z.infer<typeof insertCourseAssetSchema>;
export type CourseAsset = typeof courseAssetsTable.$inferSelect;
