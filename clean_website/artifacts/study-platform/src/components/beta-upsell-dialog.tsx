import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n";
import { Sparkles } from "lucide-react";

// Shown wherever a 402/403 "out of tokens" response previously offered a
// real purchase flow. There is no payment gateway wired up yet (see
// api-server/src/routes/billing.ts), so this explains the beta token model
// instead of pointing at a checkout that doesn't exist.
export const BetaUpsellDialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const { isRTL } = useLanguage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {isRTL ? "נגמרו לך הטוקנים" : "Out of Tokens"}
          </DialogTitle>
          <DialogDescription>
            {isRTL
              ? "המערכת נמצאת כרגע בגרסת בטא והשימוש בה מוגבל למלאי הטוקנים הקיים. קיבלתם כמות נדיבה מאוד של טוקנים כדי להתחיל ללמוד, ובעתיד תתווסף אפשרות לרכישת טוקנים נוספים במידת הצורך."
              : "The platform is currently in a free beta phase, and usage is limited to your existing token balance. You received a generous amount of tokens to get started, and the option to purchase additional tokens will be added in the future."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            {isRTL ? "הבנתי" : "Got it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
