import type React from "react";
import { z } from "zod";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

// Loaded once at module scope per Remotion's own guidance (not per-frame) --
// Heebo is a clean, widely-used Hebrew webfont, bundled so the render never
// depends on whatever fonts (if any) happen to be installed on the machine
// running headless Chrome. Restricted to the two weights actually used
// (700/800) and the hebrew+latin subsets, instead of pulling every weight
// and subset Heebo ships.
const { fontFamily } = loadFont("normal", { weights: ["700", "800"], subsets: ["hebrew", "latin"] });

// A caption line with the seconds window (from ElevenLabs' character-level
// alignment, see video-agent.ts) during which it should be on screen,
// relative to the start of the narration audio -- keeps on-screen text
// roughly lip-synced instead of a fixed unrelated timer.
const captionSchema = z.object({
  text: z.string(),
  startSeconds: z.number(),
  endSeconds: z.number(),
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
const INTRO_SECONDS = 1.6;
const FADE_SECONDS = 0.4;
const OUTRO_TAIL_SECONDS = 1.2;

// Soft, slowly drifting gradient blobs behind the text -- the "Ken Burns"
// motion stand-in for videos that have no real footage to pan across, using
// FocusStudy's own brand navy (#0B1220, the same default HeyGen background
// color the old pipeline used) so the reel still reads as on-brand.
const KenBurnsBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: "clamp",
  });
  const drift = interpolate(progress, [0, 1], [0, 60], { easing: Easing.inOut(Easing.ease) });
  const scale = interpolate(progress, [0, 1], [1, 1.18], { easing: Easing.inOut(Easing.ease) });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0B1220", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          width: 1400,
          height: 1400,
          borderRadius: "50%",
          left: -400 + drift,
          top: -300,
          background: "radial-gradient(circle, rgba(99,102,241,0.35) 0%, rgba(99,102,241,0) 70%)",
          transform: `scale(${scale})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 1200,
          height: 1200,
          borderRadius: "50%",
          right: -350 - drift,
          bottom: -250,
          background: "radial-gradient(circle, rgba(56,189,248,0.30) 0%, rgba(56,189,248,0) 70%)",
          transform: `scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
};

// Fades a block of children in and out around [startSeconds, endSeconds],
// clamped to the composition's own bounds. The fade is shortened for very
// short windows (e.g. a one-word caption) so the four breakpoints interpolate
// requires stay strictly increasing instead of throwing.
const useWindowOpacity = (startSeconds: number, endSeconds: number): number => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const startFrame = startSeconds * fps;
  const endFrame = Math.max(endSeconds * fps, startFrame + 1);
  // Leaves a small gap between the two middle breakpoints even for very
  // short windows, since interpolate() requires strictly increasing input.
  const fadeFrames = Math.min(FADE_SECONDS * fps, ((endFrame - startFrame) / 2) * 0.9);

  return interpolate(
    frame,
    [startFrame, startFrame + fadeFrames, endFrame - fadeFrames, endFrame],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
};

// Only ever on screen during the silent intro (see the top-level layout
// below, which doesn't render this past INTRO_SECONDS) -- narration and
// captions start right as this finishes fading out.
const TitleCard: React.FC<{ title: string }> = ({ title }) => {
  const opacity = useWindowOpacity(0, INTRO_SECONDS);
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 15], [0.92, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 80 }}>
      <div
        style={{
          opacity,
          transform: `scale(${scale})`,
          color: "white",
          fontFamily,
          fontWeight: 800,
          fontSize: 92,
          textAlign: "center",
          direction: "rtl",
          lineHeight: 1.25,
        }}
      >
        {title}
      </div>
    </AbsoluteFill>
  );
};

const CaptionLine: React.FC<{ text: string; startSeconds: number; endSeconds: number }> = ({
  text,
  startSeconds,
  endSeconds,
}) => {
  const opacity = useWindowOpacity(startSeconds, endSeconds);
  if (opacity <= 0) return null;

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 100 }}>
      <div
        style={{
          opacity,
          color: "white",
          fontFamily,
          fontWeight: 700,
          fontSize: 64,
          textAlign: "center",
          direction: "rtl",
          lineHeight: 1.4,
          textShadow: "0 4px 24px rgba(0,0,0,0.45)",
        }}
      >
        {text}
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
      <KenBurnsBackground />
      <Sequence durationInFrames={introFrames}>
        <TitleCard title={title} />
      </Sequence>
      {/* Narration and its captions start only once the title card has
          fully faded out, so the two never share the screen. */}
      <Sequence from={introFrames}>
        {captions.map((caption, index) => (
          <CaptionLine key={index} {...caption} />
        ))}
        <Audio src={audioSrc} />
      </Sequence>
      <BrandFooter />
    </AbsoluteFill>
  );
};

export { INTRO_SECONDS, OUTRO_TAIL_SECONDS };
