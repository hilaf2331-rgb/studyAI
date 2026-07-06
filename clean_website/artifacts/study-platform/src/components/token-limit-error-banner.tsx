import React from "react";
import { Button } from "@/components/ui/button";
import { usePurchaseModal } from "@/lib/purchase-modal";
import { useLanguage } from "@/lib/i18n";
import { AlertCircle, Coins } from "lucide-react";

// Server-side codes that mean "this restriction lifts once the student buys
// tokens" -- RECORDING_TOO_LONG (the absolute MAX_RECORDING_SECONDS ceiling,
// lib/validation.ts) and lib/extractor.ts's YouTubeTooLongError
// (VIDEO_TOO_LONG), plus a plain 402 InsufficientTokensError response which
// carries no code. INSUFFICIENT_TOKENS_FOR_AUDIO (lib/tokens.ts's
// getAudioAffordability) is handled separately via AudioTokenLimitDialog's
// buy/partial/cancel negotiation instead of this generic banner.
const TOKEN_UPSELL_CODES = new Set(["RECORDING_TOO_LONG", "VIDEO_TOO_LONG"]);

export function isTokenUpsellError(data: { code?: string } | null | undefined, status?: number): boolean {
  if (status === 402) return true;
  return !!data?.code && TOKEN_UPSELL_CODES.has(data.code);
}

// Renders a restriction error message with a prominent "Buy Tokens" CTA next
// to it, so a student who hits the free-tier audio/duration cap (or runs out
// of tokens entirely) is never more than one click from the purchase flow.
export const TokenLimitErrorBanner: React.FC<{ message: string }> = ({ message }) => {
  const { isRTL } = useLanguage();
  const { open: openPurchaseModal } = usePurchaseModal();

  return (
    <div className="space-y-2 text-sm text-destructive bg-destructive/10 px-3 py-2.5 rounded-lg">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>{message}</span>
      </div>
      <Button size="sm" className="gap-2" onClick={openPurchaseModal}>
        <Coins className="w-4 h-4" />
        {isRTL ? "טעינת טוקנים" : "Buy Tokens"}
      </Button>
    </div>
  );
};
