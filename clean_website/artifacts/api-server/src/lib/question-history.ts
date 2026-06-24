import { db, questionsTable, questionSetsTable, examsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Used to steer regeneration (both practice question sets and exams) away
// from repeating questions a student has already seen for this material --
// "re-run to get a fresh set" only works if the fresh set is actually new.
export async function getExistingQuestionTexts(materialId: number): Promise<string[]> {
  const [sets, exams] = await Promise.all([
    db.select({ id: questionSetsTable.id }).from(questionSetsTable).where(eq(questionSetsTable.materialId, materialId)),
    db.select({ id: examsTable.id }).from(examsTable).where(eq(examsTable.materialId, materialId)),
  ]);

  const setIds = sets.map((s) => s.id);
  const examIds = exams.map((e) => e.id);

  const [fromSets, fromExams] = await Promise.all([
    setIds.length > 0
      ? db.select({ question: questionsTable.question }).from(questionsTable).where(inArray(questionsTable.setId, setIds))
      : Promise.resolve([]),
    examIds.length > 0
      ? db.select({ question: questionsTable.question }).from(questionsTable).where(inArray(questionsTable.examId, examIds))
      : Promise.resolve([]),
  ]);

  return [...fromSets, ...fromExams].map((r) => r.question);
}
