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
//
// Deliberately normal-blended (no mix-blend-mode): combined with blur +
// absolute positioning, blend modes are prone to silently vanishing when an
// ancestor clips/scrolls (e.g. the dashboard's scrollable shell), so plain
// alpha layering is used instead -- it stays equally vivid everywhere the
// glow is mounted.
export const BackgroundGlow: React.FC<{ className?: string }> = ({ className }) => (
  <div aria-hidden className={cn("pointer-events-none absolute -z-10", className)}>
    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-amber-400 opacity-90 blur-3xl animate-glow-pulse dark:from-indigo-400 dark:via-violet-500 dark:to-fuchsia-500 dark:opacity-80" />
    <div
      className="absolute inset-0 rounded-full bg-gradient-to-tl from-cyan-400 via-violet-500 to-pink-500 opacity-70 blur-[70px] animate-glow-pulse dark:opacity-65"
      style={{ animationDelay: "2.4s" }}
    />
  </div>
);
