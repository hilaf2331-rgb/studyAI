import { Router } from "express";
import multer from "multer";
import { db, coursesTable, courseAssetsTable, materialsTable, summariesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { ListCourseMediaParams, ConvertCourseMaterialToAudioParams, ConvertCourseMaterialToAudioBody, DeleteCourseMediaParams } from "@workspace/api-zod";
import { generateSpeech, hashSourceText } from "../lib/tts";
import { uploadCourseAudio, deleteCourseAudio } from "../lib/storage";
import { requireAndDeductFeatureTokens, FEATURE_TOKEN_COSTS } from "../lib/tokens";

const router = Router();

// A student's own recorded/uploaded lecture file is already a reasonably
// compressed browser format (webm/opus, m4a, mp3) -- there's no separate
// ffmpeg transcode step here, just a size ceiling so a single upload can't
// blow past the free-tier bucket budget.
const MAX_LECTURE_UPLOAD_BYTES = 25 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_LECTURE_UPLOAD_BYTES } });

async function getOwnedCourseId(courseId: number, userId: number): Promise<number | null> {
  const [course] = await db.select({ id: coursesTable.id }).from(coursesTable)
    .where(and(eq(coursesTable.id, courseId), eq(coursesTable.userId, userId)));
  return course ? course.id : null;
}

router.get("/courses/:id/media", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = ListCourseMediaParams.parse({ id: Number(req.params.id) });
  if (!(await getOwnedCourseId(id, userId))) return res.status(404).json({ error: "Not found" });
  const assets = await db.select().from(courseAssetsTable)
    .where(eq(courseAssetsTable.courseId, id))
    .orderBy(desc(courseAssetsTable.createdAt));
  res.json(assets);
});

// Converts an existing material's summary (or extracted text, as a
// fallback) into a podcast-style audio asset. Before paying for a new TTS
// call, checks for an existing asset generated from the exact same source
// text for this material -- "persistent storage so we don't re-generate or
// re-pay for the same audio content" -- and returns that instead.
router.post("/courses/:id/media/convert", async (req, res) => {
  const userId = req.user!.userId;
  const { id: courseId } = ConvertCourseMaterialToAudioParams.parse({ id: Number(req.params.id) });
  if (!(await getOwnedCourseId(courseId, userId))) return res.status(404).json({ error: "Not found" });

  const { materialId, source } = ConvertCourseMaterialToAudioBody.parse(req.body);
  const [material] = await db.select().from(materialsTable)
    .where(and(eq(materialsTable.id, materialId), eq(materialsTable.userId, userId), eq(materialsTable.courseId, courseId)));
  if (!material) return res.status(404).json({ error: "Not found" });

  let sourceText: string | null = null;
  if (source !== "extracted_text") {
    const [summary] = await db.select({ content: summariesTable.content }).from(summariesTable)
      .where(eq(summariesTable.materialId, materialId))
      .orderBy(desc(summariesTable.createdAt))
      .limit(1);
    sourceText = summary?.content ?? null;
  }
  if (!sourceText) sourceText = material.extractedText;
  if (!sourceText || !sourceText.trim()) {
    return res.status(400).json({ error: "Material has no summary or extracted text to convert" });
  }

  const sourceTextHash = hashSourceText(sourceText);
  const [existing] = await db.select().from(courseAssetsTable)
    .where(and(eq(courseAssetsTable.materialId, materialId), eq(courseAssetsTable.sourceTextHash, sourceTextHash)));
  if (existing) return res.status(201).json(existing);

  await requireAndDeductFeatureTokens(userId, FEATURE_TOKEN_COSTS.audioGeneration);

  const speech = await generateSpeech(sourceText);
  const { storagePath, storageUrl } = await uploadCourseAudio(courseId, speech.buffer, speech.contentType, speech.extension);

  const [asset] = await db.insert(courseAssetsTable).values({
    userId,
    courseId,
    materialId,
    kind: "material_convert",
    title: material.title,
    storagePath,
    storageUrl,
    mimeType: speech.contentType,
    sizeBytes: speech.buffer.length,
    sourceTextHash,
    status: "ready",
  }).returning();

  res.status(201).json(asset);
});

// Multipart route for "Upload New Lecture" -- deliberately kept outside the
// OpenAPI/orval-generated client, same pattern as routes/recordings.ts's
// file upload, since the spec has no multipart endpoints. Auto-tags the
// asset to the course_id taken from the URL (the "active course") per spec.
router.post("/courses/:id/media/upload", upload.single("file"), async (req, res) => {
  const userId = req.user!.userId;
  const courseId = Number(req.params.id);
  if (!(await getOwnedCourseId(courseId, userId))) return res.status(404).json({ error: "Not found" });

  const title = (req.body.title as string) || (req.file?.originalname ?? "Lecture");
  const text = typeof req.body.text === "string" ? req.body.text : undefined;

  if (req.file && req.file.mimetype.startsWith("audio/")) {
    if (req.file.size === 0) return res.status(400).json({ error: "Audio file is empty" });
    const extension = (req.file.originalname.split(".").pop() || "webm").toLowerCase();
    const { storagePath, storageUrl } = await uploadCourseAudio(courseId, req.file.buffer, req.file.mimetype, extension);
    const [asset] = await db.insert(courseAssetsTable).values({
      userId,
      courseId,
      kind: "lecture_upload",
      title,
      storagePath,
      storageUrl,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.buffer.length,
      status: "ready",
    }).returning();
    return res.status(201).json(asset);
  }

  if (text && text.trim()) {
    await requireAndDeductFeatureTokens(userId, FEATURE_TOKEN_COSTS.audioGeneration);
    const speech = await generateSpeech(text);
    const { storagePath, storageUrl } = await uploadCourseAudio(courseId, speech.buffer, speech.contentType, speech.extension);
    const [asset] = await db.insert(courseAssetsTable).values({
      userId,
      courseId,
      kind: "lecture_upload",
      title,
      storagePath,
      storageUrl,
      mimeType: speech.contentType,
      sizeBytes: speech.buffer.length,
      sourceTextHash: hashSourceText(text),
      status: "ready",
    }).returning();
    return res.status(201).json(asset);
  }

  return res.status(400).json({ error: "Either an audio file or lecture text is required" });
});

router.delete("/courses/:id/media/:assetId", async (req, res) => {
  const userId = req.user!.userId;
  const { id: courseId, assetId } = DeleteCourseMediaParams.parse({ id: Number(req.params.id), assetId: Number(req.params.assetId) });
  const [deleted] = await db.delete(courseAssetsTable)
    .where(and(eq(courseAssetsTable.id, assetId), eq(courseAssetsTable.courseId, courseId), eq(courseAssetsTable.userId, userId)))
    .returning();
  if (!deleted) return res.status(404).json({ error: "Not found" });
  // Storage cleanup happens after the row is gone -- if the bucket delete
  // fails, there's no orphaned DB row left pointing at a half-deleted asset.
  await deleteCourseAudio(deleted.storagePath);
  res.status(204).end();
});

export default router;
