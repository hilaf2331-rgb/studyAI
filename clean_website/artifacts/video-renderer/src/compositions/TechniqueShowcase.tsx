import type React from "react";
import { z } from "zod";
import { AbsoluteFill, Sequence } from "remotion";
import { TerminalWindow } from "./TerminalWindow";
import { ArticleHighlightCard } from "./ArticleHighlightCard";

// Preview/evidence composition for the remotion-video-editing skill's
// Technique 3 (terminal-inserts) and Technique 4 (article-highlights) --
// not part of the video-agent.ts render path. Its only job is to give
// `remotion studio`/`remotion render` something to point at so each
// technique can actually be looked at (the skill's own "Evidence" gate
// step), independent of wiring either one into MarketingReel yet.

export const techniqueShowcaseSchema = z.object({
  accentColor: z.string(),
});

type Props = z.infer<typeof techniqueShowcaseSchema>;

const TERMINAL_SECONDS = 5;

export const TechniqueShowcase: React.FC<Props> = ({ accentColor }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0B1220" }}>
      <Sequence durationInFrames={TERMINAL_SECONDS * 30}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <TerminalWindow
            accentColor={accentColor}
            lines={[
              { text: "pnpm run render -- --idea idea-2026-07-31-002", variant: "command" },
              { text: "Synthesizing narration for \"מהקלטת שיעור...\"...", variant: "output" },
              { text: "Rendering MarketingReel...", variant: "output" },
              { text: "Uploaded. Ready for review.", variant: "success" },
            ]}
            outputCard={{
              title: "idea-2026-07-31-002",
              rows: ["summary: 1 doc", "flashcard deck: 18 cards", "practice quiz: 10 questions"],
            }}
          />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={TERMINAL_SECONDS * 30}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <ArticleHighlightCard
            accentColor={accentColor}
            kicker="FocusStudy"
            headline="הקלטת שיעור אחת הופכת לערכת לימוד מלאה תוך דקות"
            highlightPhrase="ערכת לימוד מלאה"
            body="סיכום, כרטיסיות ומבחן תרגול - בלי לשבת שעות לעבד את ההקלטה לבד."
          />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
