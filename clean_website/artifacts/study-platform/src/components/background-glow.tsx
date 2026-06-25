import React from "react";
import { cn } from "@/lib/utils";

// Soft, blurred radial color glow used behind hero/header areas across the
// app (landing, auth, legal pages, dashboard) for visual depth. Purely
// decorative -- always aria-hidden and pointer-events-none so it never
// interferes with the content stacked on top of it.
export const BackgroundGlow: React.FC<{ className?: string }> = ({ className }) => (
  <div
    aria-hidden
    className={cn(
      "pointer-events-none absolute -z-10 rounded-full bg-gradient-to-r from-blue-400 via-pink-400 to-amber-300 opacity-15 blur-3xl dark:opacity-20",
      className,
    )}
  />
);
