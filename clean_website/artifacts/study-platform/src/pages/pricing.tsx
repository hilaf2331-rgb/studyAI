import React from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Coins, Sparkles, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { TIERS, type Tier, type TierId } from "@/lib/pricing-tiers";

// Stashed in localStorage right before sending a logged-out visitor to
// "/login" from here, then consumed by App.tsx's effect once `user` flips
// truthy -- same "remember what they were trying to do, resume it after
// auth resolves" pattern as shared-view.tsx's PENDING_SAVE_SHARE_ID_KEY.
export const PENDING_PURCHASE_TIER_ID_KEY = "studyai_pending_purchase_tier_id";

const TIER_GLOW: Record<TierId, string> = {
  bronze:
    "border-[#b87333]/40 shadow-[0_0_22px_-4px_rgba(184,115,51,0.45)] " +
    "hover:border-[#b87333]/80 hover:shadow-[0_0_42px_-2px_rgba(184,115,51,0.75)]",
  silver:
    "border-slate-300/50 shadow-[0_0_22px_-4px_rgba(203,213,225,0.45)] " +
    "hover:border-slate-200/90 hover:shadow-[0_0_42px_-2px_rgba(226,232,240,0.85)]",
  gold:
    "border-amber-400/45 shadow-[0_0_26px_-4px_rgba(251,191,36,0.5)] " +
    "hover:border-amber-300/90 hover:shadow-[0_0_55px_-2px_rgba(251,191,36,0.9)]",
};

// Public pricing page: reachable with no login required (see App.tsx's
// "/pricing" branch, checked alongside /terms and /privacy before the auth
// gate) so it can be linked directly from the landing page, and so a
// payment processor's approval review -- which needs to see pricing and the
// checkout flow without an account -- has somewhere to land. Buying still
// requires an account: a logged-out click stashes the chosen tier and sends
// the visitor to log in/register first; App.tsx picks the stashed tier back
// up once auth resolves and continues straight to PayPal checkout.
export const PricingPage: React.FC = () => {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const handleBuyClick = (tier: Tier) => {
    if (user) {
      window.location.href = tier.paypalUrl;
      return;
    }
    localStorage.setItem(PENDING_PURCHASE_TIER_ID_KEY, tier.id);
    setLocation("/login");
  };

  return (
    <div className="relative min-h-screen flex flex-col bg-background" dir="rtl">
      <header className="relative z-10 px-4 sm:px-10 pt-5">
        <div className="flex items-center justify-between gap-4 mx-auto max-w-4xl rounded-full border border-white/10 bg-white/5 backdrop-blur-md px-5 py-2.5 shadow-lg shadow-black/20">
          <Link href="/landing" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="FocusStudy" className="w-8 h-8 object-contain" />
            <span className="text-lg font-bold tracking-tight">FocusStudy</span>
          </Link>
          <Link href="/login">
            <Button size="sm">{user ? "לאזור האישי" : "התחברות / הרשמה"}</Button>
          </Link>
        </div>
      </header>

      <main className="relative flex-1 flex flex-col items-center px-6 sm:px-10 py-8 sm:py-12">
        <div className="w-full max-w-4xl space-y-8">
          <section className="text-center space-y-3">
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight">מחירים ומסלולים</h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
              כרטיסיית טוקנים קבועה — קונים פעם אחת, הטוקנים לא פוקעים בסוף
              החודש ונשארים לכם לכל הסמסטר. ניתנים לשימוש על הקלטות, מסמכים,
              מצגות ועוד.
            </p>
          </section>

          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300 max-w-2xl mx-auto">
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
            הטוקנים שלכם לא פוקעים בסוף החודש ונשארים אתכם לאורך כל הסמסטר, לכל סוגי החומר!
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            {TIERS.map((tier) => (
              <div
                key={tier.id}
                className={`relative flex flex-col rounded-2xl border p-5 gap-4 bg-card transition-all duration-300 ${TIER_GLOW[tier.id]}`}
              >
                {tier.badgeHe && (
                  <Badge className="absolute -top-3 self-center px-3" variant={tier.id === "gold" ? "default" : "secondary"}>
                    {tier.badgeHe}
                  </Badge>
                )}
                <div className="text-center pt-2">
                  <p className="font-bold text-lg">{tier.nameHe}</p>
                  <p className="text-3xl font-black mt-1">₪{tier.priceILS}</p>
                </div>
                <div className="space-y-2 text-sm flex-1">
                  <div className="flex items-center gap-2 text-foreground font-semibold">
                    <Coins className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span>{tier.tokensHe}</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">{tier.descriptionHe}</p>
                  <p className="rounded-lg bg-amber-500/10 border border-amber-400/30 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 leading-snug">
                    {tier.breakdownHe}
                  </p>
                </div>
                <Button
                  className="w-full"
                  variant={tier.id === "silver" ? "default" : "outline"}
                  onClick={() => handleBuyClick(tier)}
                >
                  {user ? "רכישה" : "התחברות ורכישה"}
                </Button>
              </div>
            ))}
          </div>

          <section className="flex justify-center pt-4 pb-6">
            <Link href="/login">
              <Button size="lg" className="text-base px-8 gap-2 font-bold tracking-wide">
                יאללה, בואו נתחיל
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
          </section>
        </div>
      </main>

      <footer className="relative z-10 flex items-center justify-center gap-3 text-xs text-muted-foreground py-5">
        <Link href="/terms" className="hover:text-foreground hover:underline">תקנון ותנאי שימוש</Link>
        <span>•</span>
        <Link href="/privacy" className="hover:text-foreground hover:underline">מדיניות פרטיות</Link>
      </footer>
    </div>
  );
};
