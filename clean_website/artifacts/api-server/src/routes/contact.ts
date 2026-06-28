import { Router, type IRouter } from "express";
import { SubmitContactMessageBody } from "@workspace/api-zod";
import { sendContactMessageEmail } from "../lib/email";
import { logger } from "../lib/logger";

const contactRouter: IRouter = Router();

contactRouter.post("/contact", async (req, res) => {
  const body = SubmitContactMessageBody.parse(req.body);

  try {
    await sendContactMessageEmail(body);
  } catch (err) {
    logger.error({ err }, "[contact] failed to send contact message email");
    return res.status(502).json({ error: "Failed to send message. Please try again later." });
  }

  res.json({ ok: true });
});

export default contactRouter;
