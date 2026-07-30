import fetch from "node-fetch";
import { logger } from "./logger";

const HYP_BASE_URL = "https://pay.hyp.co.il/p/";

function requireHypCredentials(): { masof: string; key: string; passP: string } {
  const masof = process.env.HYP_MASOF;
  const key = process.env.HYP_API_KEY;
  const passP = process.env.HYP_API_PASSWORD;
  if (!masof || !key || !passP) {
    throw new Error("HYP_MASOF / HYP_API_KEY / HYP_API_PASSWORD environment variables are required");
  }
  return { masof, key, passP };
}

export interface CreateHypPaymentPageInput {
  amountILS: number;
  order: string;
  clientName?: string;
  email?: string;
  info?: string;
  pageLang?: "HEB" | "ENG";
}

// Builds a Hyp Pay hosted payment page URL for a single immediate charge.
// Two-step handshake per Hyp's docs (developers.hyp.co.il/pay, "Creating a
// Payment Page"): an action=APISign&What=SIGN request returns the exact same
// params back plus a `signature`, which must be re-appended verbatim (same
// params, same order, no re-encoding) to pay.hyp.co.il to get the actual
// payment form URL.
export async function createHypPaymentUrl(input: CreateHypPaymentPageInput): Promise<string> {
  const { masof, key, passP } = requireHypCredentials();

  const params = new URLSearchParams();
  params.set("action", "APISign");
  params.set("What", "SIGN");
  params.set("Sign", "True");
  params.set("KEY", key);
  params.set("PassP", passP);
  params.set("Masof", masof);
  params.set("Amount", String(input.amountILS));
  params.set("Coin", "1"); // ILS
  params.set("Order", input.order);
  params.set("PageLang", input.pageLang ?? "HEB");
  if (input.clientName) params.set("ClientName", input.clientName);
  if (input.email) params.set("email", input.email);
  if (input.info) params.set("Info", input.info);

  const res = await fetch(`${HYP_BASE_URL}?${params.toString()}`);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Hyp APISign request failed: ${res.status} ${body}`);
  }

  const parsed = new URLSearchParams(body);
  if (!parsed.get("signature")) {
    logger.warn({ body }, "[hyp] APISign response missing signature");
    throw new Error("Hyp APISign response did not include a signature");
  }

  // Per Hyp's docs: append the *entire* raw response to the base URL as-is
  // (same params, same order) -- no re-parsing or re-encoding.
  return `${HYP_BASE_URL}?${body}`;
}

// Confirms a payment-completion redirect actually came from Hyp (and wasn't
// tampered with in the browser) by echoing every param Hyp sent back to
// their own action=APISign&What=VERIFY endpoint -- Hyp's documented
// server-side validation step. `rawQueryString` must be the exact, still-
// percent-encoded query string Hyp sent on the redirect (same params, same
// order), not a re-serialized copy.
export async function verifyHypReturn(rawQueryString: string): Promise<boolean> {
  const { masof, key, passP } = requireHypCredentials();

  const prefix = new URLSearchParams();
  prefix.set("action", "APISign");
  prefix.set("What", "VERIFY");
  prefix.set("Masof", masof);
  prefix.set("KEY", key);
  prefix.set("PassP", passP);

  const res = await fetch(`${HYP_BASE_URL}?${prefix.toString()}&${rawQueryString}`);
  const body = await res.text();
  if (!res.ok) {
    logger.warn({ status: res.status, body }, "[hyp] VERIFY request failed");
    return false;
  }
  const parsed = new URLSearchParams(body);
  return parsed.get("CCode") === "0";
}
