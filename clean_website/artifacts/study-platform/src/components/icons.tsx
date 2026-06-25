import React, { useId } from "react";

// Custom, code-crafted duotone glyphs for the app's core features -- no
// generic icon-library symbols here. Each glyph is a gradient-stroked SVG
// (own <linearGradient>, scoped with useId so multiple instances on one
// page never collide) so they read as "lit from within" rather than flat
// line icons.
interface GlyphProps {
  className?: string;
}

export const CourseGlyph: React.FC<GlyphProps> = ({ className }) => {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="4" y1="6" x2="44" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#f472b6" />
        </linearGradient>
      </defs>
      <path d="M24 11c-4-3-10-4-16-2v25c6-2 12-1 16 2 4-3 10-4 16-2V9c-6-2-12-1-16 2Z" fill={`url(#${id})`} opacity="0.2" />
      <path d="M24 11c-4-3-10-4-16-2v25c6-2 12-1 16 2 4-3 10-4 16-2V9c-6-2-12-1-16 2Z" stroke={`url(#${id})`} strokeWidth="2" strokeLinejoin="round" />
      <path d="M24 11v25" stroke={`url(#${id})`} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
};

export const MaterialsGlyph: React.FC<GlyphProps> = ({ className }) => {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <path d="M24 5 41 15 24 24 7 15 24 5Z" fill={`url(#${id})`} opacity="0.3" />
      <path d="M24 5 41 15 24 24 7 15 24 5Z" stroke={`url(#${id})`} strokeWidth="2" strokeLinejoin="round" />
      <path d="M7 24 24 33 41 24" stroke={`url(#${id})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      <path d="M7 33 24 42 41 33" stroke={`url(#${id})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
    </svg>
  );
};

export const FlashcardGlyph: React.FC<GlyphProps> = ({ className }) => {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="4" y1="6" x2="44" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f472b6" />
        </linearGradient>
      </defs>
      <rect x="6" y="15" width="27" height="19" rx="5" transform="rotate(-9 19.5 24.5)" fill={`url(#${id})`} opacity="0.18" />
      <rect x="6" y="15" width="27" height="19" rx="5" transform="rotate(-9 19.5 24.5)" stroke={`url(#${id})`} strokeWidth="2" />
      <rect x="15" y="8" width="27" height="19" rx="5" fill={`url(#${id})`} opacity="0.28" />
      <rect x="15" y="8" width="27" height="19" rx="5" stroke={`url(#${id})`} strokeWidth="2.2" />
      <path d="M21 17.5h14M21 23.5h9" stroke={`url(#${id})`} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
};

export const GradeGlyph: React.FC<GlyphProps> = ({ className }) => {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="6" y1="5" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      <path d="M24 5 33 14 33 27 24 36 15 27 15 14Z" fill={`url(#${id})`} opacity="0.22" />
      <path d="M24 5 33 14 33 27 24 36 15 27 15 14Z" stroke={`url(#${id})`} strokeWidth="2" strokeLinejoin="round" />
      <path d="M15 14 24 20 33 14" stroke={`url(#${id})`} strokeWidth="1.6" strokeLinejoin="round" opacity="0.75" />
      <path d="M24 20v16" stroke={`url(#${id})`} strokeWidth="1.6" opacity="0.75" />
      <path d="M16 40h16" stroke={`url(#${id})`} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
};

export const RescueGlyph: React.FC<GlyphProps> = ({ className }) => {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="17" stroke={`url(#${id})`} strokeWidth="2" strokeDasharray="4 5" className="origin-center animate-spin-slow" />
      <circle cx="24" cy="24" r="11" fill={`url(#${id})`} opacity="0.18" />
      <circle cx="24" cy="24" r="11" stroke={`url(#${id})`} strokeWidth="2" />
      <path d="M24 8v6M24 34v6M8 24h6M34 24h6" stroke={`url(#${id})`} strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="24" r="3.4" fill={`url(#${id})`} />
    </svg>
  );
};

export const SummaryGlyph: React.FC<GlyphProps> = ({ className }) => {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="6" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#f472b6" />
        </linearGradient>
      </defs>
      <rect x="9" y="5" width="26" height="36" rx="5" fill={`url(#${id})`} opacity="0.18" />
      <rect x="9" y="5" width="26" height="36" rx="5" stroke={`url(#${id})`} strokeWidth="2" />
      <path d="M16 16h14M16 23h14M16 30h9" stroke={`url(#${id})`} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M37 8l1.4 3 3 1.4-3 1.4-1.4 3-1.4-3-3-1.4 3-1.4Z" fill="#fbbf24" />
    </svg>
  );
};

export const ChatGlyph: React.FC<GlyphProps> = ({ className }) => {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="4" y1="6" x2="44" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f472b6" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <path d="M8 10h32a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H22l-9 7v-7h-5a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z" fill={`url(#${id})`} opacity="0.2" />
      <path d="M8 10h32a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H22l-9 7v-7h-5a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z" stroke={`url(#${id})`} strokeWidth="2" strokeLinejoin="round" />
      <circle cx="16" cy="21.5" r="1.8" fill={`url(#${id})`} />
      <circle cx="24" cy="21.5" r="1.8" fill={`url(#${id})`} />
      <circle cx="32" cy="21.5" r="1.8" fill={`url(#${id})`} />
    </svg>
  );
};

export const TokenGlyph: React.FC<GlyphProps> = ({ className }) => {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="6" y1="8" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#fde68a" />
        </linearGradient>
      </defs>
      <ellipse cx="24" cy="32" rx="15" ry="6" fill={`url(#${id})`} opacity="0.25" />
      <ellipse cx="24" cy="32" rx="15" ry="6" stroke={`url(#${id})`} strokeWidth="2" />
      <ellipse cx="24" cy="24" rx="15" ry="6" fill={`url(#${id})`} opacity="0.3" />
      <ellipse cx="24" cy="24" rx="15" ry="6" stroke={`url(#${id})`} strokeWidth="2" />
      <ellipse cx="24" cy="16" rx="15" ry="6" fill={`url(#${id})`} opacity="0.4" />
      <ellipse cx="24" cy="16" rx="15" ry="6" stroke={`url(#${id})`} strokeWidth="2.2" />
      <path d="M19 13.5h10M24 13v6" stroke={`url(#${id})`} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
};

export const InfinityGlyph: React.FC<GlyphProps> = ({ className }) => {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="4" y1="14" x2="44" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path
        d="M15 16c-5 0-8 3.6-8 8s3 8 8 8c5.5 0 7-4 9-8s3.5-8 9-8c5 0 8 3.6 8 8s-3 8-8 8c-5.5 0-7-4-9-8s-3.5-8-9-8Z"
        fill={`url(#${id})`}
        opacity="0.2"
      />
      <path
        d="M15 16c-5 0-8 3.6-8 8s3 8 8 8c5.5 0 7-4 9-8s3.5-8 9-8c5 0 8 3.6 8 8s-3 8-8 8c-5.5 0-7-4-9-8s-3.5-8-9-8Z"
        stroke={`url(#${id})`}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
};
