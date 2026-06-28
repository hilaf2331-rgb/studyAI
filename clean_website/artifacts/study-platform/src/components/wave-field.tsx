import React, { useId } from "react";

// Decorative animated line-mesh, behind the landing/auth hero -- echoes the
// gradient wave-grid look used across the marketing pages. Purely
// decorative: aria-hidden, pointer-events-none, clipped by the parent's
// overflow-hidden so it never affects layout or scroll height.
export const WaveField: React.FC<{ className?: string }> = ({ className }) => {
  const id = useId();
  const rows = Array.from({ length: 14 });

  return (
    <svg
      aria-hidden
      viewBox="0 0 1200 420"
      preserveAspectRatio="none"
      className={className}
    >
      <defs>
        <linearGradient id={`${id}-grad`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="50%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      {rows.map((_, i) => {
        const y = 40 + i * 28;
        const amp = 18 + i * 1.4;
        return (
          <path
            key={i}
            d={`M0 ${y} Q 300 ${y - amp} 600 ${y} T 1200 ${y}`}
            fill="none"
            stroke={`url(#${id}-grad)`}
            strokeWidth="1"
            opacity={0.12 + i * 0.02}
            className="animate-wave-drift"
            style={{ animationDelay: `${i * -0.6}s` }}
          />
        );
      })}
    </svg>
  );
};
