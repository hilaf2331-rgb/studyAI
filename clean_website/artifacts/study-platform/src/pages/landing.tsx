import React from "react";
import { Link } from "wouter";
import { Coins, InfinityIcon, BookOpenCheck, MessageSquareText, Target, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

// Public marketing page — the / route for logged-out visitors (see App.tsx).
// Deliberately built as a single screen: compact spacing throughout so the
// whole pitch fits without forcing visitors to scroll through a long page.
export const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background" dir="rtl">
      {/* Top nav */}
      <header className="flex items-center justify-between px-4 sm:px-8 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="FocusStudy" className="w-8 h-8 object-contain" />
          <span className="text-lg font-black tracking-tight">FocusStudy</span>
        </div>
        <Link href="/login">
          <Button>התחברות / הרשמה</Button>
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8 py-6 sm:py-10">
        <div className="w-full max-w-3xl space-y-8">
          {/* Hero / Hila's story */}
          <section className="text-center space-y-3">
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight">
              FocusStudy — האתר שמפקס ומנגיש לכם<br className="hidden sm:block" /> את מה שחשוב באמת
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              היי אני הילה, והחלטתי שנמאס לי לשלם מנוי חודשי לאתרים ואפליקציות ללמידה שלא תמיד אני
              משתמשת בהם כל החודש. יש פעמים שהייתי רוצה להעלות מלא חומרים וללמוד אפילו יותר מ-5
              פעמים ביום, ויש ימים שאני לא נכנסת 3 שבועות מפני שאני בחופשה או בפגרה. ולכן החלטתי
              להקים את FocusStudy.
            </p>
          </section>

          {/* Core pillars */}
          <section className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
              <Coins className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm leading-relaxed">
                <strong className="block mb-0.5">משלמים רק על מה שמשתמשים!</strong>
                בלי התחייבות חודשית – קונים טוקנים לפי הצורך, ואין מגבלת שימוש יומית.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
              <InfinityIcon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm leading-relaxed">
                <strong className="block mb-0.5">האם הטוקנים פגים בתוקף? לא!</strong>
                אם שילמתם ותיכנסו גם אחרי שנה, הטוקנים שלכם עדיין יחכו לכם באותו המצב.
              </p>
            </div>
          </section>

          {/* Features */}
          <section className="grid sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-muted/50 p-4 space-y-1.5 text-center">
              <BookOpenCheck className="w-5 h-5 text-primary mx-auto" />
              <p className="text-sm font-semibold">סיכומים וכרטיסיות זיכרון</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                מעלים חומרי לימוד ומקבלים תמציות מדויקות ברגע.
              </p>
            </div>
            <div className="rounded-xl bg-muted/50 p-4 space-y-1.5 text-center">
              <MessageSquareText className="w-5 h-5 text-primary mx-auto" />
              <p className="text-sm font-semibold">מבחני דמה וצ'אט אינטראקטיבי</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                סימולציות מותאמות אישית שמכינות אתכם לדבר האמיתי.
              </p>
            </div>
            <div className="rounded-xl bg-muted/50 p-4 space-y-1.5 text-center">
              <Target className="w-5 h-5 text-primary mx-auto" />
              <p className="text-sm font-semibold">Rescue Questions</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                זיהוי נקודות חולשה ותרגול ממוקד כדי להציל את הציון במבחן.
              </p>
            </div>
          </section>

          {/* CTA */}
          <section className="flex justify-center pt-2">
            <Link href="/login">
              <Button size="lg" className="text-base px-8 gap-2">
                יאללה, בואו נתחיל ללמוד חכם 🚀
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
          </section>
        </div>
      </main>

      <footer className="flex items-center justify-center gap-3 text-xs text-muted-foreground py-4 border-t border-border">
        <Link href="/terms" className="hover:text-foreground hover:underline">תקנון ותנאי שימוש</Link>
        <span>•</span>
        <Link href="/privacy" className="hover:text-foreground hover:underline">מדיניות פרטיות</Link>
      </footer>
    </div>
  );
};
