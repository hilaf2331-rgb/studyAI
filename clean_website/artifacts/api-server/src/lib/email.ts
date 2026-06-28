import { logger } from "./logger";

// Resend's HTTP API instead of SMTP -- Render blocks all outbound SMTP ports
// (25/465/587 all ETIMEDOUT), so no Nodemailer transport config can ever get
// a TCP connection out. This sends over plain HTTPS instead, which Render
// allows like any other outbound API call.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Requires focusstudy.net to be a verified sending domain in Resend (DNS
// records below) -- sending from an unverified domain gets rejected by
// Resend's API, so until verification completes, override
// CONTACT_FROM_EMAIL to their onboarding@resend.dev test sender instead.
const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || "FocusStudy <contact@focusstudy.net>";
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL || "focusstudy.net@gmail.com";

export async function sendContactMessageEmail(input: { name: string; email: string; message: string }): Promise<void> {
  if (!RESEND_API_KEY) {
    // Fail closed rather than silently dropping the message -- same
    // reasoning as the Zapier webhook in routes/billing.ts.
    logger.warn("[email] RESEND_API_KEY not set -- rejecting contact message");
    throw new Error("Contact email is not configured");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: CONTACT_FROM_EMAIL,
      to: CONTACT_TO_EMAIL,
      reply_to: input.email,
      subject: `FocusStudy Contact: ${input.name}`,
      text: `From: ${input.name} <${input.email}>\n\n${input.message}`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error({ status: res.status, body }, "[email] Resend API request failed");
    throw new Error("Failed to send contact email");
  }
}
