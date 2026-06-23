import { Router } from "express";
import { db, chatMessagesTable, materialsTable, activityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { GetChatHistoryParams, SendChatMessageParams, SendChatMessageBody } from "@workspace/api-zod";
import { chatWithMaterial } from "../lib/ai";
import { requireTokenBalance, deductTokensForGeneration } from "../lib/tokens";

const router = Router();

router.get("/materials/:id/chat", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GetChatHistoryParams.parse({ id: Number(req.params.id) });

  const [material] = await db.select({ id: materialsTable.id }).from(materialsTable)
    .where(and(eq(materialsTable.id, id), eq(materialsTable.userId, userId)));
  if (!material) return res.status(404).json({ error: "Not found" });

  const messages = await db.select().from(chatMessagesTable)
    .where(eq(chatMessagesTable.materialId, id))
    .orderBy(chatMessagesTable.createdAt);
  res.json(messages);
});

router.post("/materials/:id/chat", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = SendChatMessageParams.parse({ id: Number(req.params.id) });
  const body = SendChatMessageBody.parse(req.body);

  const [material] = await db.select().from(materialsTable)
    .where(and(eq(materialsTable.id, id), eq(materialsTable.userId, userId)));
  if (!material) return res.status(404).json({ error: "Not found" });

  await db.insert(chatMessagesTable).values({
    materialId: id,
    role: "user",
    content: body.content,
    language: body.language || null,
  });

  const history = await db.select().from(chatMessagesTable)
    .where(eq(chatMessagesTable.materialId, id))
    .orderBy(chatMessagesTable.createdAt);

  const prevMessages = history.slice(0, -1).map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  await requireTokenBalance(userId);

  const materialContent = material.extractedText || material.title;
  const aiResponse = await chatWithMaterial(
    materialContent,
    material.title,
    body.content,
    (body.language || material.language || "en") as "he" | "en",
    prevMessages,
  );
  await deductTokensForGeneration(userId, body.content, aiResponse);

  const [assistantMsg] = await db.insert(chatMessagesTable).values({
    materialId: id,
    role: "assistant",
    content: aiResponse,
    language: body.language || null,
  }).returning();

  await db.insert(activityTable).values({
    userId,
    activityType: "chat",
    description: `Chatted about "${material.title}"`,
    materialTitle: material.title,
  });

  res.json(assistantMsg);
});

export default router;
