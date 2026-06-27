import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

// Token packages planned for purchase once a payment gateway (Cardcom) is
// under contract. Kept here so the frontend/copy can reference package
// shapes ahead of time, but no checkout or webhook logic is wired to real
// money yet -- see BETA_MODE below.
export const TOKEN_PACKAGES = {
  starter: { tokens: 50_000, priceILS: 19 },
  standard: { tokens: 150_000, priceILS: 49 },
  pro: { tokens: 500_000, priceILS: 129 },
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

// Public: will be called server-to-server by the payment gateway once a
// payment clears. Must stay outside requireAuth (mount directly in app.ts,
// the same way authRouter is mounted) since the gateway has no user JWT to
// send -- which is exactly why this route is fully gated until there is a
// real signature to verify. Previously this accepted a bare
// { userId, tokens } body with no verification at all, letting anyone credit
// arbitrary tokens to any account; it now refuses every request unless
// billing is explicitly enabled AND a signature secret is configured.
export const billingPublicRouter: IRouter = Router();

billingPublicRouter.post("/billing/payment-webhook", async (req, res) => {
  const webhookSecret = process.env.CARDCOM_WEBHOOK_SECRET;
  if (BETA_MODE || !webhookSecret) {
    logger.warn("[billing] payment-webhook called while billing is disabled or unconfigured -- rejecting");
    return res.status(404).json({ error: "Not found" });
  }

  // ---- WEBHOOK SIGNATURE VERIFICATION INJECTION POINT ----
  // Cardcom signs webhook payloads. Verify the request's signature header
  // against `webhookSecret` here and reject (401) before touching the DB if
  // it doesn't match -- do not credit tokens based on an unverified body.
  const signature = req.headers["x-cardcom-signature"];
  if (!signature) {
    return res.status(401).json({ error: "Missing webhook signature" });
  }

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
