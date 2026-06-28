import React, { createContext, useCallback, useContext, useState } from "react";
import { PurchaseModal } from "@/components/purchase-modal";

interface PurchaseModalContextValue {
  open: () => void;
  close: () => void;
}

const PurchaseModalContext = createContext<PurchaseModalContextValue | null>(null);

// Mounted once near the root (see App.tsx) so any page/component -- sidebar,
// profile, an "out of tokens" error banner -- can open the purchase flow via
// usePurchaseModal().open() without prop-drilling a callback down to it.
export function PurchaseModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <PurchaseModalContext.Provider value={{ open, close }}>
      {children}
      <PurchaseModal open={isOpen} onOpenChange={setIsOpen} />
    </PurchaseModalContext.Provider>
  );
}

export function usePurchaseModal(): PurchaseModalContextValue {
  const ctx = useContext(PurchaseModalContext);
  if (!ctx) throw new Error("usePurchaseModal must be used within a PurchaseModalProvider");
  return ctx;
}
