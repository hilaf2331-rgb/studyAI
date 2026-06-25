import React from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackgroundGlow } from "@/components/background-glow";
import { TokenGlyph, InfinityGlyph, SummaryGlyph, ChatGlyph, RescueGlyph } from "@/components/icons";

// Public marketing page — the / route for logged-out visitors (see App.tsx).
// Deliberately built as a single screen: compact spacing throughout so the
// whole pitch fits without forcing visitors to scroll through a long page.
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

      <main className="relative flex-1 flex flex-col items-center justify-center px-6 sm:px-10 py-8 sm:py-12">
        <BackgroundGlow className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[42rem] h-[42rem] sm:w-[58rem] sm:h-[58rem]" />
        <BackgroundGlow className="-top-20 -right-20 w-[26rem] h-[26rem] opacity-60" />

        <div className="relative z-10 w-full max-w-3xl space-y-10">
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

          {/* Core pillars */}
          <section className="grid sm:grid-cols-2 gap-4">
            <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md p-5 flex items-start gap-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-amber-500/20 hover:border-amber-400/50">
              <TokenGlyph className="w-9 h-9 shrink-0 transition-transform duration-300 group-hover:scale-110" />
              <p className="text-sm leading-relaxed">
                <strong className="block mb-0.5">משלמים רק על מה שמשתמשים!</strong>
                בלי התחייבות חודשית – קונים טוקנים לפי הצורך, ואין מגבלת שימוש יומית.
              </p>
            </div>
            <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md p-5 flex items-start gap-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-500/20 hover:border-violet-400/50">
              <InfinityGlyph className="w-9 h-9 shrink-0 transition-transform duration-300 group-hover:scale-110" />
              <p className="text-sm leading-relaxed">
                <strong className="block mb-0.5">האם הטוקנים פגים בתוקף? לא!</strong>
                אם שילמתם ותיכנסו גם אחרי שנה, הטוקנים שלכם עדיין יחכו לכם באותו המצב.
              </p>
            </div>
          </section>

          {/* Features */}
          <section className="grid sm:grid-cols-3 gap-4">
            <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md p-5 space-y-2 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-500/20 hover:border-indigo-400/50">
              <SummaryGlyph className="w-10 h-10 mx-auto transition-transform duration-300 group-hover:scale-110" />
              <p className="text-sm font-bold tracking-wide">סיכומים וכרטיסיות זיכרון</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                מעלים חומרי לימוד ומקבלים תמציות מדויקות ברגע.
              </p>
            </div>
            <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md p-5 space-y-2 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-pink-500/20 hover:border-pink-400/50">
              <ChatGlyph className="w-10 h-10 mx-auto transition-transform duration-300 group-hover:scale-110" />
              <p className="text-sm font-bold tracking-wide">מבחני דמה וצ'אט אינטראקטיבי</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                סימולציות מותאמות אישית שמכינות אתכם לדבר האמיתי.
              </p>
            </div>
            <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md p-5 space-y-2 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/20 hover:border-emerald-400/50">
              <RescueGlyph className="w-10 h-10 mx-auto transition-transform duration-300 group-hover:scale-110" />
              <p className="text-sm font-bold tracking-wide">Rescue Questions</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                זיהוי נקודות חולשה ותרגול ממוקד כדי להציל את הציון במבחן.
              </p>
            </div>
          </section>

          {/* CTA */}
          <section className="flex justify-center pt-2">
            <Link href="/login">
              <Button size="lg" className="text-base px-8 gap-2 font-bold tracking-wide shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5 transition-all duration-300">
                יאללה, בואו נתחיל ללמוד חכם 🚀
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
