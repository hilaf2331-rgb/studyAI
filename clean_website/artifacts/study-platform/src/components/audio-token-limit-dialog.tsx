import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n";
import { Coins, Scissors, Download } from "lucide-react";

function formatMinutes(seconds: number): number {
  return Math.floor(seconds / 60);
}

interface AudioTokenLimitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestedSeconds: number;
  affordableSeconds: number;
  tokensNeeded: number;
  tokensAvailable: number;
  onBuyTokens: () => void; // opens the existing purchase modal (usePurchaseModal)
  onContinuePartial: () => void; // resubmit with confirmedProcessSeconds = affordableSeconds
  // Only passed by recorder.tsx (the live-mic flow) -- the browser already
  // holds the recorded Blob in memory, so "cancel" there can offer a local
  // download instead of just discarding the take. material-new.tsx's file
  // was already on the user's own disk, so re-downloading it is meaningless
  // -- that caller omits this prop and the button is left out entirely.
  onDownloadInstead?: () => void;
}

// Shown when the backend's 402 INSUFFICIENT_TOKENS_FOR_AUDIO response tells
// us the user's token balance can't cover the whole recording's transcription
// cost (see getAudioAffordability in the api-server's lib/tokens.ts) --
// negotiates a way forward instead of just failing the upload outright: buy
// more tokens, process only the affordable prefix, or cancel (with an
// optional local download for the live-recording flow, since that Blob would
// otherwise just be discarded).
export const AudioTokenLimitDialog: React.FC<AudioTokenLimitDialogProps> = ({
  open,
  onOpenChange,
  requestedSeconds,
  affordableSeconds,
  tokensNeeded,
  tokensAvailable,
  onBuyTokens,
  onContinuePartial,
  onDownloadInstead,
}) => {
  const { isRTL } = useLanguage();
  const requestedMinutes = formatMinutes(requestedSeconds);
  const affordableMinutes = formatMinutes(affordableSeconds);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={isRTL ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-amber-500" />
            {isRTL ? "אין מספיק טוקנים להקלטה כולה" : "Not Enough Tokens for the Whole Recording"}
          </DialogTitle>
          <DialogDescription>
            {isRTL
              ? `ההקלטה שלך היא כ-${requestedMinutes} דקות (נדרשים כ-${tokensNeeded} טוקנים), אך יש לך רק ${tokensAvailable} טוקנים זמינים. עם היתרה הנוכחית ניתן לתמלל כ-${affordableMinutes} דקות.`
              : `Your recording is about ${requestedMinutes} minutes (about ${tokensNeeded} Tokens needed), but you only have ${tokensAvailable} Tokens available. Your current balance covers about ${affordableMinutes} minutes.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="gap-2 w-full" onClick={onBuyTokens}>
            <Coins className="w-4 h-4" />
            {isRTL ? "קנה טוקנים" : "Buy Tokens"}
          </Button>
          <Button variant="outline" className="gap-2 w-full" onClick={onContinuePartial}>
            <Scissors className="w-4 h-4" />
            {isRTL ? `המשך עם ${affordableMinutes} הדקות הראשונות` : `Continue with the first ${affordableMinutes} minutes`}
          </Button>
          {onDownloadInstead && (
            <Button variant="outline" className="gap-2 w-full" onClick={onDownloadInstead}>
              <Download className="w-4 h-4" />
              {isRTL ? "הורד את ההקלטה למחשב וותר על העיבוד" : "Download the recording and skip processing"}
            </Button>
          )}
          <Button variant="ghost" className="w-full" onClick={() => onOpenChange(false)}>
            {isRTL ? "ביטול" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
