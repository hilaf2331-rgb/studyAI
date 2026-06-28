import React, { useCallback, useEffect, useRef, useState } from "react";
import { Smartphone, ExternalLink, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

type DeepLinkState = "idle" | "attempting" | "stalled";

// Triggers a same-tab, synchronous navigation (no window.open / target=_blank)
// so iOS/Android can treat it as a genuine user gesture and intercept it as a
// Universal/App Link. If the app opens, the tab is usually backgrounded
// (visibilitychange/pagehide fire) before the timeout; otherwise we surface a
// manual fallback so the user is never stuck on a frozen click.
function useDeepLink(url: string, timeoutMs = 3000) {
  const [state, setState] = useState<DeepLinkState>("idle");
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.hidden) clearTimer();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", clearTimer);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", clearTimer);
      clearTimer();
    };
  }, [clearTimer]);

  const launch = useCallback(() => {
    setState("attempting");
    // Must run synchronously inside the click handler, no await before this line.
    window.location.href = url;
    timerRef.current = window.setTimeout(() => {
      if (!document.hidden) setState("stalled");
    }, timeoutMs);
  }, [url, timeoutMs]);

  const reset = useCallback(() => {
    clearTimer();
    setState("idle");
  }, [clearTimer]);

  return { state, launch, reset };
}

interface AppLaunchButtonProps {
  label: string;
  url?: string;
  fallbackLabel: string;
  isRTL: boolean;
}

const AppLaunchButton: React.FC<AppLaunchButtonProps> = ({ label, url, fallbackLabel, isRTL }) => {
  const { state, launch } = useDeepLink(url || "", 3000);
  if (!url) return null;

  return (
    <div className="space-y-2">
      <Button
        type="button"
        className="w-full gap-2 font-bold"
        disabled={state === "attempting"}
        onClick={launch}
      >
        <Smartphone className="w-4 h-4" />
        {label}
      </Button>
      {state === "stalled" && (
        <a
          href={url}
          className="flex items-center justify-center gap-1.5 text-sm font-medium text-primary underline text-center"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {fallbackLabel}
        </a>
      )}
    </div>
  );
};

interface PaymentLauncherProps {
  bitLink?: string;
  payboxLink?: string;
  hostedCheckoutUrl?: string;
  isRTL: boolean;
}

// Mobile: real, same-tab deep-link buttons per provider, each with its own
// stalled-state fallback. Desktop: QR code(s) to scan with a phone, plus an
// optional hosted-checkout-gateway button (Meshulam/Cardcom/Grow) once one is
// wired up.
export const PaymentLauncher: React.FC<PaymentLauncherProps> = ({ bitLink, payboxLink, hostedCheckoutUrl, isRTL }) => {
  const [mobile] = useState(isMobileDevice);

  if (mobile) {
    return (
      <div className="flex flex-col gap-3 w-full">
        <AppLaunchButton
          label={isRTL ? "פתח באפליקציית Bit" : "Open in Bit"}
          url={bitLink}
          fallbackLabel={isRTL ? "האפליקציה לא נפתחה? לחצו כאן" : "App didn't open? Click here"}
          isRTL={isRTL}
        />
        <AppLaunchButton
          label={isRTL ? "פתח באפליקציית PayBox" : "Open in PayBox"}
          url={payboxLink}
          fallbackLabel={isRTL ? "האפליקציה לא נפתחה? לחצו כאן" : "App didn't open? Click here"}
          isRTL={isRTL}
        />
      </div>
    );
  }

  const qrLink = bitLink || payboxLink;
  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {qrLink && (
        <div className="flex flex-col items-center gap-2">
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrLink)}`}
            alt="Bit/PayBox QR"
            className="w-44 h-44 rounded-lg border"
          />
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <QrCode className="w-3.5 h-3.5" />
            {isRTL ? "סרקו עם הטלפון כדי לפתוח את האפליקציה" : "Scan with your phone to open the app"}
          </p>
        </div>
      )}
      {hostedCheckoutUrl && (
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2 font-bold"
          onClick={() => { window.location.href = hostedCheckoutUrl; }}
        >
          <ExternalLink className="w-4 h-4" />
          {isRTL ? "מעבר לדף תשלום מאובטח" : "Continue to secure checkout"}
        </Button>
      )}
    </div>
  );
};
