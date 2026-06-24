import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Lightbulb } from "lucide-react";

// Pure client-side engagement widget shown while a long generation job runs.
// Entirely disconnected from the backend -- no fetches, no timers tied to
// the actual job -- so it can never add load to the generation pipeline; it
// just auto-rotates on its own clock for as long as the parent keeps it
// mounted.
const TIPS_HE = [
  "טיפ: למידה אקטיבית (לשאול את עצמך שאלות) משפרת זכירה הרבה יותר מקריאה חזרה ושוב.",
  "ידעת? המוח מאחסן זיכרונות חדשים טוב יותר אחרי שינה -- נסו לחזור על חומר קצת לפני השינה.",
  "טיפ: פירוק חומר גדול ל'נגיסות' קטנות (כמו שאנחנו עושים כרגע) מקל על הזיכרון לעבד אותו.",
  "ידעת? הסבר חומר לחבר/ה (או בקול, לעצמכם) הוא אחת הדרכים היעילות ביותר לבדוק שהבנתם אותו.",
  "טיפ: מבחני תרגול (כמו אלו שאנחנו מכינים לכם) עוזרים יותר מקריאה חזרה -- זה נקרא 'אפקט הבדיקה'.",
  "ידעת? הפסקות קצרות כל 25-30 דקות (שיטת פומודורו) משפרות ריכוז בלמידה ארוכה.",
  "טיפ: כרטיסיות לימוד עובדות הכי טוב כשחוזרים עליהן במרווחים גדלים (חזרה מרווחת).",
];

const TIPS_EN = [
  "Tip: Active recall (quizzing yourself) beats re-reading notes for long-term memory.",
  "Did you know? Sleep helps consolidate new memories -- reviewing material before bed really helps.",
  "Tip: Breaking big material into small chunks (like we're doing right now) makes it easier to remember.",
  "Did you know? Explaining a topic out loud, even to yourself, is one of the best ways to check you understand it.",
  "Tip: Practice tests (like the ones we're building for you) beat re-reading -- it's called the 'testing effect'.",
  "Did you know? Short breaks every 25-30 minutes (the Pomodoro technique) improve focus during long study sessions.",
  "Tip: Flashcards work best with spaced repetition -- review them at growing intervals, not all at once.",
];

const ROTATE_INTERVAL_MS = 4500;

export function StudyTipsCarousel({ isRTL }: { isRTL: boolean }) {
  const tips = isRTL ? TIPS_HE : TIPS_EN;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % tips.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [tips.length]);

  return (
    <div
      className="relative min-h-16 rounded-lg border bg-muted/40 px-4 py-3"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.4 }}
          className="flex items-start gap-2 text-sm text-muted-foreground"
        >
          <Lightbulb className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <span className="leading-relaxed">{tips[index]}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
