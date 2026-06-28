import React, { useEffect } from "react";

// Remounts (via `locationKey`) on every route change so the fade-in plays
// again each time -- used to soften the jump between the pre-auth pages
// (landing, login, terms, privacy) which render via early-return branches
// rather than wouter's own <Switch>, so there's no built-in transition.
//
// Also resets window scroll to the top on every such navigation -- e.g.
// clicking the sidebar logo to "/landing" while scrolled down on a long
// dashboard page would otherwise land on <LandingPage> already scrolled
// partway down, since these early-return pages swap content in place
// rather than going through a real page load.
export const PageTransition: React.FC<{ locationKey: string; children: React.ReactNode }> = ({ locationKey, children }) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [locationKey]);

  return (
    <div key={locationKey} className="animate-in fade-in duration-300 ease-out">
      {children}
    </div>
  );
};
