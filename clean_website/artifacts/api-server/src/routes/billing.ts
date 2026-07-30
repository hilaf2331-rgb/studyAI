import { Router, type IRouter } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { db, usersTable, transactionsTable } from "@workspace/db";
import { eq, and, sql, ilike } from "drizzle-orm";
import { logger } from "../lib/logger";
import { createHypPaymentUrl, verifyHypReturn } from "../lib/hyp";
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

// Used by providers (like the Zapier/Bit-PayBox webhook below) that only
// learn about a purchase once it's already completed, in a single step.
// Idempotent per (provider, providerTransactionId) via transactionsTable's
// UNIQUE constraint -- see the 23505 handling below for how a retried
// delivery is detected and no-op'd rather than double-credited. Returns the
// raw-unit amount actually credited. Max Business (Hyp Pay) instead reserves
// a "pending" row up front in POST /billing/hyp/create and flips it to
// "completed" in the /webhooks/hyp/return handler below, since it needs a
// place to stash (userId, package) before the customer ever reaches Hyp's
// checkout -- see that handler for why creditTokenPackage doesn't fit there.
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

// Token bundles sold via Max Business's hosted Hyp Pay checkout -- the live,
// user-facing purchase flow (see study-platform's purchase-modal.tsx).
// `tokens` here is the simplified whole-Token count shown everywhere in the
// UI; raw cost-estimation units are credited to tokenBalance via
// RAW_UNITS_PER_TOKEN so the underlying per-request metering never changes.
// Keyed by tier id (not price) since, unlike the old PayPal webhook, the Hyp
// return handler already knows exactly which package was bought from the
// pending transaction row created in POST /billing/hyp/create.
export const HYP_PACKAGES_BY_ID: Record<TokenPackageId, TokenPackage> = {
  bronze: { id: "bronze", tokens: 40, priceILS: 39 },
  silver: { id: "silver", tokens: 80, priceILS: 79 },
  gold: { id: "gold", tokens: 150, priceILS: 119 },
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

// Authenticated: starts a Max Business (Hyp Pay) hosted-checkout purchase.
// Reserves a "pending" transaction row keyed by a freshly generated Order
// number *before* asking Hyp for the payment page URL, so the public
// /webhooks/hyp/return handler below always has a known (userId, package) to
// credit once Hyp confirms the charge -- Hyp only echoes Order back
// unmodified, so this row is the only place that mapping lives.
billingAuthRouter.post("/billing/hyp/create", async (req, res) => {
  const userId = req.user!.userId;
  const tierId = typeof req.body?.tierId === "string" ? req.body.tierId : "";
  const pkg = HYP_PACKAGES_BY_ID[tierId as TokenPackageId];
  if (!pkg) {
    return res.status(400).json({
      error: "Invalid tierId",
      availableTierIds: Object.keys(HYP_PACKAGES_BY_ID),
    });
  }

  const [user] = await db.select({ email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const order = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const rawTokens = pkg.tokens * RAW_UNITS_PER_TOKEN;

  await db.insert(transactionsTable).values({
    userId,
    packageId: pkg.id,
    tokens: rawTokens,
    priceIls: pkg.priceILS,
    provider: "hyp",
    providerTransactionId: order,
    status: "pending",
  });

  let paymentUrl: string;
  try {
    paymentUrl = await createHypPaymentUrl({
      amountILS: pkg.priceILS,
      order,
      clientName: user.name ?? undefined,
      email: user.email,
      info: `StudyAI ${pkg.id}`,
    });
  } catch (err) {
    logger.error({ err, order }, "[billing] failed to create Hyp payment page");
    return res.status(502).json({ error: "Failed to start payment" });
  }

  res.json({ paymentUrl });
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
  // table's UNIQUE constraint (and the 23505 handling below) catches it
  // as "already processed" instead of
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

// Public: the browser lands here after the customer finishes (or abandons)
// a Max Business (Hyp Pay) hosted checkout -- this exact path is configured
// once as the "success URL" in the Hyp Pay account (see Hyp Portal ->
// Settings -> Payment Page and API -> Post-transaction address). Per Hyp's
// own recommendation we don't configure a separate error URL, so a failed
// payment never reaches this route at all; Hyp shows the error on its own
// page and lets the customer retry.
//
// GET (not POST) because this is a plain top-level browser redirect Hyp
// performs after the payment page, not a server-to-server webhook delivery.
billingPublicRouter.get("/webhooks/hyp/return", async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "https://focusstudy.net";
  const queryIndex = req.originalUrl.indexOf("?");
  const rawQuery = queryIndex >= 0 ? req.originalUrl.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(rawQuery);
  const order = params.get("Order");
  const ccode = params.get("CCode");
  const hypId = params.get("Id");

  if (!order || ccode !== "0") {
    logger.info({ order, ccode }, "[billing] hyp return: missing order or non-success CCode, not crediting");
    return res.redirect(302, frontendUrl);
  }

  // Confirms this redirect genuinely came from Hyp (and its params weren't
  // tampered with in the browser) before trusting anything in it -- Hyp's
  // documented server-side validation step, the same role
  // verifyPaypalWebhookSignature played for the old PayPal integration.
  const verified = await verifyHypReturn(rawQuery);
  if (!verified) {
    logger.warn({ order, hypId }, "[billing] hyp return: VERIFY failed");
    return res.redirect(302, frontendUrl);
  }

  const [pending] = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.providerTransactionId, order), eq(transactionsTable.provider, "hyp")));

  if (!pending) {
    logger.warn({ order }, "[billing] hyp return: no matching pending transaction for this order");
    return res.redirect(302, frontendUrl);
  }

  const pkgForCelebration = HYP_PACKAGES_BY_ID[pending.packageId as TokenPackageId];

  // Already credited by an earlier hit on this same return URL (e.g. the
  // customer refreshed the success page) -- redirect straight to the
  // celebration without crediting twice.
  if (pending.status === "completed") {
    return res.redirect(302, `${frontendUrl}/?purchase=success&tokens=${pkgForCelebration?.tokens ?? ""}`);
  }

  const amountParam = Number(params.get("Amount"));
  if (Number.isFinite(amountParam) && Math.round(amountParam) !== pending.priceIls) {
    logger.warn({ order, amountParam, expected: pending.priceIls }, "[billing] hyp return: amount mismatch");
    return res.redirect(302, frontendUrl);
  }

  // Flips the reserved row from "pending" to "completed" and credits the
  // balance atomically, guarded by the WHERE status = 'pending' below so a
  // concurrent/duplicate hit on this route (e.g. the customer double-taps
  // back) can never double-credit the same order.
  const credited = await db.transaction(async (tx) => {
    const [row] = await tx.update(transactionsTable)
      .set({ status: "completed" })
      .where(and(eq(transactionsTable.providerTransactionId, order), eq(transactionsTable.status, "pending")))
      .returning();
    if (!row) return null;
    await tx.update(usersTable)
      .set({
        tokenBalance: sql`${usersTable.tokenBalance} + ${row.tokens}`,
        isPayingCustomer: true,
      })
      .where(eq(usersTable.id, row.userId));
    return row;
  });

  if (credited) {
    logger.info(
      { userId: credited.userId, order, hypId, packageId: credited.packageId },
      "[billing] credited tokens from Hyp payment return",
    );
  } else {
    logger.info({ order }, "[billing] hyp return: already processed concurrently, skipping credit");
  }

  res.redirect(302, `${frontendUrl}/?purchase=success&tokens=${pkgForCelebration?.tokens ?? ""}`);
});
