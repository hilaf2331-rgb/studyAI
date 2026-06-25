import React from "react";

// Remounts (via `locationKey`) on every route change so the fade-in plays
// again each time -- used to soften the jump between the pre-auth pages
// (landing, login, terms, privacy) which render via early-return branches
// rather than wouter's own <Switch>, so there's no built-in transition.
export const PageTransition: React.FC<{ locationKey: string; children: React.ReactNode }> = ({ locationKey, children }) => (
  <div key={locationKey} className="animate-in fade-in duration-300 ease-out">
    {children}
  </div>
);
