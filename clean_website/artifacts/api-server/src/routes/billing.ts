import { Router, type IRouter } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, usersTable, transactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

// Token packages on sale via Bit/PayBox (through Cardcom). Priced as a
// no-brainer student top-up while keeping a 5-9x margin over the buffered
// real API cost per lecture hour (Whisper + Gemini) -- see the pricing
// analysis this was derived from.
export const TOKEN_PACKAGES = {
  bronze: { tokens: 300_000, priceILS: 19 },
  silver: { tokens: 800_000, priceILS: 39 },
  gold: { tokens: 2_000_000, priceILS: 79 },
} as const;

export type TokenPackageId = keyof typeof TOKEN_PACKAGES;

// FocusStudy is currently in a free beta: no payment gateway contract is
// signed, so there is nothing real for create-checkout-session or the
// payment webhook to do. Both routes below are gated behind this flag
// instead of being removed outright, so flipping it back on later (once
// Cardcom is integrated and CARDCOM_WEBHOOK_SECRET is set) doesn't require
// re-adding routes the frontend may still reference.
const BETA_MODE = process.env.BILLING_ENABLED !== "true";

// Authenticated: a logged-in user requests a checkout session for a token
// package. Mount this behind requireAuth (see routes/index.ts).
export const billingAuthRouter: IRouter = Router();

billingAuthRouter.post("/billing/create-checkout-session", async (req, res) => {
  if (BETA_MODE) {
    return res.status(503).json({ error: "billing_disabled", message: "FocusStudy is currently in a free beta. Token purchases are not yet available." });
  }

  const userId = req.user!.userId;
  const packageId = req.body?.packageId as TokenPackageId | undefined;
  const pkg = packageId ? TOKEN_PACKAGES[packageId] : undefined;
  if (!pkg) {
    return res.status(400).json({ error: "Unknown or missing packageId", availablePackages: Object.keys(TOKEN_PACKAGES) });
  }

  // ---- PAYMENT GATEWAY INJECTION POINT ----
  // Once Cardcom approves the account, set BILLING_ENABLED=true plus
  // CARDCOM_API_KEY/CARDCOM_TERMINAL_ID, and replace this block with the
  // real Cardcom SDK/API call that creates a hosted checkout/payment page
  // for `pkg.priceILS`, passing `userId` + `packageId` through as metadata
  // so the webhook below can credit the right account once payment clears.
  logger.warn({ userId, packageId }, "[billing] create-checkout-session reached with BILLING_ENABLED=true but no gateway integration implemented yet");
  res.status(501).json({ error: "Payment gateway not yet implemented." });
});

export default billingAuthRouter;

// Public: called server-to-server by the payment gateway once a payment
// clears. Must stay outside requireAuth (mounted directly in app.ts, same as
// authRouter) since the gateway has no user JWT to send.
export const billingPublicRouter: IRouter = Router();

// Constant-time HMAC-SHA256 check over the exact raw request bytes
// (app.ts's express.json verify callback stashes these on req.rawBody before
// JSON parsing runs) -- a re-serialized JSON.stringify(req.body) would not
// reliably reproduce the gateway's own signature if key order/whitespace
// differs from what it actually sent. timingSafeEqual throws on mismatched
// buffer lengths rather than returning false, so the length check must come
// first.
function isValidWebhookSignature(rawBody: Buffer | undefined, signatureHeader: string, secret: string): boolean {
  if (!rawBody) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

billingPublicRouter.post("/webhooks/payment", async (req, res) => {
  const webhookSecret = process.env.CARDCOM_WEBHOOK_SECRET;
  if (BETA_MODE || !webhookSecret) {
    logger.warn("[billing] payment webhook called while billing is disabled or unconfigured -- rejecting");
    return res.status(404).json({ error: "Not found" });
  }

  const signature = req.headers["x-cardcom-signature"];
  if (!signature || typeof signature !== "string" || !isValidWebhookSignature(req.rawBody, signature, webhookSecret)) {
    logger.warn("[billing] payment webhook signature verification failed");
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  // Tokens/price are looked up from our own TOKEN_PACKAGES rather than
  // trusted from the request body -- the previous implementation accepted a
  // bare { userId, tokens } body, letting anyone credit arbitrary tokens to
  // any account. The gateway only tells us which package was bought.
  const userId = Number(req.body?.userId);
  const requestedPackageId = req.body?.packageId as TokenPackageId | undefined;
  const transactionId = req.body?.transactionId;
  const pkg = requestedPackageId ? TOKEN_PACKAGES[requestedPackageId] : undefined;

  if (!Number.isFinite(userId) || !requestedPackageId || !pkg || typeof transactionId !== "string" || !transactionId) {
    return res.status(400).json({ error: "Expected { userId: number, packageId: 'bronze'|'silver'|'gold', transactionId: string }" });
  }
  const packageId: TokenPackageId = requestedPackageId;

  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    return res.status(404).json({ error: "Unknown userId" });
  }

  // Idempotent crediting: providerTransactionId is UNIQUE, so a gateway's
  // at-least-once webhook retry hits a 23505 unique-violation here instead
  // of crediting the same payment twice.
  try {
    await db.transaction(async (tx) => {
      await tx.insert(transactionsTable).values({
        userId,
        packageId,
        tokens: pkg.tokens,
        priceIls: pkg.priceILS,
        provider: "cardcom",
        providerTransactionId: transactionId,
      });
      await tx.update(usersTable)
        .set({
          tokensRemaining: sql`${usersTable.tokensRemaining} + ${pkg.tokens}`,
          isPayingCustomer: true,
        })
        .where(eq(usersTable.id, userId));
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      logger.info({ userId, transactionId }, "[billing] payment webhook retry for already-processed transaction -- not re-crediting");
      return res.json({ ok: true, userId, alreadyProcessed: true });
    }
    throw err;
  }

  logger.info({ userId, packageId, tokens: pkg.tokens }, "[billing] credited tokens from payment webhook");
  res.json({ ok: true, userId, tokensAdded: pkg.tokens });
});
