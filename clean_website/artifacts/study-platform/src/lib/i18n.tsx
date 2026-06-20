import React, { createContext, useContext, useEffect, useState } from "react";

type Language = "en" | "he";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  isRTL: boolean;
}

const translations: Record<Language, Record<string, string>> = {
  en: {
    dashboard: "Dashboard",
    courses: "Courses",
    materials: "Materials",
    settings: "Settings",
    newCourse: "New Course",
    newMaterial: "New Material",
    studyStreak: "Study Streak",
    totalMaterials: "Total Materials",
    totalCourses: "Total Courses",
    averageScore: "Average Score",
    studyMinutes: "Study Minutes",
    recentActivity: "Recent Activity",
    generateSummary: "Generate Summary",
    generateFlashcards: "Generate Flashcards",
    generateQA: "Generate Q&A",
    generateExam: "Generate Exam",
    pending: "Pending",
    processing: "Processing",
    ready: "Ready",
    error: "Error",
    language: "Language",
    dark_mode: "Dark Mode",
    light_mode: "Light Mode",
    system_mode: "System",
  },
  he: {
    dashboard: "לוח בקרה",
    courses: "קורסים",
    materials: "חומרי לימוד",
    settings: "הגדרות",
    newCourse: "קורס חדש",
    newMaterial: "חומר חדש",
    studyStreak: "רצף למידה",
    totalMaterials: "סה״כ חומרים",
    totalCourses: "סה״כ קורסים",
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
    language: "שפה",
    dark_mode: "מצב לילה",
    light_mode: "מצב יום",
    system_mode: "מערכת",
  }
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem("app-language");
    return (saved as Language) || "en";
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("app-language", lang);
  };

  useEffect(() => {
    document.documentElement.dir = language === "he" ? "rtl" : "ltr";
    document.documentElement.lang = language;
  }, [language]);

  const t = (key: string) => {
    return translations[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, isRTL: language === "he" }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within a LanguageProvider");
  return context;
};
