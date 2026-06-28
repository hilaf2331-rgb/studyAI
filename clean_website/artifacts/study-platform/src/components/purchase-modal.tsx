import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/lib/i18n";
import { Coins, Sparkles, X } from "lucide-react";

type TierId = "bronze" | "silver" | "gold";

interface Tier {
  id: TierId;
  priceILS: number;
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
const TIERS: Tier[] = [
  {
    id: "bronze",
    priceILS: 39,
    nameHe: "קורס בודד",
    nameEn: "Single Course",
    tokensHe: "30 טוקנים",
    tokensEn: "30 Tokens",
    breakdownHe: "שווה ערך ל: כ-15 שעות הקלטה או כ-10 סיכומים של 50 עמודים",
    breakdownEn: "Equivalent to: ~15 hours of recordings OR ~10 summaries of 50 pages each",
    descriptionHe: "מעולה לקורס אחד קשוח במיוחד. סוגר לך פינה בדיוק איפה שצריך.",
    descriptionEn: "Great for one especially tough course. Covers exactly where you need it.",
    paypalUrl: "https://www.paypal.com/ncp/payment/WGT5M86538BJ8",
  },
  {
    id: "silver",
    priceILS: 79,
    nameHe: "חצי סמסטר",
    nameEn: "Half Semester",
    tokensHe: "70 טוקנים",
    tokensEn: "70 Tokens",
    breakdownHe: "שווה ערך ל: כ-35 שעות הקלטה או כ-25 סיכומים של 50 עמודים",
    breakdownEn: "Equivalent to: ~35 hours of recordings OR ~25 summaries of 50 pages each",
    descriptionHe: "החבילה המושלמת לקורסים המרכזיים של הסמסטר. הכי משתלמת עבורך.",
    descriptionEn: "The perfect bundle for your semester's core courses. Best value for you.",
    badgeHe: "הכי פופולרי",
    badgeEn: "Most Popular",
    paypalUrl: "https://www.paypal.com/ncp/payment/BZKAHZZ75FDFA",
  },
  {
    id: "gold",
    priceILS: 119,
    nameHe: "סמסטר מלא",
    nameEn: "Full Semester",
    tokensHe: "130 טוקנים",
    tokensEn: "130 Tokens",
    breakdownHe: "שווה ערך ל: כ-65 שעות הקלטה או כ-45 סיכומים של 50 עמודים",
    breakdownEn: "Equivalent to: ~65 hours of recordings OR ~45 summaries of 50 pages each",
    descriptionHe: "לחרשנים האמיתיים שמקליטים כל מרצה מהרגע שהוא נכנס לכיתה. שקט נפשי לכל הסמסטר.",
    descriptionEn: "For the true grinders who record every lecture from the moment it starts. Peace of mind for the whole semester.",
    paypalUrl: "https://www.paypal.com/ncp/payment/D6A29MJKM9BE4",
  },
];

// Per-tier ambient glow, always-on at low intensity and stronger on
// hover/selected -- bronze/silver/gold colors chosen to read as the
// corresponding metal rather than the app's primary brand color, so the
// three cards stay visually distinct from each other at a glance.
const TIER_GLOW: Record<TierId, string> = {
  bronze:
    "border-[#b87333]/40 shadow-[0_0_22px_-4px_rgba(184,115,51,0.45)] " +
    "hover:border-[#b87333]/80 hover:shadow-[0_0_42px_-2px_rgba(184,115,51,0.75)]",
  silver:
    "border-slate-300/50 shadow-[0_0_22px_-4px_rgba(203,213,225,0.45)] " +
    "hover:border-slate-200/90 hover:shadow-[0_0_42px_-2px_rgba(226,232,240,0.85)]",
  gold:
    "border-amber-400/45 shadow-[0_0_26px_-4px_rgba(251,191,36,0.5)] " +
    "hover:border-amber-300/90 hover:shadow-[0_0_55px_-2px_rgba(251,191,36,0.9)]",
};

const TIER_GLOW_ACTIVE: Record<TierId, string> = {
  bronze: "border-[#b87333]/80 shadow-[0_0_42px_-2px_rgba(184,115,51,0.75)]",
  silver: "border-slate-200/90 shadow-[0_0_42px_-2px_rgba(226,232,240,0.85)]",
  gold: "border-amber-300/90 shadow-[0_0_55px_-2px_rgba(251,191,36,0.9)]",
};

export const PurchaseModal: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const { isRTL } = useLanguage();
  const [activeTierId, setActiveTierId] = useState<TierId | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) setActiveTierId(null);
    onOpenChange(next);
  };

  // Synchronous, same-tab redirect triggered directly inside the click
  // handler -- keeps it a genuine user gesture so mobile browsers don't
  // block it, and lands the student straight on the hosted PayPal checkout.
  const handlePurchaseClick = (tier: Tier) => {
    window.location.href = tier.paypalUrl;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <button
          onClick={() => handleOpenChange(false)}
          aria-label={isRTL ? "חזרה" : "Back"}
          className="absolute start-4 top-4 z-10 inline-flex items-center justify-center w-8 h-8 rounded-full bg-muted text-foreground/80 hover:bg-muted/80 hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <DialogHeader className="ps-10">
          <DialogTitle className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-amber-500" />
            {isRTL ? "כרטיסיית טוקנים" : "Token Bundles"}
          </DialogTitle>
          <DialogDescription>
            {isRTL
              ? "בחר/י כרטיסייה. הטוקנים נוספים לחשבון שלך ולא יורדים בתחילת חודש חדש — נשארים לך לכל הסמסטר, וניתנים לשימוש על הקלטות, מסמכים, מצגות ועוד."
              : "Pick a token bundle. Tokens are added to your account and never reset at month-end — they're yours for the whole semester, and work across recordings, documents, slides, and more."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
          {isRTL
            ? "כרטיסיית טוקנים קבועה – הטוקנים שלכם לא פוקעים בסוף החודש ונשארים אתכם לאורך כל הסמסטר, לכל סוגי החומר!"
            : "A fixed token bundle — your tokens never expire at month-end and stay with you for the whole semester, across every type of study material!"}
        </div>

        <div className="flex flex-col sm:grid sm:grid-cols-3 gap-4 pt-5 max-h-[60vh] sm:max-h-none overflow-y-auto sm:overflow-visible px-0.5">
          {TIERS.map((tier) => {
            const isActive = activeTierId === tier.id;
            return (
              <div
                key={tier.id}
                onClick={() => setActiveTierId(tier.id)}
                className={`relative flex flex-col rounded-2xl border p-5 gap-4 bg-card transition-all duration-300 cursor-pointer hover:scale-[1.02] ${
                  isActive ? TIER_GLOW_ACTIVE[tier.id] : TIER_GLOW[tier.id]
                }`}
              >
                {(tier.badgeHe || tier.badgeEn) && (
                  <Badge className="absolute -top-3 self-center px-3" variant={tier.id === "gold" ? "default" : "secondary"}>
                    {isRTL ? tier.badgeHe : tier.badgeEn}
                  </Badge>
                )}
                <div className="text-center pt-2">
                  <p className="font-bold text-lg">{isRTL ? tier.nameHe : tier.nameEn}</p>
                  <p className="text-3xl font-black mt-1">₪{tier.priceILS}</p>
                </div>
                <div className="space-y-2 text-sm flex-1">
                  <div className="flex items-center gap-2 text-foreground font-semibold">
                    <Coins className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span>{isRTL ? tier.tokensHe : tier.tokensEn}</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    {isRTL ? tier.descriptionHe : tier.descriptionEn}
                  </p>
                  <p className="rounded-lg bg-amber-500/10 border border-amber-400/30 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 leading-snug">
                    {isRTL ? tier.breakdownHe : tier.breakdownEn}
                  </p>
                </div>
                <Button
                  className="w-full"
                  variant={tier.id === "silver" ? "default" : "outline"}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePurchaseClick(tier);
                  }}
                >
                  {isRTL ? "רכישה" : "Buy Now"}
                </Button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};
