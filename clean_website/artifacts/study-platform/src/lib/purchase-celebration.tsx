import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { PurchaseSuccessCelebration } from "@/components/purchase-success-celebration";

interface PurchaseCelebrationContextValue {
  show: (tokensAdded: number) => void;
}

const PurchaseCelebrationContext = createContext<PurchaseCelebrationContextValue | null>(null);

// Mounted once near the app root (see App.tsx) so the real PayPal
// return-redirect (parsed from the URL below) can trigger the success modal
// through one shared show() call.
export function PurchaseCelebrationProvider({ children }: { children: React.ReactNode }) {
  const [tokensAdded, setTokensAdded] = useState<number | null>(null);
  const show = useCallback((tokens: number) => setTokensAdded(tokens), []);

  // PayPal's hosted (NCP) checkout buttons are each configured in PayPal's
  // own dashboard with a "Return to website" URL (see purchase-modal.tsx's
  // TIERS comment for the exact URL to set per tier) that lands the student
  // back on the app with "?purchase=success&tokens=N" on the query string --
  // the tier's token count comes back encoded right on the redirect rather
  // than needing any shared tier-id -> tokens mapping between the frontend
  // and the webhook. Runs on every route since the return URL can land on
  // any page (dashboard, landing, etc).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("purchase") !== "success") return;
    const tokensValue = Number(params.get("tokens"));
    if (Number.isFinite(tokensValue) && tokensValue > 0) show(tokensValue);

    params.delete("purchase");
    params.delete("tokens");
    const query = params.toString();
    const newUrl = window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
    window.history.replaceState(null, "", newUrl);
  }, [show]);

  return (
    <PurchaseCelebrationContext.Provider value={{ show }}>
      {children}
      <PurchaseSuccessCelebration tokensAdded={tokensAdded} onClose={() => setTokensAdded(null)} />
    </PurchaseCelebrationContext.Provider>
  );
}

export function usePurchaseCelebration(): PurchaseCelebrationContextValue {
  const ctx = useContext(PurchaseCelebrationContext);
  if (!ctx) throw new Error("usePurchaseCelebration must be used within a PurchaseCelebrationProvider");
  return ctx;
}
