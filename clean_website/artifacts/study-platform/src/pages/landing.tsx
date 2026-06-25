import React from "react";
import { Link } from "wouter";
import { ArrowLeft, BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackgroundGlow } from "@/components/background-glow";
import { TokenGlyph, SummaryGlyph, ChatGlyph, RescueGlyph } from "@/components/icons";

// Public marketing page — the / route for logged-out visitors (see App.tsx).
export const LandingPage: React.FC = () => {
  return (
    <div className="relative min-h-screen flex flex-col bg-background overflow-hidden" dir="rtl">
      {/* Top nav */}
      <header className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="FocusStudy" className="w-8 h-8 object-contain" />
          <span className="text-lg font-bold tracking-tight">FocusStudy</span>
        </div>
        <Link href="/login">
          <Button>התחברות / הרשמה</Button>
        </Link>
      </header>

      <main className="relative flex-1 flex flex-col items-center px-6 sm:px-10 py-8 sm:py-12 pb-44 sm:pb-52">
        <BackgroundGlow className="top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[42rem] h-[42rem] sm:w-[58rem] sm:h-[58rem]" />
        <BackgroundGlow className="-top-20 -right-20 w-[26rem] h-[26rem] opacity-60" />

        <div className="relative z-10 w-full max-w-3xl space-y-8">
          {/* Hero / Hila's story */}
          <section className="text-center space-y-4">
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-[1.1]">
              <span className="bg-gradient-to-l from-indigo-500 via-fuchsia-500 to-amber-500 bg-clip-text text-transparent">FocusStudy</span> — האתר שמפקס ומנגיש לכם<br className="hidden sm:block" /> את מה שחשוב באמת
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              היי אני הילה, והחלטתי שנמאס לי לשלם מנוי חודשי לאתרים ואפליקציות ללמידה שלא תמיד אני
              משתמשת בהם כל החודש. יש פעמים שהייתי רוצה להעלות מלא חומרים וללמוד אפילו יותר מ-5
              פעמים ביום, ויש ימים שאני לא נכנסת 3 שבועות מפני שאני בחופשה או בפגרה. ולכן החלטתי
              להקים את FocusStudy.
            </p>
          </section>

          {/* Pricing spotlight — glowing border, the headline competitive edge */}
          <section className="relative rounded-3xl p-[2px] bg-gradient-to-l from-amber-400 via-fuchsia-500 to-indigo-500 shadow-[0_0_45px_-8px_rgba(217,70,239,0.55)] animate-[pulse_5s_ease-in-out_infinite]">
            <div className="rounded-[calc(1.5rem-2px)] bg-white/90 dark:bg-slate-900/90 backdrop-blur-md p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-5 text-center sm:text-right">
              <TokenGlyph className="w-14 h-14 shrink-0" />
              <div className="space-y-1.5">
                <h2 className="text-lg sm:text-xl font-black tracking-tight">מודל תשלום הוגן</h2>
                <p className="text-sm sm:text-base leading-relaxed text-muted-foreground">
                  משלמים רק על מה שמשתמשים! בלי התחייבות חודשית – קונים טוקנים לפי הצורך, ואין מגבלת
                  שימוש יומית. והטוקנים פגים בתוקף? <span className="font-bold text-foreground">לא!</span> הם
                  נשארים שלכם תמיד.
                </p>
              </div>
            </div>
          </section>

          {/* Adaptive AI learning */}
          <section className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md p-5 sm:p-6 flex items-start gap-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-500/20 hover:border-violet-400/50">
            <BrainCircuit className="w-10 h-10 shrink-0 text-violet-500 transition-transform duration-300 group-hover:scale-110" />
            <div className="space-y-1">
              <h3 className="font-bold text-base">למידה אדפטיבית חכמה</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                המערכת מזהה אוטומטית נקודות חולשה ומתאימה את החזרות כך שתתרגלו יותר את החומר שטעיתם בו.
              </p>
            </div>
          </section>

          {/* Core features */}
          <section className="grid sm:grid-cols-3 gap-4">
            <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md p-5 space-y-2 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-500/20 hover:border-indigo-400/50">
              <SummaryGlyph className="w-10 h-10 mx-auto transition-transform duration-300 group-hover:scale-110" />
              <p className="text-sm font-bold tracking-wide">סיכומים וכרטיסיות זיכרון מותאמות</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                מעלים חומרי לימוד ומקבלים תמציות וכרטיסיות מדויקות, נוצרות באופן מיידי.
              </p>
            </div>
            <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md p-5 space-y-2 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-pink-500/20 hover:border-pink-400/50">
              <ChatGlyph className="w-10 h-10 mx-auto transition-transform duration-300 group-hover:scale-110" />
              <p className="text-sm font-bold tracking-wide">מבחני דמה וצ'אט אינטראקטיבי</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                מתאמנים על מבחנים מדומים ושואלים את ה-AI כל שאלה שעולה לכם על החומר.
              </p>
            </div>
            <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md p-5 space-y-2 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/20 hover:border-emerald-400/50">
              <RescueGlyph className="w-10 h-10 mx-auto transition-transform duration-300 group-hover:scale-110" />
              <p className="text-sm font-bold tracking-wide">שאלות הצלה ממוקדות</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                תרגול ממוקד בדיוק בנקודות שטעיתם בהן, כדי להציל את הציון במבחן.
              </p>
            </div>
          </section>
        </div>
      </main>

      {/* Floating fixed CTA — replaces the old static wide button */}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
        <Link href="/login" className="group pointer-events-auto relative block">
          <span className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-amber-500 blur-xl opacity-60 transition-opacity duration-300 group-hover:opacity-90" />
          <Button
            className="relative h-32 w-32 sm:h-36 sm:w-36 flex-col gap-1.5 rounded-full border-0 bg-gradient-to-br from-indigo-600 via-fuchsia-600 to-amber-500 px-3 text-center text-xs font-bold leading-tight text-white shadow-2xl shadow-fuchsia-500/40 ring-4 ring-background/60 transition-all duration-300 hover:-translate-y-1 hover:shadow-fuchsia-500/60 sm:text-sm"
          >
            <span>
              יאללה בוא נתחיל
              <br />
              ללמוד חכם
            </span>
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
      </div>

      <footer className="relative z-10 flex items-center justify-center gap-3 text-xs text-muted-foreground py-5">
        <Link href="/terms" className="hover:text-foreground hover:underline">תקנון ותנאי שימוש</Link>
        <span>•</span>
        <Link href="/privacy" className="hover:text-foreground hover:underline">מדיניות פרטיות</Link>
      </footer>
    </div>
  );
};
