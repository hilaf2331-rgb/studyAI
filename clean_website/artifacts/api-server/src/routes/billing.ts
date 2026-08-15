import { Router, type IRouter } from "express";
import { db, usersTable, transactionsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
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

// Authenticated: previously let a logged-in user save the display name they
// use in their Bit/PayBox app, so the /webhooks/payment handler below could
// match an incoming payment back to their account. Disabled: any account
// could self-attest an arbitrary, unverified bitName with no uniqueness
// check, and the webhook trusted a plain case-insensitive name match to
// decide who to credit -- a real cross-account credit-hijack risk (a
// stranger's real Bit/PayBox payment could get credited to whoever claimed
// their display name first). The Bit/PayBox flow was never wired into the
// live purchase UI (Hyp Pay is the only active gateway -- see
// POST /billing/hyp/create below), so disabling outright was safer than a
// partial fix. Re-enable only after adding real ownership verification (e.g.
// a one-time code embedded in the payment reference), mirroring the Hyp Pay
// pending-intent flow the return handler below relies on.
export const billingAuthRouter: IRouter = Router();

billingAuthRouter.post("/billing/bit-name", async (_req, res) => {
  res.status(404).json({ error: "Not found" });
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
      // ClientName is deliberately omitted: Hyp's payment page appears to
      // expect Hebrew text in a legacy encoding rather than UTF-8, so a
      // Hebrew user.name renders as mojibake on their pre-filled "first
      // name" field. Leaving it out lets the customer type it themselves
      // instead of showing them garbled text -- it's optional and unused
      // by our own crediting logic either way.
      email: user.email,
      info: `FocusStudy ${pkg.id}`,
    });
  } catch (err) {
    logger.error({ err, order }, "[billing] failed to create Hyp payment page");
    return res.status(502).json({ error: "Failed to start payment" });
  }

  res.json({ paymentUrl });
});

export default billingAuthRouter;

// Public: was called server-to-server by the Zapier automation that watched
// the Bit/PayBox notification email/SMS, once a payment came in. Disabled --
// see the comment on POST /billing/bit-name above for why (this is the other
// half of that same flow: it trusted the bitName each account self-attested
// via that now-disabled endpoint to decide who to credit). Mounted outside
// requireAuth (same as authRouter) since Zapier has no user JWT to send.
export const billingPublicRouter: IRouter = Router();

billingPublicRouter.post("/webhooks/payment", async (_req, res) => {
  res.status(404).json({ error: "Not found" });
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
