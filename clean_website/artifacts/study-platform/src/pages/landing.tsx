import React from "react";
import { Link } from "wouter";
import {
  ArrowLeft, RotateCw, Users, ShieldCheck, BookMarked, FileCheck2,
  Mic, MessageSquare, Trophy, FolderOpen, Headphones,
  GaugeCircle, Flame, ClipboardList, Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackgroundGlow } from "@/components/background-glow";
import { WaveField } from "@/components/wave-field";
import { TokenGlyph, InfinityGlyph, FlashcardGlyph, RescueGlyph } from "@/components/icons";

const FeatureCard = ({
  icon,
  title,
  body,
  glow = "teal",
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  glow?: string;
}) => {
  const glowMap: Record<string, string> = {
    teal:   "hover:shadow-teal-500/20   hover:border-teal-400/50",
    emerald:"hover:shadow-emerald-500/20 hover:border-emerald-400/50",
    blue:   "hover:shadow-blue-500/20   hover:border-blue-400/50",
    violet: "hover:shadow-violet-500/20 hover:border-violet-400/50",
    pink:   "hover:shadow-pink-500/20   hover:border-pink-400/50",
    amber:  "hover:shadow-amber-500/20  hover:border-amber-400/50",
    cyan:   "hover:shadow-cyan-500/20   hover:border-cyan-400/50",
    rose:   "hover:shadow-rose-500/20   hover:border-rose-400/50",
  };
  return (
    <div className={`group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 space-y-2.5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${glowMap[glow] ?? glowMap.teal}`}>
      <div className="transition-transform duration-300 group-hover:scale-110 w-fit">{icon}</div>
      <p className="text-sm font-bold tracking-wide">{title}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
};

export const LandingPage: React.FC = () => {
  return (
    <div className="relative min-h-screen flex flex-col bg-background overflow-hidden" dir="rtl">
      {/* Nav */}
      <header className="relative z-10 px-4 sm:px-10 pt-5">
        <div className="flex items-center justify-between gap-4 mx-auto max-w-4xl rounded-full border border-white/10 bg-white/5 backdrop-blur-md px-5 py-2.5 shadow-lg shadow-black/20">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="FocusStudy" className="w-8 h-8 object-contain" />
            <span className="text-lg font-bold tracking-tight">FocusStudy</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Hidden below sm: on a narrow phone width, two extra text
                links plus the button overflow this rounded-full pill and
                wrap onto a second line, breaking the nav's shape -- tablet/
                desktop have the room, mobile visitors can still reach both
                via the footer links further down the page. */}
            <Link href="/pricing" className="hidden sm:inline-block text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-2">
              מחירים
            </Link>
            <Link href="/contact" className="hidden sm:inline-block text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-2">
              צור קשר
            </Link>
            <Link href="/login">
              <Button size="sm">התחברות / הרשמה</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="relative flex-1 flex flex-col items-center px-6 sm:px-10 py-8 sm:py-12">
        <BackgroundGlow className="top-0 left-1/2 -translate-x-1/2 w-[42rem] h-[42rem] sm:w-[58rem] sm:h-[58rem] opacity-60" />
        <BackgroundGlow className="top-[60rem] -right-20 w-[26rem] h-[26rem] opacity-40" />
        <WaveField className="absolute top-[14rem] sm:top-[18rem] left-0 w-full h-[26rem] opacity-80" />

        <div className="relative z-10 w-full max-w-3xl space-y-20">

          {/* ─── Hero ─── */}
          <section className="text-center space-y-5 pt-4 sm:pt-8">
            <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-[1.1]">
              מעלים חומר לימוד —<br className="hidden sm:block" /> מקבלים{" "}
              <span
                style={{
                  backgroundImage: "linear-gradient(to left, hsl(172 55% 52%), hsl(196 60% 56%), hsl(218 65% 62%))",
                  backgroundClip: "text",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  color: "#5eead4",
                }}
              >
                ערכת לימוד מלאה
              </span>
              .<br className="hidden sm:block" /> תוך שניות.
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              PDF, מצגת, סרטון YouTube, טקסט או הקלטה קולית — מה שיש לכם.
              <br />
              FocusStudy בונה מזה סיכום, כרטיסיות זיכרון, חידון תרגול ומבחן מלא עם ציון —
              מוכנים ללמידה כבר ברגע שהעלאתם.
            </p>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <Link href="/login">
                <Button size="lg" className="text-base px-8 gap-2 font-bold tracking-wide hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5 transition-all duration-300">
                  יאללה, מעלים חומר ראשון
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <a href="#all-features">
                <Button size="lg" variant="outline" className="text-base px-8 font-bold tracking-wide">
                  כל הפיצ׳רים
                </Button>
              </a>
            </div>
          </section>

          {/* ─── 3 core pillars ─── */}
          <section id="why-focusstudy" className="space-y-6 scroll-mt-24">
            <h2 className="text-2xl sm:text-3xl font-bold text-center tracking-tight">למה FocusStudy?</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 space-y-2 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-teal-500/20 hover:border-teal-400/50">
                <FlashcardGlyph className="w-10 h-10 mx-auto transition-transform duration-300 group-hover:scale-110" />
                <p className="text-sm font-bold tracking-wide">ערכת לימוד מיידית</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  מעלים פעם אחת — ומקבלים סיכום, כרטיסיות, חידון תרגול ומבחן
                  מלא עם ציון, בלי שום הגדרה נוספת.
                </p>
              </div>
              <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 space-y-2 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/20 hover:border-emerald-400/50">
                <RescueGlyph className="w-10 h-10 mx-auto transition-transform duration-300 group-hover:scale-110" />
                <p className="text-sm font-bold tracking-wide">★ Rescue Questions — המורה הפרואקטיבי שלכם</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  טעיתם בתרגול? FocusStudy מזהה בדיוק איפה נפלתם ובונה שאלות
                  ממוקדות שתוקפות רק את הנקודות החלשות — לפני המבחן, לא אחריו.
                </p>
              </div>
              <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 space-y-2 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-blue-500/20 hover:border-blue-400/50">
                <RotateCw className="w-10 h-10 mx-auto text-cyan-500 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.75} />
                <p className="text-sm font-bold tracking-wide">חזרה מרווחת שמזכירה לכם מה לחזור עליו</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  אלגוריתם SM-2 קובע מתי הזמן הנכון לחזור על כל כרטיסייה —
                  כל מה שמגיע לחזרה היום מחכה לכם במקום אחד.
                </p>
              </div>
            </div>
          </section>

          {/* ─── All features grid ─── */}
          <section id="all-features" className="space-y-6 scroll-mt-24">
            <h2 className="text-2xl sm:text-3xl font-bold text-center tracking-tight">
              כל כלי הלמידה — במקום אחד
            </h2>
            <p className="text-sm text-muted-foreground text-center max-w-xl mx-auto">
              לא אפליקציה עם פיצ׳ר אחד. כל מה שצריך לסמסטר שלם.
            </p>

            <div className="grid sm:grid-cols-2 gap-4">

              <FeatureCard
                glow="blue"
                icon={<Trophy className="w-9 h-9 text-yellow-500" strokeWidth={1.75} />}
                title="מבחן מלא עם ציון"
                body="מעבר לחידון תרגול — FocusStudy יוצר מבחן אמיתי עם שאלות פתוחות ורב-ברירה, מציג ציון בסוף ומראה בדיוק על אילו שאלות טעיתם ומדוע."
              />

              <FeatureCard
                glow="violet"
                icon={<FolderOpen className="w-9 h-9 text-violet-500" strokeWidth={1.75} />}
                title="קורסים — ניהול כל הסמסטר"
                body="מאגדים את כל חומרי הקורס (מרובה הרצאות) תחת קורס אחד. מילון מונחים משותף לכל הקורס, ומבחן קורס ענק שמערבב שאלות מכל החומרים — בלחיצה אחת."
              />

              <FeatureCard
                glow="cyan"
                icon={<MessageSquare className="w-9 h-9 text-cyan-500" strokeWidth={1.75} />}
                title="צ׳אט עם החומר שלכם"
                body="שאלה שנשארה פתוחה אחרי הסיכום? פותחים צ׳אט עם ה-AI ושואלים בדיוק מה שרוצים — הוא עונה אך ורק על בסיס המידע שהעליתם, לא מהידע הכללי שלו."
              />

              <FeatureCard
                glow="emerald"
                icon={<Headphones className="w-9 h-9 text-emerald-500" strokeWidth={1.75} />}
                title="פודקאסט מהחומר שלכם"
                body="הופכים כל חומר לימוד לפרק פודקאסט שאפשר להאזין לו בדרך לאוניברסיטה, בחדר כושר, או בכל מקום אחר — ה-AI קורא את ההרצאה בקול."
              />

              <FeatureCard
                glow="rose"
                icon={<Flame className="w-9 h-9 text-rose-500" strokeWidth={1.75} />}
                title="מצב מרתון לפני הבחינה"
                body="חוששים לגבי הבחינה ונשאר לכם 24 שעות? מצב מרתון נותן ביטחון ברגע האחרון — השאלות והידע עם הכי הרבה טעויות במהלך הלמידה חוזרים ביתר תדירות עד לרגע הכניסה לבחינה."
              />

              <FeatureCard
                glow="amber"
                icon={<GaugeCircle className="w-9 h-9 text-amber-500" strokeWidth={1.75} />}
                title="ציון מוכנות לבחינה"
                body="FocusStudy מחשב כמה אחוזים מהחומר אתם באמת מוכנים עליו, על בסיס היסטוריית הביצועים בכרטיסיות ובחידונים — כדי שתדעו בדיוק על מה צריך לעבוד."
              />

              <FeatureCard
                glow="teal"
                icon={<Mic className="w-9 h-9 text-teal-500" strokeWidth={1.75} />}
                title="הקלטת הרצאות ישירות מהאתר"
                body="לא הספקתם לעקוב אחרי המרצה? מקליטים ישירות מהאתר — FocusStudy מתמלל, מסכם ובונה ערכת לימוד מלאה מההקלטה בלבד, כך שתקבלו בדיוק מה שהיה בשיעור מסוכם ומוכן."
              />

            </div>

            {/* Mini-features strip */}
            <div className="rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5">
              <p className="text-xs font-bold text-muted-foreground mb-3 tracking-wide">ועוד כמה דברים שתשמחו לדעת:</p>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
                {[
                  { icon: <Brain className="w-4 h-4 text-cyan-500 shrink-0" />, text: "תמיכה באנגלית ובעברית, ואפילו כשהשפה מעורבבת!" },
                  { icon: <ClipboardList className="w-4 h-4 text-violet-500 shrink-0" />, text: "מילון קורס — מוסיפים מונחים מיוחדים לקורס פעם אחת, ו-FocusStudy משתמש בהם בכל יצירת ערכת לימוד" },
                  { icon: <Flame className="w-4 h-4 text-rose-500 shrink-0" />, text: "רצף לימוד — מעקב אחר כמה ימים רצופים למדתם. ככל שתכנסו כל יום כך יהיה לכם סטרייק!" },
                  { icon: <Users className="w-4 h-4 text-violet-500 shrink-0" />, text: "שיתוף בלינק — אחד מקליט את המרצה. כל החברים מקבלים סיכום וכרטיסיות בלחיצה אחת" },
                  { icon: <RotateCw className="w-4 h-4 text-teal-500 shrink-0" />, text: "חזרה יומית — כל הכרטיסיות לחזרה יומית מחכות במקום אחד" },
                  { icon: <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />, text: "ה-AI עונה רק מהחומר שלכם — אפס ניחושים מהידע הכללי" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2 py-1">
                    {item.icon}
                    <p className="text-xs text-muted-foreground leading-relaxed">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ─── Token pillars ─── */}
          <section className="grid sm:grid-cols-2 gap-4">
            <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 flex items-start gap-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-amber-500/20 hover:border-amber-400/50">
              <TokenGlyph className="w-9 h-9 shrink-0 transition-transform duration-300 group-hover:scale-110" />
              <p className="text-sm leading-relaxed">
                <strong className="block mb-0.5">משלמים רק על מה שמשתמשים!</strong>
                בלי התחייבות חודשית — קונים אסימונים לפי הצורך, ואין מגבלת שימוש יומית.
              </p>
            </div>
            <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 flex items-start gap-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-blue-500/20 hover:border-blue-400/50">
              <InfinityGlyph className="w-9 h-9 shrink-0 transition-transform duration-300 group-hover:scale-110" />
              <p className="text-sm leading-relaxed">
                <strong className="block mb-0.5">האסימונים לא פגים — אף פעם!</strong>
                אם שילמתם ותיכנסו גם אחרי שנה, האסימונים שלכם עדיין יחכו לכם באותו המצב.
              </p>
            </div>
          </section>

          {/* ─── Accuracy & Glossary ─── */}
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
                    בניגוד לצ׳אטבוטים כלליים שמשלימים פערים מהידע הכללי שלהם,
                    FocusStudy לא מנחש. הוא קורא בקפידה את החומר שהעליתם — ההרצאה,
                    המאמר, המצגת — ובונה את הסיכום, הכרטיסיות והשאלות אך ורק
                    מהמקור הזה.
                  </p>
                </div>
                <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-400/30 p-4">
                  <BookMarked className="w-7 h-7 text-emerald-500 shrink-0" strokeWidth={1.75} />
                  <p className="text-sm leading-relaxed">
                    <strong className="block mb-0.5">המינוח של המרצה שלכם — לא מינוח כללי</strong>
                    מעלים את המילון של הקורס, ו-FocusStudy ישתמש בדיוק במונחים
                    ובהגדרות שלכם — הסיכום ידבר באותה שפה שתידרשו לה במבחן.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ─── Community ─── */}
          <section className="space-y-6 scroll-mt-24">
            <h2 className="text-2xl sm:text-3xl font-bold text-center tracking-tight">
              לומדים ביחד, חוסכים ביחד
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 space-y-2 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-500/20 hover:border-violet-400/50">
                <Users className="w-9 h-9 text-violet-500 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.75} />
                <p className="text-sm font-bold tracking-wide">שולחים לחברים בלינק אחד</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  כל ערכת לימוד שיצרתם אפשר לשתף בלינק פשוט — חבר/ה נכנסים,
                  רואים את הסיכום, הכרטיסיות והחידון, ושומרים אותם לחשבון שלהם
                  בלחיצה אחת.
                </p>
              </div>
              <div className="group rounded-2xl border border-white/30 dark:border-white/10 bg-white/40 dark:bg-white/[0.04] backdrop-blur-md p-5 space-y-2 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-pink-500/20 hover:border-pink-400/50">
                <FileCheck2 className="w-9 h-9 text-pink-500 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.75} />
                <p className="text-sm font-bold tracking-wide">בונים מאגר קורס ביחד</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  כשכל הכיתה משתפת את הסיכומים שלה נוצר מאגר חומרים לכל הקורס —
                  פעם אחת מעלים הרצאה וכולם נהנים מערכת לימוד מלאה עליה.
                </p>
              </div>
            </div>
          </section>

          {/* ─── Founder story ─── */}
          <section className="text-center space-y-3 max-w-2xl mx-auto">
            <p className="text-xs font-bold tracking-wide text-primary uppercase">הסיפור מאחורי FocusStudy</p>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              היי, אני הילה. הקמתי את FocusStudy כי נמאס לי לשלם מנוי חודשי
              לאתרי למידה שלא תמיד השתמשתי בהם כל החודש — יש תקופות שרציתי
              ללמוד 5 פעמים ביום, ויש שבועות שלא נכנסתי כלל כי הייתי בחופשה.
              לכן בניתי מערכת שעובדת לפי אסימונים: משלמים רק על מה שמשתמשים,
              והאסימונים לא פגים בתוקף — אף פעם.
            </p>
          </section>

          {/* ─── Final CTA ─── */}
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
        <Link href="/pricing" className="hover:text-foreground hover:underline">מחירים</Link>
        <span>•</span>
        <Link href="/contact" className="hover:text-foreground hover:underline">צור קשר</Link>
        <span>•</span>
        <Link href="/terms" className="hover:text-foreground hover:underline">תקנון ותנאי שימוש</Link>
        <span>•</span>
        <Link href="/privacy" className="hover:text-foreground hover:underline">מדיניות פרטיות</Link>
      </footer>
    </div>
  );
};
