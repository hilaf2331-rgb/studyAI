import React from "react";

// A single, soft "spotlight" sitting fixed behind the authenticated app
// shell -- unlike the saturated BackgroundGlow used on marketing pages,
// this is deliberately faint (low opacity, very high blur) so it reads as
// ambient atmosphere rather than a decoration competing for attention.
// Fixed + -z-10 + pointer-events-none: it never scrolls with the content
// and never intercepts a click, no matter how the main panel clips/scrolls.
export const FocusAura: React.FC = () => (
  <div
    aria-hidden
    className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
  >
    <div className="absolute left-1/2 top-1/3 h-[60rem] w-[60rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-indigo-400 via-violet-400 to-fuchsia-300 opacity-[0.12] blur-[120px] dark:opacity-[0.10]" />
  </div>
);
