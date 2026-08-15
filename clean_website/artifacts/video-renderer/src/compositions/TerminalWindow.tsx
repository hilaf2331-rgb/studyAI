import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// Technique 3 ("terminal-inserts") from the remotion-video-editing skill --
// an authentic CLI/agent-run insert: a real terminal chrome, monospace
// content typed on screen line by line, and an optional generated-output
// result card. Meant to be dropped inside a <Sequence> the same way
// AppWindowReveal is used from MarketingReel.tsx.

export interface TerminalLine {
  text: string;
  // "command" gets the prompt glyph + accent color (what you typed);
  // "output" is plain result text; "success" is result text in green, for
  // the line that confirms something finished (matches how a real shell
  // colors success output).
  variant?: "command" | "output" | "success";
}

export interface TerminalOutputCard {
  title: string;
  rows: string[];
}

interface TerminalWindowProps {
  lines: TerminalLine[];
  accentColor: string; // "r,g,b", same format as MarketingReel's COLOR_THEMES
  outputCard?: TerminalOutputCard;
  width?: number;
}

// Characters revealed per second while "typing" -- fast enough that a
// realistic command (~30-50 chars) finishes in well under a second, since
// this is a background detail of the reel, not the thing being read.
const CHARS_PER_SECOND = 38;
// Frames to hold after a line finishes typing before the next one starts --
// mimics the beat a real terminal has between hitting enter and the next
// prompt appearing, rather than lines typing back-to-back with no pause.
const LINE_GAP_FRAMES = 6;

const PROMPT = "❯";

function lineDurationFrames(text: string, fps: number): number {
  return Math.max(1, Math.ceil((text.length / CHARS_PER_SECOND) * fps));
}

// Precomputes each line's [startFrame, endFrame) typing window so every
// line types in sequence -- the next line can't start until the previous
// one's characters have all been revealed plus the pause gap. Done once per
// render (not recalculated per frame) since it only depends on the lines
// themselves.
function layoutLines(lines: TerminalLine[], fps: number): Array<{ start: number; end: number }> {
  let cursor = 0;
  return lines.map((line) => {
    const start = cursor;
    const end = start + lineDurationFrames(line.text, fps);
    cursor = end + LINE_GAP_FRAMES;
    return { start, end };
  });
}

const TerminalLineRow: React.FC<{
  line: TerminalLine;
  start: number;
  end: number;
  accentColor: string;
  isLastTypedLine: boolean;
}> = ({ line, start, end, accentColor, isLastTypedLine }) => {
  const frame = useCurrentFrame();
  if (frame < start) return null;

  const revealed = interpolate(frame, [start, end], [0, line.text.length], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const shown = line.text.slice(0, Math.floor(revealed));
  const stillTyping = frame < end;
  // Blinking cursor only rides on whichever line is actively being typed --
  // once a line finishes it stays put as plain text, same as a real shell.
  const showCursor = stillTyping && isLastTypedLine && Math.floor(frame / 12) % 2 === 0;

  const color =
    line.variant === "success" ? "#4ade80" : line.variant === "command" ? "#e2e8f0" : "rgba(226,232,240,0.82)";

  return (
    <div style={{ display: "flex", gap: 10 }}>
      {line.variant === "command" ? (
        <span style={{ color: `rgb(${accentColor})`, fontWeight: 700 }}>{PROMPT}</span>
      ) : null}
      <span style={{ color, whiteSpace: "pre" }}>
        {shown}
        {showCursor ? <span style={{ opacity: 0.9 }}>▌</span> : null}
      </span>
    </div>
  );
};

// The result card that pops in once every line has finished typing --
// staggered spring pops per row, same rhythm AppWindowReveal uses for its
// header/line1/line2 (see MarketingReel.tsx), so the two "app UI" moments
// in a reel feel like the same hand drew them.
const OutputCard: React.FC<{ card: TerminalOutputCard; startFrame: number; accentColor: string }> = ({
  card,
  startFrame,
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = Math.max(frame - startFrame, 0);
  if (frame < startFrame) return null;

  const titlePop = spring({ frame: localFrame, fps, config: { damping: 12, stiffness: 170, mass: 0.5 } });

  return (
    <div
      style={{
        marginTop: 18,
        transform: `scale(${interpolate(titlePop, [0, 1], [0.85, 1])})`,
        opacity: titlePop,
        transformOrigin: "top right",
        background: "rgba(255,255,255,0.06)",
        border: `1px solid rgba(${accentColor},0.4)`,
        borderRadius: 14,
        padding: "16px 20px",
      }}
    >
      <div style={{ color: `rgb(${accentColor})`, fontWeight: 700, fontSize: 22, marginBottom: 8 }}>{card.title}</div>
      {card.rows.map((row, i) => {
        const rowPop = spring({
          frame: Math.max(localFrame - 6 - i * 5, 0),
          fps,
          config: { damping: 12, stiffness: 170, mass: 0.5 },
        });
        return (
          <div
            key={i}
            style={{
              opacity: rowPop,
              transform: `translateY(${interpolate(rowPop, [0, 1], [8, 0])}px)`,
              color: "rgba(226,232,240,0.85)",
              fontSize: 19,
              lineHeight: 1.6,
            }}
          >
            {row}
          </div>
        );
      })}
    </div>
  );
};

// The window chrome + 3D tilt intentionally mirror AppWindowReveal (same
// perspective value, same traffic-light bar treatment, same slow
// sine-driven tilt) so a terminal insert reads as part of the same visual
// family as the browser-window mockup instead of a different design system
// bolted on.
export const TerminalWindow: React.FC<TerminalWindowProps> = ({ lines, accentColor, outputCard, width = 720 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const openPop = spring({ frame, fps, config: { damping: 12, stiffness: 110, mass: 0.7 } });
  const scale = interpolate(openPop, [0, 1], [0.25, 1]);
  const tiltX = Math.sin(t * 0.6) * 3;
  const tiltY = Math.cos(t * 0.5 + 1) * 4;

  const layout = layoutLines(lines, fps);
  const lastStartedIndex = layout.reduce((acc, w, i) => (frame >= w.start ? i : acc), 0);
  const allLinesDone = layout.length > 0 && frame >= layout[layout.length - 1].end;
  const outputStartFrame = layout.length > 0 ? layout[layout.length - 1].end + 4 : 0;

  return (
    <div style={{ perspective: 1200 }}>
      <div style={{ width, transform: `scale(${scale}) rotateX(${tiltX}deg) rotateY(${tiltY}deg)` }}>
        <div
          style={{
            borderRadius: 20,
            background: "#0B1220",
            boxShadow: "0 50px 90px rgba(0,0,0,0.5)",
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div
            style={{
              height: 42,
              background: "rgba(255,255,255,0.05)",
              display: "flex",
              alignItems: "center",
              gap: 9,
              paddingInline: 20,
            }}
          >
            <div style={{ width: 13, height: 13, borderRadius: 7, background: "#ef4444" }} />
            <div style={{ width: 13, height: 13, borderRadius: 7, background: "#f59e0b" }} />
            <div style={{ width: 13, height: 13, borderRadius: 7, background: "#22c55e" }} />
          </div>
          <div
            style={{
              padding: "26px 28px 32px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: 21,
              lineHeight: 1.7,
              direction: "ltr",
              textAlign: "left",
            }}
          >
            {lines.map((line, i) => (
              <TerminalLineRow
                key={i}
                line={line}
                start={layout[i].start}
                end={layout[i].end}
                accentColor={accentColor}
                isLastTypedLine={i === lastStartedIndex}
              />
            ))}
            {outputCard && allLinesDone ? (
              <OutputCard card={outputCard} startFrame={outputStartFrame} accentColor={accentColor} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export { layoutLines as computeTerminalLineLayout };
