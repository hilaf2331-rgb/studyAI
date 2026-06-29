import { AnimatePresence, motion } from "framer-motion";
import { PartyPopper, Sparkles, Coins, X } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import { useGetTokenBalance, getGetTokenBalanceQueryKey } from "@workspace/api-client-react";

// Purely presentational -- driven by usePurchaseCelebration().show() (see
// lib/purchase-celebration.tsx), which both the real PayPal return-redirect
// and the admin Test Mode bypass call into, so every successful purchase
// (real or test) ends up showing this exact same "feel-good" moment.
export const PurchaseSuccessCelebration: React.FC<{ tokensAdded: number | null; onClose: () => void }> = ({ tokensAdded, onClose }) => {
  const { isRTL } = useLanguage();
  // Refetches on every open so the total shown is never the stale
  // pre-purchase balance -- the crediting transaction has already committed
  // server-side by the time this modal can possibly be showing.
  const { data: balance } = useGetTokenBalance({ query: { queryKey: getGetTokenBalanceQueryKey(), enabled: tokensAdded !== null } });

  if (tokensAdded === null) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          dir={isRTL ? "rtl" : "ltr"}
          className="relative flex max-w-md flex-col items-center gap-5 rounded-3xl border-2 border-emerald-400/50 bg-card p-8 text-center shadow-[0_0_80px_-10px_rgba(16,185,129,0.7)]"
          initial={{ opacity: 0, scale: 0.8, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.85, y: 20 }}
          transition={{ type: "spring", stiffness: 280, damping: 22 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            aria-label={isRTL ? "סגירה" : "Close"}
            className="absolute end-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground/80 transition-colors hover:bg-muted/80 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>

          <motion.div
            animate={{ rotate: [0, -12, 12, -8, 8, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, repeatDelay: 1.4 }}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500"
          >
            <PartyPopper className="h-9 w-9" />
          </motion.div>

          <div className="space-y-1">
            <p className="text-xl font-bold leading-relaxed">
              {isRTL ? "תודה רבה על הרכישה!" : "Thanks for your purchase!"}
            </p>
            <p className="text-base text-muted-foreground leading-relaxed">
              {isRTL
                ? <>הטוקנים שלך נוספו בהצלחה: <span className="font-bold text-emerald-500">{tokensAdded} טוקנים</span> 🎉</>
                : <>Your tokens have been added successfully: <span className="font-bold text-emerald-500">{tokensAdded} Tokens</span> 🎉</>}
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-5 py-4"
          >
            <Coins className="h-6 w-6 text-emerald-500 shrink-0" />
            <div className={isRTL ? "text-right" : "text-left"}>
              <p className="text-xs font-medium text-muted-foreground">
                {isRTL ? "היתרה החדשה שלך" : "Your new balance"}
              </p>
              <p className="text-2xl font-black text-emerald-500">
                {balance ? `${balance.totalTokens} ${isRTL ? "טוקנים" : "Tokens"}` : "..."}
              </p>
            </div>
          </motion.div>

          <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-500">
            <Sparkles className="h-4 w-4" />
            {isRTL ? "הטוקנים שלך מוכנים לשימוש" : "Your tokens are ready to use"}
            <Sparkles className="h-4 w-4" />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
