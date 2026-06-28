import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n";
import { usePurchaseModal } from "@/lib/purchase-modal";
import { Coins } from "lucide-react";

// Shown wherever a 402/403 "out of tokens" response is hit (questions
// practice, exam results, ...) -- now points straight at the real purchase
// flow (see purchase-modal.tsx) instead of just explaining the beta model.
export const BetaUpsellDialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const { isRTL } = useLanguage();
  const { open: openPurchaseModal } = usePurchaseModal();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-amber-500" />
            {isRTL ? "נגמרו לך הטוקנים" : "Out of Tokens"}
          </DialogTitle>
          <DialogDescription>
            {isRTL
              ? "נגמרה לך המכסה החינמית לחודש זה. ניתן לטעון עוד טוקנים שלא פגים בסוף החודש, וימשיכו ללוות אתכם בכל הקורסים."
              : "You've used up this month's free quota. You can top up with extra tokens that never expire and carry over across all your courses."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isRTL ? "אולי בהמשך" : "Maybe later"}
          </Button>
          <Button
            className="gap-2"
            onClick={() => {
              onOpenChange(false);
              openPurchaseModal();
            }}
          >
            <Coins className="w-4 h-4" />
            {isRTL ? "טעינת טוקנים" : "Buy Tokens"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
