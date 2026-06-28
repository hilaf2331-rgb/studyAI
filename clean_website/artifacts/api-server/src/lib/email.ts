import nodemailer from "nodemailer";
import { logger } from "./logger";

// Gmail SMTP, authenticated with an App Password (not the account password --
// see https://myaccount.google.com/apppasswords). CONTACT_EMAIL_USER is the
// sending account; defaults to the support inbox itself so a single Gmail
// account can both send and receive contact-form mail.
const CONTACT_EMAIL_USER = process.env.CONTACT_EMAIL_USER;
const CONTACT_EMAIL_PASSWORD = process.env.CONTACT_EMAIL_PASSWORD;
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL || "focusstudy.net@gmail.com";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!CONTACT_EMAIL_USER || !CONTACT_EMAIL_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      // Explicit host/587/STARTTLS instead of `service: "gmail"` (which
      // resolves to port 465 implicit TLS) -- some hosts (Render/Vercel)
      // restrict outbound IPv6, and Node's default DNS lookup can hand back
      // an IPv6 address for smtp.gmail.com, hanging the connection until the
      // socket timeout. `family: 4` pins DNS resolution to IPv4 so that
      // never happens.
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTLS: true,
      family: 4,
      connectionTimeout: 10_000,
      auth: { user: CONTACT_EMAIL_USER, pass: CONTACT_EMAIL_PASSWORD },
    });
  }
  return transporter;
}

export async function sendContactMessageEmail(input: { name: string; email: string; message: string }): Promise<void> {
  const mailer = getTransporter();
  if (!mailer) {
    // Fail closed rather than silently dropping the message -- same
    // reasoning as the Zapier webhook in routes/billing.ts.
    logger.warn("[email] CONTACT_EMAIL_USER/CONTACT_EMAIL_PASSWORD not set -- rejecting contact message");
    throw new Error("Contact email is not configured");
  }
  await mailer.sendMail({
    from: `"FocusStudy Contact Form" <${CONTACT_EMAIL_USER}>`,
    to: CONTACT_TO_EMAIL,
    replyTo: input.email,
    subject: `FocusStudy Contact: ${input.name}`,
    text: `From: ${input.name} <${input.email}>\n\n${input.message}`,
  });
}
