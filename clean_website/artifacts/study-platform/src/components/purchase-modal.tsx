import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useSaveBitName } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Clock, ArrowRight, ArrowLeft, CheckCircle2, X } from "lucide-react";
import { PaymentLauncher } from "@/components/payment-launcher";

// EDIT THIS: the real Bit/PayBox payment links, once issued. Drives both the
// mobile deep-link buttons and the desktop QR code in PaymentLauncher below.
const BIT_PAYMENT_LINK = "https://www.bitpay.co.il/app/me/REPLACE_WITH_REAL_BIT_LINK";
const PAYBOX_PAYMENT_LINK = "https://payboxapp.page.link/REPLACE_WITH_REAL_PAYBOX_LINK";
// EDIT THIS (optional): a hosted checkout page from a clearing gateway
// (Meshulam / Cardcom / Grow by Mashash) to offer as a desktop fallback
// instead of/alongside the QR code. Leave empty to hide that button.
const HOSTED_CHECKOUT_URL = "";

type TierId = "bronze" | "silver" | "gold";

interface Tier {
  id: TierId;
  priceILS: number;
  nameHe: string;
  nameEn: string;
  hoursHe: string;
  hoursEn: string;
  descriptionHe: string;
  descriptionEn: string;
  badgeHe?: string;
  badgeEn?: string;
}

// "Hour Bank" (כרטיסייה) model: a fixed bucket of recording hours for the
// semester, bought once, that doesn't reset or expire monthly.
const TIERS: Tier[] = [
  {
    id: "bronze",
    priceILS: 39,
    nameHe: "קורס בודד",
    nameEn: "Single Course",
    hoursHe: "30 שעות הקלטה",
    hoursEn: "30 Hours of Recording",
    descriptionHe: "מעולה לקורס אחד קשוח במיוחד. סוגר לך פינה בדיוק איפה שצריך.",
    descriptionEn: "Great for one especially tough course. Covers exactly where you need it.",
  },
  {
    id: "silver",
    priceILS: 79,
    nameHe: "חצי סמסטר",
    nameEn: "Half Semester",
    hoursHe: "70 שעות הקלטה",
    hoursEn: "70 Hours of Recording",
    descriptionHe: "החבילה המושלמת לקורסים המרכזיים של הסמסטר. הכי משתלמת עבורך.",
    descriptionEn: "The perfect bundle for your semester's core courses. Best value for you.",
    badgeHe: "הכי פופולרי",
    badgeEn: "Most Popular",
  },
  {
    id: "gold",
    priceILS: 119,
    nameHe: "סמסטר מלא",
    nameEn: "Full Semester",
    hoursHe: "130 שעות הקלטה",
    hoursEn: "130 Hours of Recording",
    descriptionHe: "לחרשנים האמיתיים שמקליטים כל מרצה מהרגע שהוא נכנס לכיתה. שקט נפשי לכל הסמסטר.",
    descriptionEn: "For the true grinders who record every lecture from the moment it starts. Peace of mind for the whole semester.",
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

type Step = "tiers" | "bit-name" | "instructions";

export const PurchaseModal: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const { isRTL } = useLanguage();
  const { toast } = useToast();
  const saveBitName = useSaveBitName();
  const [step, setStep] = useState<Step>("tiers");
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [activeTierId, setActiveTierId] = useState<TierId | null>(null);
  const [bitName, setBitName] = useState("");

  const BackArrow = isRTL ? ArrowRight : ArrowLeft;

  const reset = () => {
    setStep("tiers");
    setSelectedTier(null);
    setActiveTierId(null);
    setBitName("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handlePurchaseClick = (tier: Tier) => {
    setSelectedTier(tier);
    setStep("bit-name");
  };

  const handleBitNameSubmit = () => {
    const trimmed = bitName.trim();
    if (!trimmed) return;
    saveBitName.mutate({ data: { bitName: trimmed } }, {
      onSuccess: () => setStep("instructions"),
      onError: () => {
        toast({
          description: isRTL ? "שמירת השם נכשלה. נסה שנית." : "Failed to save your name. Please try again.",
          variant: "destructive",
        });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={`max-h-[90vh] overflow-y-auto ${step === "tiers" ? "sm:max-w-3xl" : "sm:max-w-md"}`}>
        {step === "tiers" && (
          <>
            <button
              onClick={() => handleOpenChange(false)}
              aria-label={isRTL ? "חזרה" : "Back"}
              className="absolute start-4 top-4 z-10 inline-flex items-center justify-center w-8 h-8 rounded-full bg-muted text-foreground/80 hover:bg-muted/80 hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <DialogHeader className="ps-10">
              <DialogTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-500" />
                {isRTL ? "כרטיסיית שעות" : "Hour Bundles"}
              </DialogTitle>
              <DialogDescription>
                {isRTL
                  ? "בחר/י כרטיסייה. השעות נוספות לחשבון שלך ולא יורדות בתחילת חודש חדש — נשארות לך לכל הסמסטר."
                  : "Pick an hour bundle. Hours are added to your account and never reset at month-end — they're yours for the whole semester."}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col sm:grid sm:grid-cols-3 gap-4 pt-2 max-h-[60vh] sm:max-h-none overflow-y-auto sm:overflow-visible px-0.5">
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
                        <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span>{isRTL ? tier.hoursHe : tier.hoursEn}</span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">
                        {isRTL ? tier.descriptionHe : tier.descriptionEn}
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
                      {isRTL ? "רכישה" : "Purchase"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {step === "bit-name" && selectedTier && (
          <>
            <DialogHeader>
              <DialogTitle>{isRTL ? "שם ב-Bit / PayBox" : "Your Bit / PayBox Name"}</DialogTitle>
              <DialogDescription>
                {isRTL
                  ? `כדי שנדע לזהות את התשלום שלך עבור חבילת ${selectedTier.nameHe} (₪${selectedTier.priceILS}), הכנס/י את השם המוצג באפליקציית Bit או PayBox שלך.`
                  : `So we can match your payment for the ${selectedTier.nameEn} package (₪${selectedTier.priceILS}), enter the display name on your Bit or PayBox app.`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 pt-2">
              <Label htmlFor="bit-name-input">{isRTL ? "שם ב-Bit/PayBox" : "Bit/PayBox name"}</Label>
              <Input
                id="bit-name-input"
                value={bitName}
                onChange={(e) => setBitName(e.target.value)}
                placeholder={isRTL ? "לדוגמה: דניאל כהן" : "e.g. Dana Cohen"}
                autoFocus
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="gap-2" onClick={() => setStep("tiers")}>
                <BackArrow className="w-4 h-4" />
                {isRTL ? "חזרה" : "Back"}
              </Button>
              <Button className="flex-1" disabled={!bitName.trim() || saveBitName.isPending} onClick={handleBitNameSubmit}>
                {saveBitName.isPending ? (isRTL ? "שומר..." : "Saving...") : (isRTL ? "המשך לתשלום" : "Continue to Payment")}
              </Button>
            </div>
          </>
        )}

        {step === "instructions" && selectedTier && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                {isRTL ? "צעד אחד אחרון" : "One Last Step"}
              </DialogTitle>
              <DialogDescription>
                {isRTL
                  ? `שלח/י ₪${selectedTier.priceILS} בדיוק דרך Bit או PayBox לקישור שלמטה. השעות יתווספו לחשבונך אוטומטית לאחר אישור התשלום.`
                  : `Send exactly ₪${selectedTier.priceILS} via Bit or PayBox using the link below. Hours will be added to your account automatically once the payment is confirmed.`}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center gap-4 py-2">
              <PaymentLauncher
                bitLink={BIT_PAYMENT_LINK}
                payboxLink={PAYBOX_PAYMENT_LINK}
                hostedCheckoutUrl={HOSTED_CHECKOUT_URL || undefined}
                isRTL={isRTL}
              />
              <p className="text-xs text-muted-foreground text-center">
                {isRTL
                  ? "נדרשים מספר רגעים לעיבוד התשלום. ניתן לסגור חלון זה."
                  : "Payments may take a few minutes to process. You can safely close this window."}
              </p>
            </div>

            <Button variant="outline" className="w-full" onClick={() => handleOpenChange(false)}>
              {isRTL ? "סגור" : "Close"}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
