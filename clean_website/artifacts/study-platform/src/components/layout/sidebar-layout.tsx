import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { BookOpen, BookText, Home, Moon, Sun, Languages, ChevronLeft, ChevronRight, LogOut, Mic } from "lucide-react";

export const SidebarLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [location] = useLocation();
  const { language, setLanguage, t, isRTL } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);

  const handleLogout = () => {
    queryClient.clear();
    logout();
  };

  const navItems = [
    { href: "/", label: "dashboard", icon: Home },
    { href: "/courses", label: "courses", icon: BookOpen },
    { href: "/materials", label: "materials", icon: BookText },
    { href: "/recorder", labelHe: "הקלטות", labelEn: "Recorder", icon: Mic },
  ];

  const CollapseIcon = open
    ? (isRTL ? ChevronRight : ChevronLeft)
    : (isRTL ? ChevronLeft : ChevronRight);

  return (
    <div className={`flex min-h-[100dvh] w-full bg-background ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
      {/* Sidebar */}
      <div
        className={`
          relative shrink-0 border-border bg-sidebar text-sidebar-foreground flex flex-col
          transition-[width] duration-200 ease-in-out
          ${isRTL ? "border-l" : "border-r"}
          ${open ? "w-64" : "w-16"}
        `}
      >
        {/* Logo */}
        <div className="h-16 flex items-center gap-3 px-4 font-bold text-xl tracking-tight text-sidebar-primary overflow-hidden">
          <BookOpen className="w-7 h-7 shrink-0" />
          {open && <span className="truncate">StudyAI</span>}
        </div>

        {/* Toggle button */}
        <button
          onClick={() => setOpen(v => !v)}
          className={`
            absolute top-4 z-20 w-6 h-6 rounded-full border bg-background text-foreground
            flex items-center justify-center shadow-sm hover:bg-muted transition-colors
            ${isRTL ? "-left-3" : "-right-3"}
          `}
          aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
        >
          <CollapseIcon className="w-3.5 h-3.5" />
        </button>

        {/* Nav */}
        <nav className="flex-1 px-2 space-y-1 mt-2">
          {navItems.map((item) => {
            const isActive = item.href === "/"
              ? location === "/"
              : location.startsWith(item.href);
            const label = "labelHe" in item
              ? (isRTL ? item.labelHe : item.labelEn)
              : t(item.label as string);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors
                  ${isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80"
                  }
                  ${open ? "" : "justify-center"}
                `}
                title={!open ? label : undefined}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                {open && <span className="truncate">{label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Bottom actions */}
        <div className={`p-2 space-y-1 border-t border-sidebar-border mt-auto ${open ? "" : "flex flex-col items-center"}`}>
          {open && user && (
            <div className="px-3 py-2 text-xs text-sidebar-foreground/50 truncate">
              {user.name || user.email}
            </div>
          )}
          <button
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            onClick={() => setLanguage(language === "en" ? "he" : "en")}
            title={!open ? (language === "en" ? "עברית" : "English") : undefined}
          >
            <Languages className="w-5 h-5 shrink-0" />
            {open && <span className="text-sm">{language === "en" ? "עברית" : "English"}</span>}
          </button>
          <button
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={!open ? (theme === "dark" ? "Light" : "Dark") : undefined}
          >
            {theme === "dark" ? <Sun className="w-5 h-5 shrink-0" /> : <Moon className="w-5 h-5 shrink-0" />}
            {open && <span className="text-sm">{theme === "dark" ? t("light_mode") : t("dark_mode")}</span>}
          </button>
          <button
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            onClick={handleLogout}
            title={!open ? (isRTL ? "התנתק" : "Sign out") : undefined}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {open && <span className="text-sm">{isRTL ? "התנתק" : "Sign out"}</span>}
          </button>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
};
