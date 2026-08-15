import type React from "react";
import { z } from "zod";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";
import { MOTIF_ANIMATIONS } from "./MotifAnimation";

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

// Which feature the reel is about, so the floating icon/bubble actually
// reflects the content instead of always showing the same generic glyph.
// video-agent.ts maps idea.visual_motif to this (falling back to "generic"
// for anything unrecognized), see VISUAL_MOTIF_ICONS below for the mapping.
const visualMotifSchema = z.enum(["chat", "recording", "flashcards", "summary", "exam", "podcast", "generic"]);

// Which color palette the background wash uses -- video-agent.ts derives
// this deterministically from the idea's id (see pickColorTheme there), so
// different ideas naturally get different-feeling videos instead of every
// reel sharing the exact same purple/blue/pink, without needing a person to
// hand-pick a palette per video.
const colorThemeSchema = z.enum(["violet", "sunrise", "ocean", "forest", "berry"]);

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
  visualMotif: visualMotifSchema,
  colorTheme: colorThemeSchema,
  // Filename (relative to the video-renderer's public dir, which
  // video-agent.ts points at marketing/assets/broll/) of a real clip the
  // user dropped in herself -- shown full-bleed behind the intro card when
  // present. Optional: the intro falls back to the plain VibrantBackground
  // wash when no clip was available to pick from.
  broll: z.string().optional(),
  // Three short, procedurally-synthesized sound effects (see
  // scripts/src/marketing/sfx.ts) as data URIs -- "pop" plays on each
  // spring pop-in (kinetic caption words, AppWindowReveal's lines/badge),
  // "whoosh" plays once on the opening hook's zoom-punch, "click" is a
  // sharper accent layered under a couple of the UI-reveal beats. Optional:
  // older renders / a missing prop just play silently, same as broll.
  sfx: z
    .object({
      pop: z.string(),
      click: z.string(),
      whoosh: z.string(),
    })
    .optional(),
});

type Props = z.infer<typeof marketingReelSchema>;

// Each theme is the three background-blob colors, in the same order as the
// three <div>s in VibrantBackground -- alpha stays fixed per-blob (set
// where each color is used) so only the hue identity changes per theme.
const COLOR_THEMES: Record<z.infer<typeof colorThemeSchema>, [string, string, string]> = {
  violet: ["168,85,247", "56,189,248", "244,114,182"],
  sunrise: ["251,146,60", "244,63,94", "250,204,21"],
  ocean: ["45,212,191", "59,130,246", "34,211,238"],
  forest: ["74,222,128", "45,212,191", "163,230,53"],
  berry: ["217,70,239", "244,63,94", "139,92,246"],
};

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
const VibrantBackground: React.FC<{ theme: z.infer<typeof colorThemeSchema> }> = ({ theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const [colorA, colorB, colorC] = COLOR_THEMES[theme];

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
            background: `radial-gradient(circle, rgba(${colorA},0.55) 0%, rgba(${colorA},0) 70%)`,
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
            background: `radial-gradient(circle, rgba(${colorB},0.5) 0%, rgba(${colorB},0) 70%)`,
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
            background: `radial-gradient(circle, rgba(${colorC},0.45) 0%, rgba(${colorC},0) 70%)`,
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
// A little browser/app-window mockup that pops open and "loads in" its
// content (header bar + two text-line bars, staggered), instead of just a
// static icon -- a stylized stand-in for the actual FocusStudy UI so the
// hook reads as "this is a real product," not just an abstract glyph. Sits
// in 3D perspective with a slow, continuous tilt for extra life, and wears
// a small badge in the corner with the same per-feature motif icon used
// elsewhere (see MOTIF_ANIMATIONS) so the two visual languages tie together.
const AppWindowReveal: React.FC<{
  motif: z.infer<typeof visualMotifSchema>;
  accentColor: string;
  sfx?: Props["sfx"];
}> = ({ motif, accentColor, sfx }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const openPop = spring({ frame, fps, config: { damping: 12, stiffness: 110, mass: 0.7 } });
  const scale = interpolate(openPop, [0, 1], [0.25, 1]);
  const headerPop = spring({ frame: Math.max(frame - 10, 0), fps, config: { damping: 12, stiffness: 170, mass: 0.5 } });
  const line1Pop = spring({ frame: Math.max(frame - 16, 0), fps, config: { damping: 12, stiffness: 170, mass: 0.5 } });
  const line2Pop = spring({ frame: Math.max(frame - 21, 0), fps, config: { damping: 12, stiffness: 170, mass: 0.5 } });
  const badgePop = spring({ frame: Math.max(frame - 26, 0), fps, config: { damping: 10, stiffness: 160, mass: 0.5 } });
  const badgeScale = interpolate(badgePop, [0, 1], [0.2, 1]);

  const tiltX = Math.sin(t * 0.7) * 4;
  const tiltY = Math.cos(t * 0.55 + 1) * 5;
  const MotifIcon = MOTIF_ANIMATIONS[motif];

  return (
    <div style={{ perspective: 1200 }}>
      <div
        style={{
          width: 620,
          height: 380,
          position: "relative",
          transform: `scale(${scale}) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 26,
            background: "rgba(255,255,255,0.97)",
            boxShadow: "0 50px 90px rgba(0,0,0,0.5)",
            overflow: "hidden",
          }}
        >
          {/* Browser-chrome top bar. */}
          <div style={{ height: 42, background: "rgba(15,23,42,0.06)", display: "flex", alignItems: "center", gap: 9, paddingInline: 20 }}>
            <div style={{ width: 13, height: 13, borderRadius: 7, background: "#ef4444" }} />
            <div style={{ width: 13, height: 13, borderRadius: 7, background: "#f59e0b" }} />
            <div style={{ width: 13, height: 13, borderRadius: 7, background: "#22c55e" }} />
          </div>
          {/* Content "loading in", right-aligned like real Hebrew UI text. */}
          <div style={{ padding: "30px 34px", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 18 }}>
            <div style={{ height: 34, width: 240 * headerPop, borderRadius: 8, background: `rgb(${accentColor})` }} />
            <div style={{ height: 18, width: 420 * line1Pop, borderRadius: 6, background: "rgba(15,23,42,0.16)" }} />
            <div style={{ height: 18, width: 300 * line2Pop, borderRadius: 6, background: "rgba(15,23,42,0.16)" }} />
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            bottom: -26,
            left: -26,
            width: 96,
            height: 96,
            borderRadius: 26,
            background: "linear-gradient(135deg, rgba(255,255,255,0.24), rgba(255,255,255,0.06))",
            border: "1px solid rgba(255,255,255,0.32)",
            boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${badgeScale})`,
          }}
        >
          <MotifIcon color={accentColor} />
        </div>
      </div>
      {/* Sound design: a click on each UI element "appearing" (matches the
          keyboard-click/mouse-click texture the user described from a
          reference reel of a similar UI-build-up animation), landing at the
          exact same frame offsets as the spring pops above. */}
      {sfx ? (
        <>
          <Sequence from={10}>
            <Audio src={sfx.click} />
          </Sequence>
          <Sequence from={16}>
            <Audio src={sfx.click} />
          </Sequence>
          <Sequence from={21}>
            <Audio src={sfx.click} />
          </Sequence>
          <Sequence from={26}>
            <Audio src={sfx.pop} />
          </Sequence>
        </>
      ) : null}
    </div>
  );
};

// A real clip the user generated herself (e.g. in Google Flow) and dropped
// into marketing/assets/broll/ -- shown full-bleed behind the app-window
// mockup for the intro's duration, so the hook opens on real footage
// instead of only the procedural gradient wash. Muted (the narration audio
// is the only soundtrack) and dimmed with the same vignette style as
// VibrantBackground so the title text on top stays legible regardless of
// what the clip itself looks like.
const BrollBackdrop: React.FC<{ filename: string }> = ({ filename }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = spring({ frame, fps, config: { damping: 20, stiffness: 90 } });

  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <OffthreadVideo src={staticFile(filename)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <AbsoluteFill
        style={{ background: "linear-gradient(180deg, rgba(11,18,32,0.5) 0%, rgba(11,18,32,0.8) 100%)" }}
      />
    </AbsoluteFill>
  );
};

const IntroCard: React.FC<{
  title: string;
  motif: z.infer<typeof visualMotifSchema>;
  accentColor: string;
  broll?: string;
  sfx?: Props["sfx"];
}> = ({ title, motif, accentColor, broll, sfx }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titlePop = spring({ frame: Math.max(frame - 6, 0), fps, config: { damping: 12, stiffness: 130, mass: 0.7 } });
  const fadeOut = useFadeOut(INTRO_SECONDS, 0.3);

  const titleScale = interpolate(titlePop, [0, 1], [0.7, 1]);
  const titleOpacity = interpolate(titlePop, [0, 1], [0, 1], { extrapolateLeft: "clamp" });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: fadeOut }}>
      {broll ? <BrollBackdrop filename={broll} /> : null}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 44, padding: 80 }}>
        <AppWindowReveal motif={motif} accentColor={accentColor} sfx={sfx} />
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

// A floating speech/chat-bubble companion that lives alongside the
// captions for the whole narration (not just the intro) -- the layered
// "app UI" element requested on top of plain text-over-background. Pops
// in with a spring right as the narration starts, then gently bobs and
// sways for the rest of the video.
const MessageBubble: React.FC<{
  motif: z.infer<typeof visualMotifSchema>;
  accentColor: string;
  sfx?: Props["sfx"];
}> = ({ motif, accentColor, sfx }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 10, stiffness: 120, mass: 0.6 } });
  const scale = interpolate(pop, [0, 1], [0.2, 1]);
  const t = frame / fps;
  const bob = Math.sin(t * 1.3) * 14;
  const sway = Math.sin(t * 0.9 + 1) * 4;
  const MotifIcon = MOTIF_ANIMATIONS[motif];

  return (
    <AbsoluteFill style={{ alignItems: "flex-end" }}>
      <div
        style={{
          position: "absolute",
          top: 230,
          right: 110,
          transform: `scale(${scale}) translateY(${bob}px) rotate(${sway}deg)`,
        }}
      >
        <div
          style={{
            position: "relative",
            width: 128,
            height: 128,
            borderRadius: 32,
            background: "linear-gradient(135deg, rgba(255,255,255,0.22), rgba(255,255,255,0.06))",
            border: "1px solid rgba(255,255,255,0.3)",
            boxShadow: "0 20px 45px rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MotifIcon color={accentColor} />
          {/* Speech-bubble tail. */}
          <div
            style={{
              position: "absolute",
              bottom: -14,
              left: 34,
              width: 0,
              height: 0,
              borderStyle: "solid",
              borderWidth: "0 18px 18px 0",
              borderColor: "transparent rgba(255,255,255,0.14) transparent transparent",
              transform: "rotate(20deg)",
            }}
          />
        </div>
      </div>
      {sfx ? (
        <Sequence from={0}>
          <Audio src={sfx.pop} />
        </Sequence>
      ) : null}
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

// A slow, continuous "handheld camera" drift over the frame -- zoom, pan,
// and a slight rotation, all riding on their own independent sine waves so
// the motion never feels like a simple repeating loop. Deliberately subtle:
// zooming in on a *fixed* canvas (not an oversized one) crops the edges as
// it goes, so the ranges here are sized to stay clear of the near-edge
// content that lives inside this wrapper (the message bubble sits in the
// top-right corner, captions get horizontal padding) -- see the margin
// math in the commit message for how these bounds were picked. The brand
// footer is deliberately kept *outside* this wrapper (a fixed watermark
// that doesn't ride along), both because it sits closest to an edge and
// because a static logo reads more like a real video overlay.
const CameraDrift: React.FC<{ children: React.ReactNode; sfx?: Props["sfx"] }> = ({ children, sfx }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const ambientZoom = interpolate(Math.sin(t * 0.25), [-1, 1], [1.04, 1.1]);
  // The hook: starts punched in tight and settles back to the ambient drift
  // over the first ~0.6s, so the very first frame already reads as "the
  // camera is moving" instead of easing in gently -- only the centered
  // intro card (icon+title) is on screen this early, so a bigger punch is
  // safe here even though the ambient range above is kept much smaller to
  // avoid clipping the corner message bubble later in the video.
  const hookSettle = spring({ frame, fps, config: { damping: 14, stiffness: 120, mass: 0.8 } });
  const hookPunch = interpolate(hookSettle, [0, 1], [0.32, 0]);
  const zoom = ambientZoom + hookPunch;
  const panX = Math.sin(t * 0.18 + 1) * 16;
  const panY = Math.cos(t * 0.15 + 0.5) * 14;
  const rotate = Math.sin(t * 0.12) * 0.8;

  return (
    <AbsoluteFill
      style={{
        transform: `scale(${zoom}) translate(${panX}px, ${panY}px) rotate(${rotate}deg)`,
        transformOrigin: "center",
      }}
    >
      {children}
      {sfx ? (
        <Sequence from={0}>
          <Audio src={sfx.whoosh} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

// durationInSeconds isn't read here -- calculateMetadata in Root.tsx uses it
// (via the same props, together with INTRO_SECONDS/OUTRO_TAIL_SECONDS) to
// size the composition before this component mounts.
export const MarketingReel: React.FC<Props> = ({ title, captions, audioSrc, visualMotif, colorTheme, broll, sfx }) => {
  const { fps } = useVideoConfig();
  const introFrames = Math.round(INTRO_SECONDS * fps);
  // The motif icon/bubble pick up the theme's first (dominant) blob color,
  // so they read as part of the same palette rather than a fixed white/gray.
  const [accentColor] = COLOR_THEMES[colorTheme];

  return (
    <AbsoluteFill>
      <CameraDrift sfx={sfx}>
        <VibrantBackground theme={colorTheme} />
        <Sequence durationInFrames={introFrames}>
          <IntroCard title={title} motif={visualMotif} accentColor={accentColor} broll={broll} sfx={sfx} />
        </Sequence>
        {/* Narration and its captions start only once the intro card has
            fully faded out, so the two never share the screen. */}
        <Sequence from={introFrames}>
          <MessageBubble motif={visualMotif} accentColor={accentColor} sfx={sfx} />
          {captions.map((caption, index) => (
            <CaptionLineKinetic key={index} {...caption} />
          ))}
          <Audio src={audioSrc} />
        </Sequence>
      </CameraDrift>
      <BrandFooter />
    </AbsoluteFill>
  );
};

export { INTRO_SECONDS, OUTRO_TAIL_SECONDS };
