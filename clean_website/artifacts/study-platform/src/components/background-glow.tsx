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
    {/* Plain hsl() gradient stops -- Tailwind's built-in palette utilities
        (teal-500, cyan-500, etc.) are defined via oklch() and silently
        render as fully transparent on browsers without CSS Color 4 support
        (confirmed on Samsung Internet), which would make the glow vanish. */}
    <div
      className="absolute inset-0 rounded-full opacity-90 blur-3xl animate-glow-pulse dark:opacity-80"
      style={{ backgroundImage: "linear-gradient(to bottom right, hsl(170 75% 50%), hsl(195 85% 55%), hsl(217 85% 60%))" }}
    />
    <div
      className="absolute inset-0 rounded-full opacity-70 blur-[70px] animate-glow-pulse dark:opacity-65"
      style={{ backgroundImage: "linear-gradient(to top left, hsl(217 85% 60%), hsl(180 75% 50%), hsl(195 85% 65%))", animationDelay: "2.4s" }}
    />
  </div>
);
