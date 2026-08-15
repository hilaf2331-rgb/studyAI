import type React from "react";
import { useLayoutEffect, useRef, useState } from "react";
import rough from "roughjs";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// An editorial/news-card style callout -- a lighter, more "human" beat to
// break up the vibrant gradient look elsewhere in the reel, styled like a
// screenshot of a real article with a highlighter mark drawn under the key
// phrase (the way you'd mark up a printout by hand). Built with roughjs
// instead of a plain CSS underline/box specifically so the mark reads as
// hand-drawn -- imperfect, slightly wobbly -- rather than a machine-generated
// rectangle, which is what makes this style recognizable in the first place.
//
// The highlight itself is measured, not guessed: a useLayoutEffect reads the
// actual rendered size of the highlighted span (fonts/kerning make character
// counting unreliable) and only then draws the roughjs annotation, sized and
// positioned to match. useLayoutEffect (not useEffect) matters here --  it
// runs synchronously before the browser paints, so by the time Remotion
// captures this frame the measurement has already happened; useEffect would
// risk Remotion grabbing a frame before the highlight ever appears.
export interface ArticleHighlightCardProps {
  eyebrow: string; // small category label above the headline, e.g. "FEATURE"
  headline: string; // the full headline text
  highlightedPhrase: string; // must be an exact substring of headline -- gets the hand-drawn mark
  accentColor: string; // "r,g,b" -- same format as COLOR_THEMES entries
}

// Fixed (not random) seed -- roughjs uses it to pick the specific "wobble"
// of the hand-drawn line. A random seed would make the mark redraw
// differently every frame, which reads as flickering/jittery instead of a
// single confident highlighter stroke.
const HIGHLIGHT_SEED = 7412;

export const ArticleHighlightCard: React.FC<ArticleHighlightCardProps> = ({
  eyebrow,
  headline,
  highlightedPhrase,
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const highlightRef = useRef<HTMLSpanElement>(null);
  const [highlightBox, setHighlightBox] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = highlightRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setHighlightBox({ width: rect.width, height: rect.height });
  }, [headline, highlightedPhrase]);

  const entrance = spring({ frame, fps, config: { damping: 18, stiffness: 110, mass: 0.8 } });
  const blurPx = interpolate(entrance, [0, 1], [18, 0], { extrapolateRight: "clamp" });
  const opacity = interpolate(entrance, [0, 1], [0, 1], { extrapolateLeft: "clamp" });
  const scale = interpolate(entrance, [0, 1], [0.94, 1]);

  // The same slow, continuous tilt used elsewhere (AppWindowReveal) so this
  // card reads as part of the same visual family instead of a flat insert.
  const t = frame / fps;
  const tiltX = Math.sin(t * 0.6) * 2.5;
  const tiltY = Math.cos(t * 0.5 + 1) * 3;

  // Highlighter mark pops in a beat after the card itself, once the phrase
  // it's marking is actually on screen and measured.
  const highlightPop = spring({ frame: Math.max(frame - 10, 0), fps, config: { damping: 14, stiffness: 140, mass: 0.6 } });

  const [before, after] = headline.includes(highlightedPhrase)
    ? headline.split(highlightedPhrase)
    : [headline, ""];

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 90 }}>
      <div
        style={{
          transform: `perspective(1200px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${scale})`,
          filter: `blur(${blurPx}px)`,
          opacity,
          background: "white",
          borderRadius: 22,
          padding: "48px 52px",
          boxShadow: "0 40px 80px rgba(0,0,0,0.35)",
          maxWidth: 820,
        }}
      >
        <div
          style={{
            color: `rgb(${accentColor})`,
            fontWeight: 800,
            fontSize: 22,
            letterSpacing: 2,
            textTransform: "uppercase",
            marginBottom: 18,
          }}
        >
          {eyebrow}
        </div>
        <div style={{ fontSize: 46, fontWeight: 800, lineHeight: 1.3, color: "#0f172a", direction: "rtl" }}>
          {before}
          <span ref={highlightRef} style={{ position: "relative", display: "inline-block" }}>
            {highlightBox ? (
              <svg
                width={highlightBox.width + 16}
                height={highlightBox.height + 14}
                style={{
                  position: "absolute",
                  left: -8,
                  top: -6,
                  pointerEvents: "none",
                  opacity: interpolate(highlightPop, [0, 1], [0, 1], { extrapolateLeft: "clamp" }),
                }}
                ref={(svgEl) => {
                  if (!svgEl) return;
                  svgEl.innerHTML = "";
                  const rc = rough.svg(svgEl);
                  const progress = interpolate(highlightPop, [0, 1], [0, 1], { extrapolateLeft: "clamp" });
                  const drawnWidth = (highlightBox.width + 16) * progress;
                  const node = rc.rectangle(2, 2, Math.max(drawnWidth - 4, 0), highlightBox.height + 10, {
                    seed: HIGHLIGHT_SEED,
                    roughness: 1.8,
                    strokeWidth: 6,
                    stroke: `rgb(${accentColor})`,
                    fill: `rgba(${accentColor},0.14)`,
                    fillStyle: "solid",
                  });
                  svgEl.appendChild(node);
                }}
              />
            ) : null}
            {highlightedPhrase}
          </span>
          {after}
        </div>
      </div>
    </AbsoluteFill>
  );
};
