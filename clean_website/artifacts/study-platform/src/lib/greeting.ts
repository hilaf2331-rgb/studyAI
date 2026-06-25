export type Gender = "male" | "female" | "other";

export function getHebrewGreeting(name: string | null | undefined, gender: Gender = "male"): string {
  const trimmedName = name?.trim();
  const suffix = trimmedName ? `, ${trimmedName}` : "";

  switch (gender) {
    case "female":
      return `ברוכה הבאה${suffix}. הנה ההתקדמות שלך.`;
    case "other":
      return `כיף לראות אותך שוב${suffix}. הנה ההתקדמות שלך.`;
    default:
      return `ברוך הבא${suffix}. הנה ההתקדמות שלך.`;
  }
}
