import fetch from "node-fetch";
import { logger } from "./logger";

const PAYPAL_API_BASE = process.env.PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

let cachedToken: { value: string; expiresAt: number } | null = null;

// PayPal OAuth2 client-credentials tokens are valid for ~9h. Cached in this
// process so a webhook delivery never blocks on a fresh token exchange,
// refreshed a minute early to avoid using one that expires mid-request.
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET environment variables are required");
  }

  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new Error(`PayPal OAuth token request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

export interface PaypalWebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
}

// Confirms a webhook event actually came from PayPal by calling PayPal's own
// verification endpoint, rather than reimplementing the cert-chain signature
// check ourselves -- this is PayPal's officially recommended approach and
// avoids having to pin/rotate their signing certs on our side.
export async function verifyPaypalWebhookSignature(headers: PaypalWebhookHeaders, webhookEvent: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    logger.warn("[paypal] PAYPAL_WEBHOOK_ID is unset -- refusing to verify webhook");
    return false;
  }

  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algo: headers.authAlgo,
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSig,
      transmission_time: headers.transmissionTime,
      webhook_id: webhookId,
      webhook_event: webhookEvent,
    }),
  });

  if (!res.ok) {
    logger.warn({ status: res.status }, "[paypal] verify-webhook-signature request failed");
    return false;
  }
  const data = (await res.json()) as { verification_status?: string };
  return data.verification_status === "SUCCESS";
}

export interface PaypalOrderDetails {
  id: string;
  status: string;
  payerEmail: string | null;
  amountValue: string;
  currencyCode: string;
}

// A PAYMENT.CAPTURE.COMPLETED event's own payload has no payer email --
// fetching the parent order is the one authoritative call that returns both
// a confirmed amount AND the payer's email together, instead of trusting
// whatever happens to be on the webhook body itself.
export async function getPaypalOrderDetails(orderId: string): Promise<PaypalOrderDetails | null> {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    logger.warn({ status: res.status, orderId }, "[paypal] failed to fetch order details");
    return null;
  }
  const data = (await res.json()) as any;
  const purchaseUnit = data.purchase_units?.[0];
  return {
    id: data.id,
    status: data.status,
    payerEmail: data.payer?.email_address ?? null,
    amountValue: purchaseUnit?.amount?.value ?? "0",
    currencyCode: purchaseUnit?.amount?.currency_code ?? "ILS",
  };
}
