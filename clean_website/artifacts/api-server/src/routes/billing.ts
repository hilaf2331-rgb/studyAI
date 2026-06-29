import { Router, type IRouter } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { db, usersTable, transactionsTable } from "@workspace/db";
import { eq, sql, ilike } from "drizzle-orm";
import { logger } from "../lib/logger";
import { verifyPaypalWebhookSignature, getPaypalOrderDetails } from "../lib/paypal";
import { RAW_UNITS_PER_TOKEN } from "../lib/tokens";

export type TokenPackageId = "bronze" | "silver" | "gold";

// Shared shape every payment provider's package table below conforms to --
// this is the one "modular" seam new top-up gateways plug into: define a
// Record<priceKey, TokenPackage> for the new provider (priced in whatever
// unit that provider's webhook reports), then call creditTokenPackage with
// the provider's own name + its transaction id for dedup. No other billing
// code needs to change to add a 3rd/4th provider (e.g. Stripe, a future
// Cardcom integration) -- the same package-table + creditTokenPackage
// pattern Gemini/OpenAI's own usage-based billing follows internally.
export interface TokenPackage {
  id: TokenPackageId;
  tokens: number;
  priceILS: number;
}

// Token packages sold via Bit/PayBox. Priced as a no-brainer student top-up
// while keeping a healthy margin over the buffered real API cost per lecture
// hour (Whisper + Gemini) -- see the pricing analysis this was derived from.
// Keyed by the NIS amount Zapier reports, since that's the only thing the
// incoming webhook payload tells us about which tier was bought.
export const TOKEN_PACKAGES_BY_PRICE: Record<number, TokenPackage> = {
  19: { id: "bronze", tokens: 300_000, priceILS: 19 },
  39: { id: "silver", tokens: 800_000, priceILS: 39 },
  79: { id: "gold", tokens: 2_000_000, priceILS: 79 },
};

// Used by the real /webhooks/paypal handler (and any future provider) to
// credit a captured purchase. Idempotent per (provider, providerTransactionId)
// via transactionsTable's UNIQUE constraint -- see the 23505 handling in the
// paypal webhook below for how a retried delivery is detected and no-op'd
// rather than double-crediting. Returns the raw-unit amount actually
// credited.
async function creditTokenPackage(
  userId: number,
  pkg: TokenPackage,
  provider: string,
  providerTransactionId: string,
): Promise<number> {
  const rawTokens = pkg.tokens * RAW_UNITS_PER_TOKEN;
  await db.transaction(async (tx) => {
    await tx.insert(transactionsTable).values({
      userId,
      packageId: pkg.id,
      tokens: rawTokens,
      priceIls: pkg.priceILS,
      provider,
      providerTransactionId,
    });
    await tx.update(usersTable)
      .set({
        tokenBalance: sql`${usersTable.tokenBalance} + ${rawTokens}`,
        isPayingCustomer: true,
      })
      .where(eq(usersTable.id, userId));
  });
  return rawTokens;
}

// Token bundles sold via hosted PayPal (NCP) checkout -- the live, user-
// facing purchase flow (see study-platform's purchase-modal.tsx). `tokens`
// here is the simplified whole-Token count shown everywhere in the UI;
// raw cost-estimation units are credited to tokenBalance via
// RAW_UNITS_PER_TOKEN so the underlying per-request metering never changes.
// Keyed by the ILS amount on the captured PayPal order, since that's the
// only thing distinguishing which of the 3 hosted checkout buttons was used.
export const PAYPAL_PACKAGES_BY_PRICE: Record<number, TokenPackage> = {
  39: { id: "bronze", tokens: 40, priceILS: 39 },
  79: { id: "silver", tokens: 80, priceILS: 79 },
  119: { id: "gold", tokens: 150, priceILS: 119 },
};

// Authenticated: a logged-in user saves the display name they use in their
// Bit/PayBox app, so the webhook below can match an incoming payment back to
// their account. Mount this behind requireAuth (see routes/index.ts).
export const billingAuthRouter: IRouter = Router();

billingAuthRouter.post("/billing/bit-name", async (req, res) => {
  const userId = req.user!.userId;
  const bitName = typeof req.body?.bitName === "string" ? req.body.bitName.trim() : "";
  if (!bitName) {
    return res.status(400).json({ error: "bitName is required" });
  }

  await db.update(usersTable).set({ bitName }).where(eq(usersTable.id, userId));
  res.json({ ok: true, bitName });
});

export default billingAuthRouter;

// Public: called server-to-server by the Zapier automation that watches the
// Bit/PayBox notification email/SMS, once a payment comes in. Must stay
// outside requireAuth (mounted directly in app.ts, same as authRouter) since
// Zapier has no user JWT to send -- it's secured by a shared secret header
// instead.
export const billingPublicRouter: IRouter = Router();

// Constant-time compare so a timing side-channel can't be used to brute-force
// the secret one byte at a time. timingSafeEqual throws on mismatched buffer
// lengths rather than returning false, so the length check must come first.
function isValidSharedSecret(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

billingPublicRouter.post("/webhooks/payment", async (req, res) => {
  const sharedSecret = process.env.ZAPIER_WEBHOOK_SECRET;
  if (!sharedSecret) {
    logger.warn("[billing] payment webhook called but ZAPIER_WEBHOOK_SECRET is unset -- rejecting");
    return res.status(404).json({ error: "Not found" });
  }

  const provided = req.headers["x-zapier-secret"];
  if (!provided || typeof provided !== "string" || !isValidSharedSecret(provided, sharedSecret)) {
    logger.warn("[billing] payment webhook called with missing/invalid X-Zapier-Secret");
    return res.status(401).json({ error: "Invalid or missing X-Zapier-Secret" });
  }

  const bitName = typeof req.body?.bitName === "string" ? req.body.bitName.trim() : "";
  const amount = Number(req.body?.amount);
  const pkg = TOKEN_PACKAGES_BY_PRICE[amount];

  if (!bitName || !Number.isFinite(amount) || !pkg) {
    return res.status(400).json({
      error: "Expected { bitName: string, amount: 19 | 39 | 79 }",
      availableAmounts: Object.keys(TOKEN_PACKAGES_BY_PRICE),
    });
  }

  // Case-insensitive match: students type their Bit/PayBox display name by
  // hand into the purchase flow, so this can't require exact casing to match
  // what Zapier later reports from the payment notification.
  const [user] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(ilike(usersTable.bitName, bitName));

  if (!user) {
    logger.warn({ bitName, amount }, "[billing] payment webhook: no user matches this bitName");
    return res.status(404).json({ error: "No user found with this bitName" });
  }

  // Zapier's payload carries no transaction ID, so there's no natural key to
  // dedupe an identical retry against (unlike a real payment gateway, whose
  // own transaction id is used directly -- see creditTokenPackage above).
  // Instead, derive a deterministic key from (bitName, amount, a 5-minute
  // time bucket) -- a retried delivery of the *same* notification lands in
  // the same bucket and hashes to the same providerTransactionId, so the
  // table's UNIQUE constraint (and the 23505 handling below, same pattern as
  // the PayPal webhook) catches it as "already processed" instead of
  // double-crediting. A genuinely new payment from the same person for the
  // same amount more than 5 minutes later gets its own bucket and is
  // credited normally.
  const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
  const timeBucket = Math.floor(Date.now() / DEDUPE_WINDOW_MS);
  const idempotencyKey = createHash("sha256")
    .update(`zapier:${bitName.toLowerCase()}:${amount}:${timeBucket}`)
    .digest("hex");

  try {
    await db.transaction(async (tx) => {
      await tx.insert(transactionsTable).values({
        userId: user.id,
        packageId: pkg.id,
        tokens: pkg.tokens,
        priceIls: pkg.priceILS,
        provider: "zapier",
        providerTransactionId: idempotencyKey,
      });
      await tx.update(usersTable)
        .set({
          tokenBalance: sql`${usersTable.tokenBalance} + ${pkg.tokens}`,
          isPayingCustomer: true,
        })
        .where(eq(usersTable.id, user.id));
    });
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      logger.info({ bitName, amount }, "[billing] zapier webhook: duplicate notification within dedupe window, ignoring retry");
      return res.json({ ok: true, alreadyProcessed: true });
    }
    throw err;
  }

  logger.info({ userId: user.id, packageId: pkg.id, tokens: pkg.tokens }, "[billing] credited tokens from Zapier payment webhook");
  res.json({ ok: true, userId: user.id, tokensAdded: pkg.tokens });
});

// Public: PayPal's own webhook delivery for the hosted (NCP) checkout
// buttons. Verified via PayPal's own verify-webhook-signature API (see
// lib/paypal.ts) rather than a shared secret, since that's how PayPal -- not
// Zapier -- proves a delivery is genuinely theirs.
billingPublicRouter.post("/webhooks/paypal", async (req, res) => {
  const event = req.body;

  // CHECKOUT.ORDER.APPROVED can fire before money has actually moved;
  // PAYMENT.CAPTURE.COMPLETED is PayPal's "funds captured" event and the only
  // one that should ever result in a credit.
  if (event?.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
    return res.json({ ok: true, ignored: true });
  }

  const transmissionId = req.headers["paypal-transmission-id"];
  const transmissionTime = req.headers["paypal-transmission-time"];
  const certUrl = req.headers["paypal-cert-url"];
  const authAlgo = req.headers["paypal-auth-algo"];
  const transmissionSig = req.headers["paypal-transmission-sig"];
  if (
    typeof transmissionId !== "string" || typeof transmissionTime !== "string" ||
    typeof certUrl !== "string" || typeof authAlgo !== "string" || typeof transmissionSig !== "string"
  ) {
    logger.warn("[billing] paypal webhook missing required PayPal-* headers");
    return res.status(400).json({ error: "Missing PayPal verification headers" });
  }

  const verified = await verifyPaypalWebhookSignature(
    { transmissionId, transmissionTime, certUrl, authAlgo, transmissionSig },
    event,
  );
  if (!verified) {
    logger.warn("[billing] paypal webhook signature verification failed");
    return res.status(401).json({ error: "Signature verification failed" });
  }

  const captureId: string | undefined = event.resource?.id;
  const orderId: string | undefined = event.resource?.supplementary_data?.related_ids?.order_id;
  if (!captureId || !orderId) {
    logger.warn({ captureId, orderId }, "[billing] paypal webhook missing capture/order id");
    return res.status(400).json({ error: "Missing capture or order id" });
  }

  // The capture event's own payload doesn't reliably carry the payer's
  // email, so the order itself is the one authoritative source for both a
  // confirmed amount and the payer's email together.
  const order = await getPaypalOrderDetails(orderId);
  if (!order || order.status !== "COMPLETED" || order.currencyCode !== "ILS") {
    logger.warn({ orderId, order }, "[billing] paypal webhook: order not completed or wrong currency");
    return res.status(400).json({ error: "Order not completed or unexpected currency" });
  }

  const amount = Math.round(Number(order.amountValue));
  const pkg = PAYPAL_PACKAGES_BY_PRICE[amount];
  if (!pkg) {
    logger.warn({ amount, orderId }, "[billing] paypal webhook: amount matches no known package");
    return res.status(400).json({ error: "Amount matches no known package" });
  }

  if (!order.payerEmail) {
    logger.warn({ orderId }, "[billing] paypal webhook: order has no payer email");
    return res.status(400).json({ error: "Order has no payer email" });
  }

  const [user] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(ilike(usersTable.email, order.payerEmail));

  if (!user) {
    logger.warn({ payerEmail: order.payerEmail }, "[billing] paypal webhook: no user matches this payer email");
    return res.status(404).json({ error: "No user found with this payer email" });
  }

  // Credit in raw cost-estimation units -- tokenBalance/transactionsTable
  // stay denominated in the same scale per-request metering already uses;
  // pkg.tokens is only the simplified whole-Token count shown in the UI.
  let rawTokens: number;
  try {
    rawTokens = await creditTokenPackage(user.id, pkg, "paypal", captureId);
  } catch (err: any) {
    // captureId is PayPal's real, stable transaction id, so a unique-
    // violation here means this exact capture was already credited by an
    // earlier delivery of the same webhook -- treat the retry as a no-op
    // rather than double-crediting or erroring. drizzle-orm wraps the raw pg
    // error in a DrizzleQueryError, so the original error code lives on
    // `.cause`, not directly on the thrown error.
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      logger.info({ captureId }, "[billing] paypal webhook: capture already processed, ignoring retry");
      return res.json({ ok: true, alreadyProcessed: true });
    }
    throw err;
  }

  logger.info({ userId: user.id, packageId: pkg.id, tokens: pkg.tokens, rawTokens, captureId }, "[billing] credited tokens from PayPal webhook");
  res.json({ ok: true, userId: user.id, tokensAdded: pkg.tokens });
});
