import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PartyPopper, Sparkles, X } from "lucide-react";
import { useLanguage } from "@/lib/i18n";

// Mounted once near the app root (see App.tsx). PayPal's hosted (NCP)
// checkout buttons are each configured with their own "Return to website"
// URL, so the tier's hour count comes back encoded right on the redirect --
// e.g. "?purchase=success&hours=70" -- rather than needing any shared
// tier-id -> hours mapping between the frontend and the webhook.
export const PurchaseSuccessCelebration: React.FC = () => {
  const { isRTL } = useLanguage();
  const [hours, setHours] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("purchase") !== "success") return;
    const hoursValue = Number(params.get("hours"));
    setHours(Number.isFinite(hoursValue) && hoursValue > 0 ? hoursValue : null);

    params.delete("purchase");
    params.delete("hours");
    const query = params.toString();
    const newUrl = window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
    window.history.replaceState(null, "", newUrl);
  }, []);

  if (hours === null) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => setHours(null)}
      >
        <motion.div
          dir={isRTL ? "rtl" : "ltr"}
          className="relative flex max-w-md flex-col items-center gap-4 rounded-3xl border border-emerald-400/40 bg-card p-8 text-center shadow-[0_0_60px_-10px_rgba(16,185,129,0.6)]"
          initial={{ opacity: 0, scale: 0.8, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.85, y: 20 }}
          transition={{ type: "spring", stiffness: 280, damping: 22 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setHours(null)}
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

          <p className="text-xl font-bold leading-relaxed">
            {isRTL
              ? <>תודה רבה שקנית! 🎉<br />איזה כיף, התווספו לך <span className="text-emerald-500">{hours} שעות</span> לחשבון!<br />בהצלחה בלימודים! ✨</>
              : <>Thank you so much for your purchase! 🎉<br /><span className="text-emerald-500">{hours} hours</span> have been added to your account!<br />Good luck with your studies! ✨</>}
          </p>

          <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-500">
            <Sparkles className="h-4 w-4" />
            {isRTL ? "השעות שלך מוכנות לשימוש" : "Your hours are ready to use"}
            <Sparkles className="h-4 w-4" />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
