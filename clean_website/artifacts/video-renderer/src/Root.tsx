import type React from "react";
import { Composition } from "remotion";
import { HelloWorld } from "./compositions/HelloWorld";
import { MarketingReel, marketingReelSchema, INTRO_SECONDS, OUTRO_TAIL_SECONDS } from "./compositions/MarketingReel";
import { TechniqueShowcase, techniqueShowcaseSchema } from "./compositions/TechniqueShowcase";

export const MARKETING_REEL_FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HelloWorld"
        component={HelloWorld}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="MarketingReel"
        component={MarketingReel}
        fps={MARKETING_REEL_FPS}
        width={1080}
        height={1920}
        // Overridden per-render by calculateMetadata below, based on the
        // actual narration length (video-agent.ts passes durationInSeconds
        // from the ElevenLabs alignment) -- this is just the Studio preview
        // default.
        durationInFrames={MARKETING_REEL_FPS * 15}
        schema={marketingReelSchema}
        defaultProps={{
          title: "FocusStudy",
          captions: [],
          audioSrc: "",
          durationInSeconds: 15,
          visualMotif: "generic",
          colorTheme: "violet",
          broll: undefined,
        }}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: Math.ceil(
            (INTRO_SECONDS + props.durationInSeconds + OUTRO_TAIL_SECONDS) * MARKETING_REEL_FPS,
          ),
        })}
      />
      {/* Evidence/preview composition for the remotion-video-editing
          skill's terminal-inserts and article-highlights techniques -- see
          TechniqueShowcase.tsx. Not part of the video-agent.ts render path. */}
      <Composition
        id="TechniqueShowcase"
        component={TechniqueShowcase}
        fps={30}
        width={1080}
        height={1920}
        durationInFrames={30 * 10}
        schema={techniqueShowcaseSchema}
        defaultProps={{ accentColor: "45,212,191" }}
      />
    </>
  );
};
