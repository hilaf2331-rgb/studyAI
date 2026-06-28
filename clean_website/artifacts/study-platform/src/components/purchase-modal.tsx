import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useSaveBitName } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Coins, Clock, BookOpenText, ArrowRight, ArrowLeft, CheckCircle2 } from "lucide-react";

// EDIT THIS: the real Bit/PayBox payment link, once issued. Used both as
// the tappable "Pay Now" link and as the source for the QR code rendered
// below it, so updating this one constant updates both.
const BIT_PAYMENT_LINK = "https://www.bitpay.co.il/app/me/REPLACE_WITH_REAL_BIT_LINK";

type TierId = "bronze" | "silver" | "gold";

interface Tier {
  id: TierId;
  priceILS: number;
  nameHe: string;
  nameEn: string;
  hoursHe: string;
  hoursEn: string;
  summariesHe: string;
  summariesEn: string;
  badgeHe?: string;
  badgeEn?: string;
}

const TIERS: Tier[] = [
  {
    id: "bronze",
    priceILS: 19,
    nameHe: "ברונזה",
    nameEn: "Bronze",
    hoursHe: "~2 שעות הקלטה",
    hoursEn: "~2 Lecture Hours",
    summariesHe: "(או ~6 סיכומי קריאה)",
    summariesEn: "(or ~6 Reading Summaries)",
  },
  {
    id: "silver",
    priceILS: 39,
    nameHe: "כסף",
    nameEn: "Silver",
    hoursHe: "~5.5 שעות הקלטה",
    hoursEn: "~5.5 Lecture Hours",
    summariesHe: "(או ~16 סיכומי קריאה)",
    summariesEn: "(or ~16 Reading Summaries)",
    badgeHe: "הכי פופולרי",
    badgeEn: "Most Popular",
  },
  {
    id: "gold",
    priceILS: 79,
    nameHe: "זהב",
    nameEn: "Gold",
    hoursHe: "~14 שעות הקלטה",
    hoursEn: "~14 Lecture Hours",
    summariesHe: "(או ~40 סיכומי קריאה)",
    summariesEn: "(or ~40 Reading Summaries)",
    badgeHe: "הכי משתלם — סמסטר שלם",
    badgeEn: "Best Value — Full Semester",
  },
];

type Step = "tiers" | "bit-name" | "instructions";

export const PurchaseModal: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const { isRTL } = useLanguage();
  const { toast } = useToast();
  const saveBitName = useSaveBitName();
  const [step, setStep] = useState<Step>("tiers");
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [bitName, setBitName] = useState("");

  const BackArrow = isRTL ? ArrowRight : ArrowLeft;

  const reset = () => {
    setStep("tiers");
    setSelectedTier(null);
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

  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(BIT_PAYMENT_LINK)}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={step === "tiers" ? "sm:max-w-3xl" : "sm:max-w-md"}>
        {step === "tiers" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Coins className="w-5 h-5 text-amber-500" />
                {isRTL ? "טעינת טוקנים" : "Buy Tokens"}
              </DialogTitle>
              <DialogDescription>
                {isRTL
                  ? "בחר/י חבילה. הטוקנים נוספים לחשבון שלך ולא יורדים בתחילת חודש חדש."
                  : "Pick a package. Purchased tokens are added to your account and never expire at month-end."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid sm:grid-cols-3 gap-4 pt-2">
              {TIERS.map((tier) => (
                <div
                  key={tier.id}
                  className={`relative flex flex-col rounded-2xl border p-5 gap-4 ${
                    tier.id === "silver" ? "border-primary shadow-lg shadow-primary/10" : "border-border"
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
                    <div className="flex items-center gap-2 text-foreground">
                      <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span>{isRTL ? tier.hoursHe : tier.hoursEn}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <BookOpenText className="w-4 h-4 shrink-0" />
                      <span>{isRTL ? tier.summariesHe : tier.summariesEn}</span>
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    variant={tier.id === "silver" ? "default" : "outline"}
                    onClick={() => handlePurchaseClick(tier)}
                  >
                    {isRTL ? "רכישה" : "Purchase"}
                  </Button>
                </div>
              ))}
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
                  ? `שלח/י ₪${selectedTier.priceILS} בדיוק דרך Bit או PayBox לקישור שלמטה. הטוקנים יתווספו לחשבונך אוטומטית לאחר אישור התשלום.`
                  : `Send exactly ₪${selectedTier.priceILS} via Bit or PayBox using the link below. Tokens will be added to your account automatically once the payment is confirmed.`}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center gap-4 py-2">
              <img src={qrSrc} alt="Bit/PayBox QR" className="w-44 h-44 rounded-lg border" />
              <a
                href={BIT_PAYMENT_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-primary underline break-all text-center"
              >
                {BIT_PAYMENT_LINK}
              </a>
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
