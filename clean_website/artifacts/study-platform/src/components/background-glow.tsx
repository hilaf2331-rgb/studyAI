import React from "react";
import { cn } from "@/lib/utils";

// Layered, saturated color glow used behind hero/header areas across the
// app (landing, auth, legal pages, dashboard) -- two overlapping gradient
// blobs, slowly pulsing out of phase, so it reads as a glowing nebula in
// dark mode and iridescent silk in light mode rather than a single flat
// tint. `className` (position/size, and optionally an opacity override)
// lands on the wrapper and dims both layers together. Purely decorative --
// always aria-hidden and pointer-events-none so it never interferes with
// the content stacked on top of it.
export const BackgroundGlow: React.FC<{ className?: string }> = ({ className }) => (
  <div aria-hidden className={cn("pointer-events-none absolute -z-10", className)}>
    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-amber-400 opacity-70 blur-3xl animate-glow-pulse dark:from-indigo-400 dark:via-violet-500 dark:to-fuchsia-500 dark:opacity-60 dark:mix-blend-plus-lighter" />
    <div
      className="absolute inset-0 rounded-full bg-gradient-to-tl from-cyan-400 via-violet-500 to-pink-500 opacity-50 blur-[70px] mix-blend-multiply animate-glow-pulse dark:opacity-45 dark:mix-blend-plus-lighter"
      style={{ animationDelay: "2.4s" }}
    />
  </div>
);
