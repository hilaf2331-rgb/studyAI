import { db, coursesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

// Shared by every route that accepts a client-supplied courseId (courses.ts's
// glossary routes, materials.ts, recordings.ts) -- glossary terms and other
// course-scoped data have no userId column of their own, so the course row is
// the only link back to the owning user, and this is the one place that
// check happens.
export async function getOwnedCourseId(courseId: number, userId: number): Promise<number | null> {
  const [course] = await db.select({ id: coursesTable.id }).from(coursesTable)
    .where(and(eq(coursesTable.id, courseId), eq(coursesTable.userId, userId)));
  return course ? course.id : null;
}
