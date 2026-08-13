import type React from "react";
import { z } from "zod";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

// Loaded once at module scope per Remotion's own guidance (not per-frame) --
// Heebo is a clean, widely-used Hebrew webfont, bundled so the render never
// depends on whatever fonts (if any) happen to be installed on the machine
// running headless Chrome. Restricted to the weights actually used and the
// hebrew+latin subsets, instead of pulling every weight/subset Heebo ships.
const { fontFamily } = loadFont("normal", { weights: ["700", "800", "900"], subsets: ["hebrew", "latin"] });

const wordSchema = z.object({
  text: z.string(),
  startSeconds: z.number(),
  endSeconds: z.number(),
});

// A caption line with the seconds window (from ElevenLabs' character-level
// alignment, see video-agent.ts) during which it should be on screen, plus
// its own words' individual windows -- lets each word pop in on its own
// beat instead of the whole line fading in as one block.
const captionSchema = z.object({
  text: z.string(),
  startSeconds: z.number(),
  endSeconds: z.number(),
  words: z.array(wordSchema),
});

export const marketingReelSchema = z.object({
  title: z.string(),
  captions: z.array(captionSchema),
  // A playable URL for the narration -- video-agent.ts passes this as a
  // "data:audio/mpeg;base64,..." URI built straight from ElevenLabs' response,
  // so no public/ dir or extra bundling step is needed for the audio itself.
  audioSrc: z.string(),
  // Total narration length; calculateMetadata (see Root.tsx) uses this,
  // together with INTRO_SECONDS/OUTRO_TAIL_SECONDS below, to size the
  // composition instead of a fixed guessed duration.
  durationInSeconds: z.number(),
});

type Props = z.infer<typeof marketingReelSchema>;

// A brief silent title card before the narration starts -- long enough to
// read the hook, short enough not to drag. Also doubles as how long the
// narration/captions are delayed by (see the <Sequence> below), so the
// title card and the first caption never occupy the screen at once.
const INTRO_SECONDS = 1.8;
const OUTRO_TAIL_SECONDS = 1.2;

// One-directional fade-out ending at endSeconds -- entrances in this
// composition are all handled by spring() pops instead, so nothing needs a
// matching fade-in here.
const useFadeOut = (endSeconds: number, fadeSeconds = 0.35): number => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const endFrame = endSeconds * fps;
  const fadeFrames = fadeSeconds * fps;
  return interpolate(frame, [endFrame - fadeFrames, endFrame], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
};

// Vibrant, continuously-orbiting color wash -- more saturated and alive
// than a static gradient, closer to the energetic backgrounds of a
// product-launch ad than FocusStudy's own dashboard navy. Three blobs
// orbit their own centers at different speeds/radii/phases so the motion
// never looks like simple one-directional drift or a repeating loop.
const VibrantBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const orbit = (speed: number, radius: number, phase: number) => ({
    x: Math.cos(t * speed + phase) * radius,
    y: Math.sin(t * speed + phase) * radius,
  });
  const a = orbit(0.35, 90, 0);
  const b = orbit(0.28, 110, 2.1);
  const c = orbit(0.4, 70, 4.2);
  const breathe = interpolate(Math.sin(t * 0.6), [-1, 1], [1, 1.12]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0B1220", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${breathe})` }}>
        <div
          style={{
            position: "absolute",
            width: 1300,
            height: 1300,
            borderRadius: "50%",
            left: -110 + a.x,
            top: 50 + a.y,
            background: "radial-gradient(circle, rgba(168,85,247,0.55) 0%, rgba(168,85,247,0) 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 1100,
            height: 1100,
            borderRadius: "50%",
            left: -10 + b.x,
            top: 550 + b.y,
            background: "radial-gradient(circle, rgba(56,189,248,0.5) 0%, rgba(56,189,248,0) 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 1000,
            height: 1000,
            borderRadius: "50%",
            left: 40 + c.x,
            top: -100 + c.y,
            background: "radial-gradient(circle, rgba(244,114,182,0.45) 0%, rgba(244,114,182,0) 70%)",
          }}
        />
      </div>
      {/* Vignette so text stays legible over the brighter, busier colors. */}
      <AbsoluteFill
        style={{ background: "radial-gradient(ellipse at center, rgba(11,18,32,0) 30%, rgba(11,18,32,0.75) 100%)" }}
      />
    </AbsoluteFill>
  );
};

// The silent hook: a floating glass icon that pops in with a spring bounce
// (the signature motion of product-launch-style ads) and gently bobs, then
// the title pops in a beat after it. Both fade out together at INTRO_SECONDS
// so the narration/captions never overlap them.
const IntroCard: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const iconPop = spring({ frame, fps, config: { damping: 11, stiffness: 140, mass: 0.6 } });
  const titlePop = spring({ frame: Math.max(frame - 6, 0), fps, config: { damping: 12, stiffness: 130, mass: 0.7 } });
  const bob = Math.sin((frame / fps) * 1.8) * 8;
  const fadeOut = useFadeOut(INTRO_SECONDS, 0.3);

  const iconScale = interpolate(iconPop, [0, 1], [0.3, 1]);
  const titleScale = interpolate(titlePop, [0, 1], [0.7, 1]);
  const titleOpacity = interpolate(titlePop, [0, 1], [0, 1], { extrapolateLeft: "clamp" });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: fadeOut }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 48, padding: 80 }}>
        <div
          style={{
            transform: `scale(${iconScale}) translateY(${bob}px)`,
            width: 200,
            height: 200,
            borderRadius: 44,
            background: "linear-gradient(135deg, rgba(255,255,255,0.20), rgba(255,255,255,0.04))",
            border: "1px solid rgba(255,255,255,0.28)",
            boxShadow: "0 30px 70px rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 100,
          }}
        >
          💡
        </div>
        <div
          style={{
            transform: `scale(${titleScale})`,
            opacity: titleOpacity,
            color: "white",
            fontFamily,
            fontWeight: 900,
            fontSize: 88,
            textAlign: "center",
            direction: "rtl",
            lineHeight: 1.25,
          }}
        >
          {title}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// One word, popping in with a spring bounce right as it's spoken (per-word
// timing from ElevenLabs' alignment, relative to this line's own Sequence).
// Frozen at full size once its spring has run rather than fading back out --
// words accumulate and the whole line fades out together at the end.
const KineticWord: React.FC<{ word: { text: string; startSeconds: number; endSeconds: number } }> = ({ word }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = frame - word.startSeconds * fps;
  const pop = spring({ frame: Math.max(localFrame, 0), fps, config: { damping: 12, stiffness: 200, mass: 0.5 } });
  const scale = interpolate(pop, [0, 1], [0.4, 1]);
  const opacity = interpolate(pop, [0, 1], [0, 1], { extrapolateLeft: "clamp" });

  return (
    <span style={{ display: "inline-block", transform: `scale(${scale})`, opacity, marginInline: 8 }}>
      {word.text}
    </span>
  );
};

const CaptionLineKinetic: React.FC<z.infer<typeof captionSchema>> = ({ startSeconds, endSeconds, words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeOut = useFadeOut(endSeconds);
  const startFrame = startSeconds * fps;
  const endFrame = Math.max(endSeconds * fps, startFrame + 1);
  const isActive = frame >= startFrame - 2 && frame <= endFrame + 12;
  if (!isActive) return null;

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 90 }}>
      <div
        style={{
          opacity: fadeOut,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          direction: "rtl",
          fontFamily,
          fontWeight: 800,
          fontSize: 66,
          color: "white",
          textShadow: "0 6px 28px rgba(0,0,0,0.5)",
          lineHeight: 1.35,
        }}
      >
        {words.map((word, index) => (
          <KineticWord key={index} word={word} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const BrandFooter: React.FC = () => (
  <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 90 }}>
    <div
      style={{
        color: "rgba(255,255,255,0.55)",
        fontFamily,
        fontWeight: 700,
        fontSize: 34,
        letterSpacing: 1,
      }}
    >
      FocusStudy
    </div>
  </AbsoluteFill>
);

// durationInSeconds isn't read here -- calculateMetadata in Root.tsx uses it
// (via the same props, together with INTRO_SECONDS/OUTRO_TAIL_SECONDS) to
// size the composition before this component mounts.
export const MarketingReel: React.FC<Props> = ({ title, captions, audioSrc }) => {
  const { fps } = useVideoConfig();
  const introFrames = Math.round(INTRO_SECONDS * fps);

  return (
    <AbsoluteFill>
      <VibrantBackground />
      <Sequence durationInFrames={introFrames}>
        <IntroCard title={title} />
      </Sequence>
      {/* Narration and its captions start only once the intro card has
          fully faded out, so the two never share the screen. */}
      <Sequence from={introFrames}>
        {captions.map((caption, index) => (
          <CaptionLineKinetic key={index} {...caption} />
        ))}
        <Audio src={audioSrc} />
      </Sequence>
      <BrandFooter />
    </AbsoluteFill>
  );
};

export { INTRO_SECONDS, OUTRO_TAIL_SECONDS };
