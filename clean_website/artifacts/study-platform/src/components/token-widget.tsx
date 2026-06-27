import React, { useEffect, useRef, useState } from "react";
import { useGetTokenBalance } from "@workspace/api-client-react";
import { Progress } from "@/components/ui/progress";
import { Coins } from "lucide-react";
import { useLanguage } from "@/lib/i18n";

// Visual token counter for the Sidebar/Header -- replaces a plain-text
// balance with a glowing icon + energy bar, since "1,847 tokens" alone gives
// a student no felt sense of whether that's a lot or a little. Briefly
// pulses gold on a balance increase and amber on a decrease so spending and
// receiving tokens registers as an event, not just a number that changed.
export const TokenWidget: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { isRTL } = useLanguage();
  const { data: balance } = useGetTokenBalance();
  const prevRef = useRef<number | null>(null);
  const [pulse, setPulse] = useState<"gain" | "spend" | null>(null);

  useEffect(() => {
    if (!balance) return undefined;
    if (prevRef.current !== null && prevRef.current !== balance.tokensRemaining) {
      setPulse(balance.tokensRemaining > prevRef.current ? "gain" : "spend");
      const timer = setTimeout(() => setPulse(null), 1000);
      prevRef.current = balance.tokensRemaining;
      return () => clearTimeout(timer);
    }
    prevRef.current = balance.tokensRemaining;
    return undefined;
  }, [balance?.tokensRemaining]);

  if (!balance) return null;

  const usedPercent = balance.monthlyTokenQuota > 0
    ? Math.min(100, Math.round(((balance.monthlyTokenQuota - balance.tokensRemaining) / balance.monthlyTokenQuota) * 100))
    : 0;

  const pulseRing = pulse === "gain"
    ? "ring-2 ring-emerald-400/80 shadow-[0_0_14px_rgba(52,211,153,0.6)]"
    : pulse === "spend"
    ? "ring-2 ring-amber-400/80 shadow-[0_0_14px_rgba(251,191,36,0.55)]"
    : "ring-0 shadow-none";

  if (compact) {
    return (
      <div
        title={isRTL ? `${balance.tokensRemaining.toLocaleString()} טוקנים נותרו` : `${balance.tokensRemaining.toLocaleString()} tokens left`}
        className={`relative w-9 h-9 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center transition-shadow duration-500 ${pulseRing}`}
      >
        <Coins className="w-5 h-5" />
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-sidebar-border bg-sidebar-accent/30 p-3 space-y-2 transition-shadow duration-500 ${pulseRing}`}>
      <div className={`flex items-center justify-between gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
        <div className={`flex items-center gap-1.5 text-amber-500 ${isRTL ? "flex-row-reverse" : ""}`}>
          <Coins className="w-4 h-4 shrink-0" />
          <span className="text-xs font-semibold">{isRTL ? "טוקנים" : "Tokens"}</span>
        </div>
        <span className="text-sm font-bold text-sidebar-foreground">{balance.tokensRemaining.toLocaleString()}</span>
      </div>
      <Progress value={100 - usedPercent} className="h-1.5" />
    </div>
  );
};
