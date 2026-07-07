import React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

// Shared nav header for pages that must render the same way whether or not
// the visitor is logged in (pricing, contact) -- a payment processor's
// review, or a logged-out visitor following a link from the landing page,
// both need a way back to the marketing site and a way into the app,
// without the authenticated SidebarLayout's chrome. Deliberately lighter
// than landing.tsx's own hero header (no extra nav links baked in beyond
// `links`), since that one is a one-off for the marketing page itself.
export const PublicPageHeader: React.FC<{ links?: React.ReactNode }> = ({ links }) => {
  const { user } = useAuth();
  return (
    <header className="relative z-10 px-4 sm:px-10 pt-5">
      <div className="flex items-center justify-between gap-4 mx-auto max-w-4xl rounded-full border border-white/10 bg-white/5 backdrop-blur-md px-5 py-2.5 shadow-lg shadow-black/20">
        <Link href="/landing" className="flex items-center gap-2.5">
          <img src="/logo.png" alt="FocusStudy" className="w-8 h-8 object-contain" />
          <span className="text-lg font-bold tracking-tight">FocusStudy</span>
        </Link>
        <div className="flex items-center gap-2">
          {links}
          <Link href="/login">
            <Button size="sm">{user ? "לאזור האישי" : "התחברות / הרשמה"}</Button>
          </Link>
        </div>
      </div>
    </header>
  );
};
