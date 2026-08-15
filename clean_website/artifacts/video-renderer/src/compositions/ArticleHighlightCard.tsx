import type React from "react";
import { useMemo } from "react";
import rough from "roughjs/bin/rough";
import type { Op, OpSet } from "roughjs/bin/core";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// Technique 4 ("article-highlights") from the remotion-video-editing skill
// -- an editorial/news-style card with a hand-drawn highlighter stroke over
// the key phrase, a blur-in entrance, and a subtle 3D settle.

interface ArticleHighlightCardProps {
  kicker: string; // small label above the headline, e.g. a section/category tag
  headline: string;
  body?: string;
  highlightPhrase: string; // must appear verbatim inside `headline`
  accentColor: string; // "r,g,b"
  width?: number;
}

// roughjs's generator calls Math.random() internally for its "sketchy"
// jitter unless given a fixed seed -- Remotion keeps this component mounted
// for the composition's whole duration and re-renders it every frame (only
// useCurrentFrame() changes), so an unseeded generator would redraw a
// *different* wobbly line on every single frame, reading as a flickering
// scribble instead of one stroke. The seed's exact value doesn't matter,
// only that it's fixed, so the same shape comes out every render.
const ROUGH_SEED = 7412;

// Converts a roughjs OpSet (move/lineTo/bcurveTo commands) into a plain SVG
// path `d` string. Using the no-DOM generator (rough/bin/rough's
// `generator()`) instead of rough/bin/svg's DOM-attaching API, because we
// need the raw path data ourselves to drive a strokeDasharray "draw-on"
// reveal keyed to the video's frame -- rough/svg would hand us a finished
// <path> node with no reveal control.
function opSetToPathD(opSet: OpSet): string {
  return opSet.ops
    .map((op: Op) => {
      switch (op.op) {
        case "move":
          return `M${op.data[0]} ${op.data[1]}`;
        case "lineTo":
          return `L${op.data[0]} ${op.data[1]}`;
        case "bcurveTo":
          return `C${op.data[0]} ${op.data[1]}, ${op.data[2]} ${op.data[3]}, ${op.data[4]} ${op.data[5]}`;
        default:
          return "";
      }
    })
    .join(" ");
}

// A generous overestimate of the rough rectangle's own path length, in its
// normalized 0-100/0-34 coordinate space (see viewBox below) -- exact
// length isn't worth computing here since the dash pattern is a single
// [length, length] pair: any value at or above the true length draws the
// same "line appears, then nothing" reveal, just with more empty gap
// budgeted after it, which is invisible either way.
const DASH_LENGTH = 420;

// Builds the rough "highlighter" shape once (empty deps -- the geometry is
// fully deterministic given ROUGH_SEED, nothing here varies per prop)
// rather than re-running roughjs's generator every frame. Only extracts
// *geometry*: paint (color/width) is applied on the <path> element itself
// where this is used, since generator.rectangle()'s own stroke/fill options
// only matter to roughjs's own canvas/svg renderers, which opSetToPathD
// bypasses entirely.
function useHighlighterPath(): string {
  return useMemo(() => {
    const generator = rough.generator();
    // A slightly-overlapping double-pass rectangle (roughjs's own
    // "roughness" already draws each edge more than once) reads as a real
    // highlighter mark -- a single clean stroke looks too much like a
    // plain underline.
    const drawable = generator.rectangle(2, 4, 96, 26, {
      seed: ROUGH_SEED,
      roughness: 2.2,
      bowing: 1.5,
    });
    return drawable.sets.map(opSetToPathD).join(" ");
  }, []);
}

export const ArticleHighlightCard: React.FC<ArticleHighlightCardProps> = ({
  kicker,
  headline,
  body,
  highlightPhrase,
  accentColor,
  width = 760,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({ frame, fps, config: { damping: 14, stiffness: 120, mass: 0.8 } });
  const scale = interpolate(entrance, [0, 1], [0.9, 1]);
  const opacity = interpolate(entrance, [0, 1], [0, 1], { extrapolateLeft: "clamp" });
  const blurPx = interpolate(entrance, [0, 1], [14, 0], { extrapolateLeft: "clamp" });
  const rotateY = interpolate(entrance, [0, 1], [6, 0]);

  // Highlighter stroke starts drawing a beat after the card itself has
  // mostly settled -- reads as "the pen underlines it" after the text has
  // already appeared, not simultaneously with the card popping in.
  const strokeStart = 14;
  const strokeReveal = interpolate(frame, [strokeStart, strokeStart + 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dashOffset = interpolate(strokeReveal, [0, 1], [DASH_LENGTH, 0]);

  const pathD = useHighlighterPath();

  const headlineParts = headline.split(highlightPhrase);
  // If highlightPhrase isn't actually found inside headline, fall back to
  // showing the plain headline with no highlight rather than silently
  // dropping the phrase -- a caller typo shouldn't produce a card that's
  // missing words.
  const hasHighlight = headlineParts.length > 1;

  return (
    <div style={{ perspective: 1400 }}>
      <div
        style={{
          width,
          transform: `scale(${scale}) rotateY(${rotateY}deg)`,
          opacity,
          filter: `blur(${blurPx}px)`,
        }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.98)",
            borderRadius: 24,
            boxShadow: "0 50px 90px rgba(0,0,0,0.5)",
            padding: "40px 44px",
            direction: "rtl",
            textAlign: "right",
          }}
        >
          <div
            style={{
              color: `rgb(${accentColor})`,
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: 0.5,
              marginBottom: 14,
            }}
          >
            {kicker}
          </div>
          <div style={{ fontWeight: 800, fontSize: 44, lineHeight: 1.35, color: "#0f172a" }}>
            {hasHighlight ? (
              <>
                {headlineParts[0]}
                <span style={{ position: "relative", display: "inline-block" }}>
                  {highlightPhrase}
                  <svg
                    viewBox="0 0 100 34"
                    preserveAspectRatio="none"
                    style={{ position: "absolute", inset: "-6px -8px", width: "calc(100% + 16px)", height: "calc(100% + 12px)" }}
                  >
                    <path
                      d={pathD}
                      fill="none"
                      stroke={`rgba(${accentColor},0.9)`}
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={DASH_LENGTH}
                      strokeDashoffset={dashOffset}
                    />
                  </svg>
                </span>
                {headlineParts.slice(1).join(highlightPhrase)}
              </>
            ) : (
              headline
            )}
          </div>
          {body ? (
            <div style={{ marginTop: 18, fontSize: 26, lineHeight: 1.6, color: "rgba(15,23,42,0.72)" }}>{body}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
