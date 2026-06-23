import React, { createContext, useContext, useEffect } from "react";

type Language = "he";

interface LanguageContextType {
  language: Language;
  t: (key: string) => string;
  isRTL: boolean;
}

const translations: Record<string, string> = {
  dashboard: "לוח בקרה",
  courses: "קורסים",
  materials: "חומרי לימוד",
  settings: "הגדרות",
  newCourse: "קורס חדש",
  newMaterial: "חומר חדש",
  studyStreak: "רצף למידה",
  totalMaterials: "סה״כ חומרים",
  totalCourses: "סה״כ קורסים",
  totalFlashcards: "סה״כ כרטיסיות",
  averageScore: "ציון ממוצע",
  studyMinutes: "דקות למידה",
  recentActivity: "פעילות אחרונה",
  generateSummary: "צור סיכום",
  generateFlashcards: "צור כרטיסיות",
  generateQA: "צור שאלות ותשובות",
  generateExam: "צור מבחן",
  pending: "ממתין",
  processing: "מעבד",
  ready: "מוכן",
  error: "שגיאה",
  dark_mode: "מצב לילה",
  light_mode: "מצב יום",
  system_mode: "מערכת",
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useEffect(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "he";
  }, []);

  const t = (key: string) => translations[key] || key;

  return (
    <LanguageContext.Provider value={{ language: "he", t, isRTL: true }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within a LanguageProvider");
  return context;
};
