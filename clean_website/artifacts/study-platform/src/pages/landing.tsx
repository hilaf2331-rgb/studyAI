import React from "react";
import { Link } from "wouter";
import { ArrowLeft, RotateCw, Users, ShieldCheck, BookMarked, FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackgroundGlow } from "@/components/background-glow";
import { WaveField } from "@/components/wave-field";
import { TokenGlyph, InfinityGlyph, FlashcardGlyph, RescueGlyph } from "@/components/icons";

// Public marketing page — the / route for logged-out visitors (see App.tsx).
export const LandingPage: React.FC = () => {
  return (
    <div className="relative min-h-screen flex flex-col bg-background overflow-hidden" dir="rtl">
      {/* Top nav — pill capsule, glass-blurred over the dark background */}
      <header className="relative z-10 px-4 sm:px-10 pt-5">
        <div className="flex items-center justify-between gap-4 mx-auto max-w-4xl rounded-full border border-white/10 bg-white/5 backdrop-blur-md px-5 py-2.5 shadow-lg shadow-black/20">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="FocusStudy" className="w-8 h-8 object-contain" />
            <span className="text-lg font-bold tracking-tight">FocusStudy</span>
          </div>
          <Link href="/login">
            <Button size="sm">התחברות / הרשמה</Button>
          </Link>
        </div>
      </header>

      <main className="relative flex-1 flex flex-col items-center px-6 sm:px-10 py-8 sm:py-12">
        <BackgroundGlow className="top-0 left-1/2 -translate-x-1/2 w-[42rem] h-[42rem] sm:w-[58rem] sm:h-[58rem] opacity-60" />
        <BackgroundGlow className="top-[60rem] -right-20 w-[26rem] h-[26rem] opacity-40" />
        <WaveField className="absolute top-[14rem] sm:top-[18rem] left-0 w-full h-[26rem] opacity-80" />

        <div className="relative z-10 w-full max-w-3xl space-y-20">
          {/* Hero */}
          <section className="text-center space-y-5 pt-4 sm:pt-8">
            <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-[1.1]">
              מעלים חומר לימוד —<br className="hidden sm:block" /> מקבלים{" "}
              <span
                style={{
                  backgroundImage: "linear-gradient(to left, hsl(170 75% 50%), hsl(195 85% 55%), hsl(217 85% 60%))",
                  backgroundClip: "text",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  color: "#22d3ee",
                }}
              >
                ערכת לימוד מלאה
              </span>
              .<br className="hidden sm:block" /> תוך שניות.
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              PDF, מצגת, סרטון YouTube, טקסט או הקלטה קולית — מה שיש לכם.
              <br />
              FocusStudy בונה מזה סיכום, כרטיסיות זיכרון וחידון תרגול,
              מוכנים ללמידה כבר ברגע שהעלאתם את החומר.
            </p>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <Link href="/login">
                <Button size="lg" className="text-base px-8 gap-2 font-bold tracking-wide hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5 transition-all duration-300">
                  יאללה, מעלים חומר ראשון
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <a href="#why-focusstudy">
                <Button size="lg" variant="outline" className="text-base px-8 font-bold tracking-wide">
                  למה FocusStudy?
                </Button>
              </a>
            </div>
          </section>

          {/* Why FocusStudy */}
          <section id="why-focusstudy" className="space-y-6 scroll-mt-24">
            <h2 className="text-2xl sm:text-3xl font-bold text-center tracking-tight">למה FocusStudy?</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 space-y-2 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-teal-500/20 hover:border-teal-400/50">
                <FlashcardGlyph className="w-10 h-10 mx-auto transition-transform duration-300 group-hover:scale-110" />
                <p className="text-sm font-bold tracking-wide">ערכת לימוד מיידית</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  לא צריך ללחוץ שוב ושוב. מעלים פעם אחת, ומקבלים סיכום, כרטיסיות
                  וחידון תרגול — בלי שום הגדרה נוספת.
                </p>
              </div>
              <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 space-y-2 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/20 hover:border-emerald-400/50">
                <RescueGlyph className="w-10 h-10 mx-auto transition-transform duration-300 group-hover:scale-110" />
                <p className="text-sm font-bold tracking-wide">★ Rescue Questions — המורה הפרואקטיבי שלכם</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  טעיתם בתרגול? FocusStudy מזהה בדיוק איפה נפלתם, ובונה שאלות
                  ממוקדות שתוקפות רק את הנקודות החלשות שלכם — לפני המבחן, לא אחריו.
                </p>
              </div>
              <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 space-y-2 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-blue-500/20 hover:border-blue-400/50">
                <RotateCw className="w-10 h-10 mx-auto text-cyan-500 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.75} />
                <p className="text-sm font-bold tracking-wide">חזרה מרווחת שמזכירה לכם מה לחזור עליו</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  אלגוריתם חזרה מרווחת קובע מתי הזמן הנכון לחזור על כל כרטיסייה —
                  כל מה שמגיע לחזרה היום מחכה לכם במקום אחד.
                </p>
              </div>
            </div>
          </section>

          {/* Token pillars */}
          <section className="grid sm:grid-cols-2 gap-4">
            <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 flex items-start gap-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-amber-500/20 hover:border-amber-400/50">
              <TokenGlyph className="w-9 h-9 shrink-0 transition-transform duration-300 group-hover:scale-110" />
              <p className="text-sm leading-relaxed">
                <strong className="block mb-0.5">משלמים רק על מה שמשתמשים!</strong>
                בלי התחייבות חודשית – קונים טוקנים לפי הצורך, ואין מגבלת שימוש יומית.
              </p>
            </div>
            <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 flex items-start gap-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-blue-500/20 hover:border-blue-400/50">
              <InfinityGlyph className="w-9 h-9 shrink-0 transition-transform duration-300 group-hover:scale-110" />
              <p className="text-sm leading-relaxed">
                <strong className="block mb-0.5">האם הטוקנים פגים בתוקף? לא!</strong>
                אם שילמתם ותיכנסו גם אחרי שנה, הטוקנים שלכם עדיין יחכו לכם באותו המצב.
              </p>
            </div>
          </section>

          {/* Accuracy & Glossary — trust section: the AI is grounded strictly
              in the user's own uploaded materials/glossary, never guessing
              or inventing facts from general knowledge. */}
          <section className="space-y-6 scroll-mt-24">
            <h2 className="text-2xl sm:text-3xl font-bold text-center tracking-tight">
              דיוק מוחלט — אפס ניחושים
            </h2>
            <div className="rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-6 sm:p-8">
              <div className="grid sm:grid-cols-2 gap-6 items-center">
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="w-7 h-7 text-emerald-500 shrink-0" strokeWidth={1.75} />
                    <p className="text-lg font-bold tracking-tight">
                      הסיכום מבוסס רק על מה שהעליתם
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    בניגוד לצ'אטבוטים כלליים שמשלימים פערים מהידע הכללי שלהם,
                    FocusStudy לא מנחש. הוא קורא בקפידה את החומר שהעליתם — ההרצאה,
                    המאמר, המצגת — ובונה את הסיכום, הכרטיסיות והשאלות אך ורק
                    מהמקור הזה.
                  </p>
                </div>
                <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-400/30 p-4">
                  <BookMarked className="w-7 h-7 text-emerald-500 shrink-0" strokeWidth={1.75} />
                  <p className="text-sm leading-relaxed">
                    <strong className="block mb-0.5">המינוח של המרצה שלכם — לא מינוח כללי</strong>
                    מעלים את הגלוסר או רשימת המושגים של הקורס, ו-FocusStudy
                    ישתמש בדיוק במונחים ובהגדרות שלכם, כדי שהסיכום ידבר באותה
                    שפה שתידרשו לה במבחן.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Community Sharing — promotes saveSharedMaterial/shared-view.tsx,
              the existing feature that lets a classmate save someone else's
              shared study kit straight into their own materials. */}
          <section className="space-y-6 scroll-mt-24">
            <h2 className="text-2xl sm:text-3xl font-bold text-center tracking-tight">
              לומדים ביחד, חוסכים ביחד
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 space-y-2 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-500/20 hover:border-violet-400/50">
                <Users className="w-9 h-9 text-violet-500 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.75} />
                <p className="text-sm font-bold tracking-wide">שולחים לחברים בלינק אחד</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  כל ערכת לימוד שיצרתם אפשר לשתף עם חבר/ה לקורס בלינק פשוט —
                  הם נכנסים, רואים את הסיכום, הכרטיסיות והחידון, ושומרים אותם
                  ישר לחומרי הלימוד שלהם בלחיצה אחת.
                </p>
              </div>
              <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 space-y-2 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-pink-500/20 hover:border-pink-400/50">
                <FileCheck2 className="w-9 h-9 text-pink-500 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.75} />
                <p className="text-sm font-bold tracking-wide">בונים מאגר קורס ביחד</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  כשכל הכיתה משתפת את הסיכומים שלה, נוצר מאגר חומרים מצטבר
                  לכל הקורס — פעם אחת מעלים את ההרצאה, וכולם נהנים מערכת
                  לימוד מלאה עליה.
                </p>
              </div>
            </div>
          </section>

          {/* Founder story — moved below the fold as a trust-building section */}
          <section className="text-center space-y-3 max-w-2xl mx-auto">
            <p className="text-xs font-bold tracking-wide text-primary uppercase">הסיפור מאחורי FocusStudy</p>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              היי, אני הילה. הקמתי את FocusStudy כי נמאס לי לשלם מנוי חודשי
              לאתרי למידה שלא תמיד השתמשתי בהם כל החודש — יש תקופות שרציתי
              ללמוד 5 פעמים ביום, ויש שבועות שלא נכנסתי כלל כי הייתי בחופשה.
              לכן בניתי מערכת שעובדת לפי טוקנים: משלמים רק על מה שמשתמשים,
              והטוקנים לא פגים בתוקף — אף פעם.
            </p>
          </section>

          {/* Final CTA */}
          <section className="flex justify-center pt-2 pb-6">
            <Link href="/login">
              <Button size="lg" className="text-base px-8 gap-2 font-bold tracking-wide shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5 transition-all duration-300">
                יאללה, בואו נתחיל ללמוד חכם
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
