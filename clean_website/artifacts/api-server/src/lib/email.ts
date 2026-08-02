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
const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL?.trim() || "focusstudy.net@gmail.com";
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

const REMINDER_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL?.trim() || "focusstudy.net@gmail.com";
const REMINDER_FROM_NAME = process.env.CONTACT_FROM_NAME?.trim() || "FocusStudy";
const APP_URL = process.env.FRONTEND_URL?.trim() || "https://focusstudy.net";

export interface DailyReminderInput {
  to: string;
  name: string | null;
  dueCardsCount: number;
  upcomingExam: { materialTitle: string; daysLeft: number } | null;
}

// Sent by routes/cron.ts's /cron/daily-reminders, once a day at most per
// user (see users.lastReminderEmailSentAt). Reuses the same Brevo HTTP-API
// sender as the contact form -- same reasoning: Render blocks outbound SMTP.
export async function sendDailyReminderEmail(input: DailyReminderInput): Promise<void> {
  if (!BREVO_API_KEY) {
    logger.warn("[email] BREVO_API_KEY not set -- skipping daily reminder email");
    throw new Error("Reminder email is not configured");
  }

  const greeting = input.name ? `היי ${input.name},` : "היי,";
  const lines: string[] = [];
  if (input.upcomingExam) {
    const { materialTitle, daysLeft } = input.upcomingExam;
    const dayWord = daysLeft === 1 ? "מחר" : daysLeft === 0 ? "היום" : `בעוד ${daysLeft} ימים`;
    lines.push(`המבחן ב"${materialTitle}" ${dayWord} — מצב מרתון פעיל עליו.`);
  }
  if (input.dueCardsCount > 0) {
    lines.push(`יש לך ${input.dueCardsCount} כרטיסיות שמחכות לחזרה היום.`);
  }
  const body = lines.join(" ");

  const subject = input.upcomingExam
    ? `המבחן ב"${input.upcomingExam.materialTitle}" מתקרב`
    : "יש לך כרטיסיות לחזרה היום";

  const textContent = `${greeting}\n\n${body}\n\nלחזרה: ${APP_URL}/daily-review\n\n— FocusStudy\n\nלא רוצה לקבל את התזכורות האלה? אפשר לכבות אותן בעמוד הפרופיל.`;
  const htmlContent = `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
      <p style="font-size: 16px;">${greeting}</p>
      <p style="font-size: 15px; line-height: 1.6;">${body}</p>
      <p style="margin: 24px 0;">
        <a href="${APP_URL}/daily-review" style="background: #0d9488; color: #ffffff; padding: 10px 20px; border-radius: 999px; text-decoration: none; font-weight: bold;">לחזרה עכשיו</a>
      </p>
      <p style="font-size: 12px; color: #6b7280;">לא רוצה לקבל את התזכורות האלה? אפשר לכבות אותן ב<a href="${APP_URL}/profile">עמוד הפרופיל</a>.</p>
    </div>
  `;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: REMINDER_FROM_EMAIL, name: REMINDER_FROM_NAME },
      to: [{ email: input.to }],
      subject,
      textContent,
      htmlContent,
    }),
  });

  if (!res.ok) {
    const responseBody = await res.text().catch(() => "");
    logger.error({ status: res.status, body: responseBody, to: input.to }, "[email] Brevo daily reminder request failed");
    throw new Error("Failed to send daily reminder email");
  }
}
