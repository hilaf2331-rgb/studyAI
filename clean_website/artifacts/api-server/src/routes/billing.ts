import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

// Credentials for the local Israeli payment gateway (Grow). Read from env so
// no key/terminal ID is ever hardcoded or committed -- set these in Render
// (and a local .env, see .env.example) once Grow approves the account.
const GROW_API_KEY = process.env.GROW_API_KEY;
const GROW_TERMINAL_ID = process.env.GROW_TERMINAL_ID;

// Token packages available for purchase. Prices are in ILS (cents not used --
// whole shekels) since Grow bills in ILS. Adjust freely; nothing downstream
// depends on these exact values.
export const TOKEN_PACKAGES = {
  starter: { tokens: 50_000, priceILS: 19 },
  standard: { tokens: 150_000, priceILS: 49 },
  pro: { tokens: 500_000, priceILS: 129 },
} as const;

export type TokenPackageId = keyof typeof TOKEN_PACKAGES;

// Authenticated: a logged-in user requests a checkout session for a token
// package. Mount this behind requireAuth (see routes/index.ts).
export const billingAuthRouter: IRouter = Router();

billingAuthRouter.post("/billing/create-checkout-session", async (req, res) => {
  const userId = req.user!.userId;
  const packageId = req.body?.packageId as TokenPackageId | undefined;
  const pkg = packageId ? TOKEN_PACKAGES[packageId] : undefined;
  if (!pkg) {
    return res.status(400).json({ error: "Unknown or missing packageId", availablePackages: Object.keys(TOKEN_PACKAGES) });
  }

  // ---- PAYMENT GATEWAY INJECTION POINT ----
  // This is a stub. Once Grow approves the account and GROW_API_KEY /
  // GROW_TERMINAL_ID are set, replace the block below with the real Grow
  // SDK/API call that creates a hosted checkout/payment page for
  // `pkg.priceILS`, passing `userId` + `packageId` (or `pkg.tokens`) through
  // as metadata so the webhook below can credit the right account once
  // payment clears.
  if (!GROW_API_KEY || !GROW_TERMINAL_ID) {
    logger.warn("[billing] GROW_API_KEY/GROW_TERMINAL_ID not set -- running in stub mode");
  }
  logger.info(
    { userId, packageId, priceILS: pkg.priceILS, tokens: pkg.tokens },
    "[billing] STUB: would call Grow checkout-session API here",
  );

  const sessionId = `stub_session_${userId}_${Date.now()}`;
  const checkoutUrl = `https://example-payment-gateway.local/checkout/${sessionId}`;

  res.json({ checkoutUrl, sessionId, package: { id: packageId, ...pkg } });
});

export default billingAuthRouter;

// Public: called server-to-server by the payment gateway once a payment
// clears. Must stay outside requireAuth (mount directly in app.ts, the same
// way authRouter is mounted) since the gateway has no user JWT to send.
export const billingPublicRouter: IRouter = Router();

billingPublicRouter.post("/billing/payment-webhook", async (req, res) => {
  // ---- WEBHOOK SIGNATURE VERIFICATION INJECTION POINT ----
  // Grow signs webhook payloads; once GROW_WEBHOOK_SECRET is set, verify the
  // request's signature header here and reject (401) before touching the DB
  // if it doesn't match. Skipped in stub mode since there's no real signature
  // to check yet.
  const userId = Number(req.body?.userId);
  const tokens = Number(req.body?.tokens);

  if (!Number.isFinite(userId) || !Number.isFinite(tokens) || tokens <= 0) {
    return res.status(400).json({ error: "Expected { userId: number, tokens: number > 0 }" });
  }

  const result = await db.update(usersTable)
    .set({ tokensRemaining: sql`${usersTable.tokensRemaining} + ${tokens}` })
    .where(eq(usersTable.id, userId))
    .returning({ id: usersTable.id });

  if (result.length === 0) {
    return res.status(404).json({ error: "Unknown userId" });
  }

  logger.info({ userId, tokens }, "[billing] credited tokens from payment webhook");
  res.json({ ok: true, userId, tokensAdded: tokens });
});
