import { Router, type IRouter } from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { db, usersTable, transactionsTable } from "@workspace/db";
import { eq, sql, ilike } from "drizzle-orm";
import { logger } from "../lib/logger";

// Token packages sold via Bit/PayBox. Priced as a no-brainer student top-up
// while keeping a healthy margin over the buffered real API cost per lecture
// hour (Whisper + Gemini) -- see the pricing analysis this was derived from.
// Keyed by the NIS amount Zapier reports, since that's the only thing the
// incoming webhook payload tells us about which tier was bought.
export const TOKEN_PACKAGES_BY_PRICE: Record<number, { id: "bronze" | "silver" | "gold"; tokens: number; priceILS: number }> = {
  19: { id: "bronze", tokens: 300_000, priceILS: 19 },
  39: { id: "silver", tokens: 800_000, priceILS: 39 },
  79: { id: "gold", tokens: 2_000_000, priceILS: 79 },
};

export type TokenPackageId = "bronze" | "silver" | "gold";

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
  // dedupe an identical retry against (unlike a real payment gateway) --
  // providerTransactionId is still UNIQUE+NOT NULL on the table, so a random
  // one is generated per credit. This means a Zapier retry of the same
  // notification would double-credit; that tradeoff is accepted since Zapier
  // Filter/dedup steps are expected to prevent the automation from firing
  // twice for the same notification in the first place.
  await db.transaction(async (tx) => {
    await tx.insert(transactionsTable).values({
      userId: user.id,
      packageId: pkg.id,
      tokens: pkg.tokens,
      priceIls: pkg.priceILS,
      provider: "zapier",
      providerTransactionId: randomUUID(),
    });
    await tx.update(usersTable)
      .set({
        tokenBalance: sql`${usersTable.tokenBalance} + ${pkg.tokens}`,
        isPayingCustomer: true,
      })
      .where(eq(usersTable.id, user.id));
  });

  logger.info({ userId: user.id, packageId: pkg.id, tokens: pkg.tokens }, "[billing] credited tokens from Zapier payment webhook");
  res.json({ ok: true, userId: user.id, tokensAdded: pkg.tokens });
});
