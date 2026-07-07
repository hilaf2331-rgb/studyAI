export type TierId = "bronze" | "silver" | "gold";

export interface Tier {
  id: TierId;
  priceILS: number;
  tokens: number;
  nameHe: string;
  nameEn: string;
  tokensHe: string;
  tokensEn: string;
  breakdownHe: string;
  breakdownEn: string;
  descriptionHe: string;
  descriptionEn: string;
  badgeHe?: string;
  badgeEn?: string;
  paypalUrl: string;
}

// "Token Bank" (כרטיסייה) model: a fixed bucket of tokens for the semester,
// bought once, that doesn't reset or expire monthly. Tokens are a neutral
// unit -- they cover recordings AND every other material type (PDFs, docs,
// slides, etc), not just audio, so the copy below deliberately avoids
// "hours" or anything audio-specific. Each tier links directly to its own
// hosted PayPal (NCP) checkout page.
//
// Single source of truth for both components/purchase-modal.tsx (the
// in-app "buy tokens" modal) and pages/pricing.tsx (the public pricing page
// reachable from the landing page, and by a payment processor's review
// process, without logging in) -- they used to duplicate this list by hand.
//
// PAYPAL DASHBOARD SETUP (one-time, per button, not code): in each NCP
// button's settings, under the "after payment" / "return to website"
// option, set the return URL so the student lands back on the site with
// the celebration modal (see lib/purchase-celebration.tsx) already showing
// the right Token count instead of staring at a bare PayPal confirmation
// screen:
//   bronze (₪39 / 40 tokens): https://<your-domain>/?purchase=success&tokens=40
//   silver (₪79 / 80 tokens): https://<your-domain>/?purchase=success&tokens=80
//   gold   (₪119 / 150 tokens): https://<your-domain>/?purchase=success&tokens=150
export const TIERS: Tier[] = [
  {
    id: "bronze",
    priceILS: 39,
    tokens: 40,
    nameHe: "קורס בודד",
    nameEn: "Single Course",
    tokensHe: "40 טוקנים",
    tokensEn: "40 Tokens",
    breakdownHe: "שווה ערך ל: כ-20 שעות הקלטה או כ-13 סיכומים של 50 עמודים",
    breakdownEn: "Equivalent to: ~20 hours of recordings OR ~13 summaries of 50 pages each",
    descriptionHe: "מעולה לקורס אחד קשוח במיוחד. סוגר לך פינה בדיוק איפה שצריך.",
    descriptionEn: "Great for one especially tough course. Covers exactly where you need it.",
    paypalUrl: "https://www.paypal.com/ncp/payment/WGT5M86538BJ8",
  },
  {
    id: "silver",
    priceILS: 79,
    tokens: 80,
    nameHe: "חצי סמסטר",
    nameEn: "Half Semester",
    tokensHe: "80 טוקנים",
    tokensEn: "80 Tokens",
    breakdownHe: "שווה ערך ל: כ-40 שעות הקלטה או כ-27 סיכומים של 50 עמודים",
    breakdownEn: "Equivalent to: ~40 hours of recordings OR ~27 summaries of 50 pages each",
    descriptionHe: "החבילה המושלמת לקורסים המרכזיים של הסמסטר. הכי משתלמת עבורך.",
    descriptionEn: "The perfect bundle for your semester's core courses. Best value for you.",
    badgeHe: "הכי פופולרי",
    badgeEn: "Most Popular",
    paypalUrl: "https://www.paypal.com/ncp/payment/BZKAHZZ75FDFA",
  },
  {
    id: "gold",
    priceILS: 119,
    tokens: 150,
    nameHe: "סמסטר מלא",
    nameEn: "Full Semester",
    tokensHe: "150 טוקנים",
    tokensEn: "150 Tokens",
    breakdownHe: "שווה ערך ל: כ-75 שעות הקלטה או כ-50 סיכומים של 50 עמודים",
    breakdownEn: "Equivalent to: ~75 hours of recordings OR ~50 summaries of 50 pages each",
    descriptionHe: "לחרשנים האמיתיים שמקליטים כל מרצה מהרגע שהוא נכנס לכיתה. שקט נפשי לכל הסמסטר.",
    descriptionEn: "For the true grinders who record every lecture from the moment it starts. Peace of mind for the whole semester.",
    paypalUrl: "https://www.paypal.com/ncp/payment/D6A29MJKM9BE4",
  },
];

export function getTierById(id: string | null | undefined): Tier | undefined {
  return TIERS.find((t) => t.id === id);
}
