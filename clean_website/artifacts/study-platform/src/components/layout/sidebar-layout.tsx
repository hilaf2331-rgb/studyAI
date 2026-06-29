import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { BackgroundGlow } from "@/components/background-glow";
import { TokenWidget } from "@/components/token-widget";
import { usePurchaseModal } from "@/lib/purchase-modal";
import { BookOpen, BookText, Home, Moon, Sun, ChevronLeft, ChevronRight, LogOut, Mic, Menu, User as UserIcon, Coins, Mail, Headphones } from "lucide-react";

export const SidebarLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [location] = useLocation();
  const { t, isRTL } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const { open: openPurchaseModal } = usePurchaseModal();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    queryClient.clear();
    logout();
  };

  const navItems = [
    { href: "/", label: "dashboard", icon: Home },
    { href: "/courses", label: "courses", icon: BookOpen },
    { href: "/materials", label: "materials", icon: BookText },
    { href: "/podcasts", label: "podcasts", icon: Headphones },
    { href: "/recorder", label: "הקלטות", icon: Mic },
    { href: "/profile", label: "profile", icon: UserIcon },
    { href: "/contact", label: "צור קשר", icon: Mail },
  ];

  const CollapseIcon = open ? ChevronRight : ChevronLeft;

  const isItemActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);

  // Shared nav + bottom-actions markup, reused by both the desktop sidebar
  // and the mobile drawer so behavior stays in sync between breakpoints.
  const renderNav = (showLabels: boolean, onNavigate?: () => void) => (
    <nav className="flex-1 px-2 space-y-1 mt-2" data-tour="sidebar-nav">
      {navItems.map((item) => {
        const isActive = isItemActive(item.href);
        const label = t(item.label);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`
              flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors
              ${isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80"
              }
              ${showLabels ? "" : "justify-center"}
            `}
            title={!showLabels ? label : undefined}
          >
            <item.icon className="w-5 h-5 shrink-0" />
            {showLabels && <span className="truncate">{label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  const renderBottomActions = (showLabels: boolean) => (
    <div className={`p-2 space-y-1 border-t border-sidebar-border mt-auto ${showLabels ? "" : "flex flex-col items-center"}`}>
      <button
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors ${showLabels ? "" : "justify-center"}`}
        onClick={openPurchaseModal}
        title={!showLabels ? (isRTL ? "טעינת טוקנים" : "Buy Tokens") : undefined}
      >
        <Coins className="w-5 h-5 shrink-0" />
        {showLabels && <span className="truncate">{isRTL ? "טעינת טוקנים" : "Buy Tokens"}</span>}
      </button>
      <div className={showLabels ? "px-1 pb-1" : "py-1"}>
        <TokenWidget compact={!showLabels} />
      </div>
      {showLabels && user && (
        <div className="px-3 py-2 text-xs text-sidebar-foreground/50 truncate">
          {user.name || user.email}
        </div>
      )}
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        title={!showLabels ? (theme === "dark" ? t("light_mode") : t("dark_mode")) : undefined}
      >
        {theme === "dark" ? <Sun className="w-5 h-5 shrink-0" /> : <Moon className="w-5 h-5 shrink-0" />}
        {showLabels && <span className="text-sm">{theme === "dark" ? t("light_mode") : t("dark_mode")}</span>}
      </button>
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        onClick={handleLogout}
        title={!showLabels ? "התנתק" : undefined}
      >
        <LogOut className="w-5 h-5 shrink-0" />
        {showLabels && <span className="text-sm">התנתק</span>}
      </button>
      {showLabels && (
        <div className="flex items-center justify-center gap-2 px-3 pt-2 text-[11px] text-sidebar-foreground/40">
          <Link href="/terms" className="hover:text-sidebar-foreground/70 hover:underline">תקנון</Link>
          <span>•</span>
          <Link href="/privacy" className="hover:text-sidebar-foreground/70 hover:underline">פרטיות</Link>
        </div>
      )}
    </div>
  );

  return (
    <div className={`relative flex min-h-[100dvh] w-full bg-background ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
      {/* Ambient app-wide glow, pinned to the viewport so it stays vivid and
          visible behind every authenticated page regardless of scroll
          position or the main panel's overflow clipping. */}
      <BackgroundGlow className="fixed -top-24 right-1/4 w-[40rem] h-[40rem]" />
      <BackgroundGlow className="fixed bottom-0 -left-24 w-[26rem] h-[26rem] opacity-70" />

      {/* Desktop sidebar — hidden below lg so the main layout takes 100% of the viewport on mobile */}
      <div
        className={`
          hidden lg:flex relative shrink-0 border-border bg-sidebar text-sidebar-foreground flex-col
          transition-[width] duration-200 ease-in-out
          ${isRTL ? "border-l" : "border-r"}
          ${open ? "w-64" : "w-16"}
        `}
      >
        {/* Logo -- links to the marketing page (not "/", which renders <Dashboard> while logged in) */}
        <Link href="/landing" className="h-16 flex items-center gap-3 px-4 font-bold text-xl tracking-tight text-sidebar-primary overflow-hidden">
          <img src="/logo.png" alt="FocusStudy" className="w-7 h-7 shrink-0 object-contain" />
          {open && <span className="truncate">FocusStudy</span>}
        </Link>

        {/* Toggle button */}
        <button
          onClick={() => setOpen(v => !v)}
          className={`
            absolute top-4 z-20 w-6 h-6 rounded-full border bg-background text-foreground
            flex items-center justify-center shadow-sm hover:bg-muted transition-colors
            ${isRTL ? "-left-3" : "-right-3"}
          `}
          aria-label={open ? "כווץ תפריט צד" : "הרחב תפריט צד"}
        >
          <CollapseIcon className="w-3.5 h-3.5" />
        </button>

        {renderNav(open)}
        {renderBottomActions(open)}
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden w-full">
        {/* Mobile top bar with burger menu — only shown below lg */}
        <div className="lg:hidden flex items-center justify-between h-14 px-4 border-b border-border shrink-0 bg-background">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label={isRTL ? "פתח תפריט" : "Open menu"}
            className="p-2 -ms-2 rounded-md hover:bg-muted transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <Link href="/landing" className="flex items-center gap-2 font-bold text-lg tracking-tight text-sidebar-primary">
            <img src="/logo.png" alt="FocusStudy" className="w-5 h-5 object-contain" />
            <span>FocusStudy</span>
          </Link>
          <TokenWidget compact />
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>

      {/* Mobile nav drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side={isRTL ? "right" : "left"}
          className="w-72 p-0 flex flex-col bg-sidebar text-sidebar-foreground border-sidebar-border"
        >
          <Link
            href="/landing"
            onClick={() => setMobileOpen(false)}
            className="h-16 flex items-center gap-3 px-4 font-bold text-xl tracking-tight text-sidebar-primary overflow-hidden border-b border-sidebar-border"
          >
            <img src="/logo.png" alt="FocusStudy" className="w-7 h-7 shrink-0 object-contain" />
            <span className="truncate">FocusStudy</span>
          </Link>
          {renderNav(true, () => setMobileOpen(false))}
          {renderBottomActions(true)}
        </SheetContent>
      </Sheet>
    </div>
  );
};
