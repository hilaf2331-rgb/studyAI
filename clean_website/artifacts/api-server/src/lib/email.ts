import { logger } from "./logger";

// Brevo's HTTP API instead of SMTP -- Render's free/Starter plan blocks all
// outbound SMTP ports (25/465/587 all ETIMEDOUT) regardless of destination,
// so no Nodemailer transport config can ever get a TCP connection out. This
// sends over plain HTTPS instead, which Render allows like any other
// outbound API call. Brevo only requires verifying a single sender email
// address (Settings -> Senders, no DNS records needed), unlike providers
// that require full domain verification before they'll send anything.
const BREVO_API_KEY = process.env.BREVO_API_KEY?.trim();
// .trim() guards against a stray trailing space/newline from pasting into
// Render's env var editor -- Brevo does an exact string match against the
// account's verified senders list, so even invisible whitespace here is
// enough to produce "sender ... is not valid" despite the dashboard showing
// the address as verified.
const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL?.trim() || "contact@focusstudy.net";
const CONTACT_FROM_NAME = process.env.CONTACT_FROM_NAME?.trim() || "FocusStudy";
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL?.trim() || "focusstudy.net@gmail.com";

export async function sendContactMessageEmail(input: { name: string; email: string; message: string }): Promise<void> {
  if (!BREVO_API_KEY) {
    // Fail closed rather than silently dropping the message -- same
    // reasoning as the Zapier webhook in routes/billing.ts.
    logger.warn("[email] BREVO_API_KEY not set -- rejecting contact message");
    throw new Error("Contact email is not configured");
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: CONTACT_FROM_EMAIL, name: CONTACT_FROM_NAME },
      to: [{ email: CONTACT_TO_EMAIL }],
      replyTo: { email: input.email, name: input.name },
      subject: `FocusStudy Contact: ${input.name}`,
      textContent: `From: ${input.name} <${input.email}>\n\n${input.message}`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Logs the exact sender string Brevo rejected (not just that it failed)
    // so a "sender is not valid" error can be diffed character-for-character
    // against the dashboard's verified-senders list instead of guessing.
    logger.error({ status: res.status, body, sentFrom: CONTACT_FROM_EMAIL }, "[email] Brevo API request failed");
    throw new Error("Failed to send contact email");
  }
}
