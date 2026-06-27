// Targets are matched against `[data-tour="..."]` elements already placed
// in sidebar-layout.tsx and dashboard.tsx -- this keeps the tour decoupled
// from those pages' internals.
export interface TourStep {
  target: string;
  side: "top" | "bottom" | "left" | "right";
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: "sidebar-nav",
    side: "left",
    title: "כאן מנווטים בין כל החלקים",
    body: "הקורסים, החומרים וההקלטות שלך נמצאים בתפריט הצד -- הכל במקום אחד.",
  },
  {
    target: "upload-material",
    side: "bottom",
    title: "מתחילים מכאן",
    body: "מעלים PDF, מצגת, סרטון או הקלטה -- ומקבלים סיכום, כרטיסיות וחידון תוך שניות.",
  },
  {
    target: "daily-review",
    side: "bottom",
    title: "סקירה יומית",
    body: "כשכרטיסיות מגיעות לתזמון חזרה, הן יחכו לך כאן -- כל מה שצריך לחזור עליו היום, במקום אחד.",
  },
];

export const ONBOARDING_STORAGE_KEY = "focusstudy_onboarding_completed";
