import type React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

// Small, continuously-animating scenes for each marketing-reel visual
// motif -- built from plain SVG/CSS instead of a third-party icon/animation
// library, so there's no licensing question to track and every shape can
// pick up the video's own accent color. The parent (IntroCard/MessageBubble
// in MarketingReel.tsx) handles the one-time spring "pop in"; everything
// here is the looping motion that keeps running once it's on screen.

interface MotifProps {
  color: string; // "r,g,b" -- same format as COLOR_THEMES entries
}

const ChatMotif: React.FC<MotifProps> = ({ color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  return (
    <svg viewBox="0 0 100 100" width="62%" height="62%">
      <rect x="14" y="18" width="52" height="34" rx="12" fill={`rgba(${color},0.9)`} />
      <path d="M 26 52 L 26 62 L 38 52 Z" fill={`rgba(${color},0.9)`} />
      {[0, 1, 2].map((i) => {
        const bounce = Math.max(0, Math.sin(t * 6 - i * 0.9)) * 4;
        return <circle key={i} cx={28 + i * 12} cy={35 - bounce} r={4} fill="white" />;
      })}
      <rect x="34" y="48" width="52" height="34" rx="12" fill="white" opacity={0.95} />
      <path d="M 74 82 L 74 92 L 62 82 Z" fill="white" opacity={0.95} />
      <line x1="44" y1="60" x2="76" y2="60" stroke={`rgb(${color})`} strokeWidth="4" strokeLinecap="round" />
      <line x1="44" y1="70" x2="66" y2="70" stroke={`rgb(${color})`} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
};

const RecordingMotif: React.FC<MotifProps> = ({ color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const bars = [0.9, 1.6, 1.1, 2.0, 1.3, 0.8];

  return (
    <svg viewBox="0 0 100 100" width="62%" height="62%">
      {bars.map((freq, i) => {
        const h = 14 + (Math.sin(t * 5 * freq + i * 1.3) * 0.5 + 0.5) * 40;
        const x = 16 + i * 12;
        return (
          <rect
            key={i}
            x={x}
            y={50 - h / 2}
            width="7"
            height={h}
            rx="3.5"
            fill={`rgba(${color},0.95)`}
          />
        );
      })}
      <circle cx="86" cy="20" r={5 + Math.sin(t * 6) * 1.5} fill="#ef4444" />
    </svg>
  );
};

const FlashcardsMotif: React.FC<MotifProps> = ({ color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const angle = (t * 90) % 360;
  const showBack = Math.cos((angle * Math.PI) / 180) < 0;
  const scaleX = Math.abs(Math.cos((angle * Math.PI) / 180));

  return (
    <svg viewBox="0 0 100 100" width="62%" height="62%">
      <g style={{ transform: `scaleX(${Math.max(scaleX, 0.05)})`, transformOrigin: "50px 50px" }}>
        <rect x="20" y="20" width="60" height="60" rx="14" fill={`rgba(${color},0.92)`} />
        <text
          x="50"
          y="63"
          textAnchor="middle"
          fontSize="34"
          fontWeight={900}
          fill="white"
          style={{ transform: showBack ? "scaleX(-1)" : undefined, transformOrigin: "50px 50px" }}
        >
          {showBack ? "✓" : "?"}
        </text>
      </g>
    </svg>
  );
};

const SummaryMotif: React.FC<MotifProps> = ({ color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (frame / fps) % 2.4;
  const lineWidths = [46, 38, 42, 26];

  return (
    <svg viewBox="0 0 100 100" width="62%" height="62%">
      <rect x="20" y="14" width="60" height="72" rx="8" fill="white" opacity={0.95} />
      {lineWidths.map((w, i) => {
        const start = i * 0.45;
        const progress = interpolate(t, [start, start + 0.4], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <rect
            key={i}
            x="30"
            y={30 + i * 13}
            width={w * progress}
            height="6"
            rx="3"
            fill={`rgb(${color})`}
          />
        );
      })}
    </svg>
  );
};

const ExamMotif: React.FC<MotifProps> = ({ color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (frame / fps) % 3;

  return (
    <svg viewBox="0 0 100 100" width="62%" height="62%">
      {[0, 1, 2].map((i) => {
        const start = i * 0.5;
        const progress = interpolate(t, [start, start + 0.35], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const y = 24 + i * 24;
        return (
          <g key={i}>
            <rect x="18" y={y} width="20" height="20" rx="5" fill={`rgba(${color},0.35)`} />
            <path
              d={`M 22 ${y + 10} L 27 ${y + 15} L 34 ${y + 5}`}
              fill="none"
              stroke="white"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="20"
              strokeDashoffset={20 * (1 - progress)}
            />
            <rect x="46" y={y + 6} width={34 * progress} height="8" rx="4" fill={`rgb(${color})`} opacity={0.9} />
          </g>
        );
      })}
    </svg>
  );
};

const PodcastMotif: React.FC<MotifProps> = ({ color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  return (
    <svg viewBox="0 0 100 100" width="62%" height="62%">
      {[0, 1, 2].map((i) => {
        const phase = (t * 0.9 + i / 3) % 1;
        const r = 16 + phase * 26;
        const opacity = 1 - phase;
        return <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={`rgba(${color},${opacity})`} strokeWidth="3" />;
      })}
      <path
        d="M 30 52 A 20 20 0 0 1 70 52"
        fill="none"
        stroke="white"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <rect x="24" y="50" width="10" height="18" rx="5" fill="white" />
      <rect x="66" y="50" width="10" height="18" rx="5" fill="white" />
    </svg>
  );
};

const GenericMotif: React.FC<MotifProps> = ({ color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const glow = interpolate(Math.sin(t * 2), [-1, 1], [0.5, 1]);

  return (
    <svg viewBox="0 0 100 100" width="62%" height="62%">
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const angle = (i / 6) * Math.PI * 2;
        const len = 8 + glow * 6;
        const x1 = 50 + Math.cos(angle) * 30;
        const y1 = 38 + Math.sin(angle) * 30;
        const x2 = 50 + Math.cos(angle) * (30 + len);
        const y2 = 38 + Math.sin(angle) * (30 + len);
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={`rgba(${color},${glow})`} strokeWidth="4" strokeLinecap="round" />
        );
      })}
      <circle cx="50" cy="38" r="22" fill={`rgba(${color},${0.5 + glow * 0.3})`} />
      <rect x="42" y="58" width="16" height="14" rx="4" fill="white" opacity={0.9} />
    </svg>
  );
};

export const MOTIF_ANIMATIONS = {
  chat: ChatMotif,
  recording: RecordingMotif,
  flashcards: FlashcardsMotif,
  summary: SummaryMotif,
  exam: ExamMotif,
  podcast: PodcastMotif,
  generic: GenericMotif,
} as const;
