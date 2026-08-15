---
name: remotion-video-editing
description: Use whenever creating, editing, or reviewing a Remotion composition in clean_website/artifacts/video-renderer (the FocusStudy Reels pipeline driven by clean_website/scripts/src/marketing/video-agent.ts). Encodes five editing techniques -- an authenticity/QA gate, cinematic camera movement, terminal-insert cards, article-highlight cards, and synced sound design -- so every reel that gets rendered follows the same visual/audio language instead of each session inventing its own style. Trigger on "edit the reel", "new composition", "add a scene", "make it more cinematic", "add a terminal/code insert", "add an article/news card", "add sound effects", or any work touching MarketingReel.tsx, MotifAnimation.tsx, or Root.tsx.
---

# Remotion Video Editing — FocusStudy Reels

This skill is the house style for every Remotion composition rendered by
`clean_website/scripts/src/marketing/video-agent.ts` into
`clean_website/artifacts/video-renderer`. It exists because a video pipeline
with no shared editing discipline drifts: every session invents its own
camera language, its own idea of what counts as "on brand," and its own
definition of "done." These four techniques are that shared discipline.

They come from studying how skilled short-form editors (motion-graphics
creators doing AI/product content) structure their work into a **gate**
(a QA discipline, not a visual) and three **formats** (concrete on-screen
building blocks). Treat them the same way here: technique 1 is something you
run through before calling ANY composition finished; techniques 2-4 are
things you build with.

Read `clean_website/artifacts/video-renderer/src/compositions/MarketingReel.tsx`
and `MotifAnimation.tsx` before writing new code here — they already
establish the concrete conventions (spring configs, perspective wrapper
pattern, color themes, fonts) referenced throughout this skill. Don't
reinvent a pattern that composition already has a working version of.

## Technique 1 — Authenticity Gate (run before shipping ANY composition)

This is not a visual effect. It is the checklist that decides whether a
render is allowed into `marketing/video/queue.json` as `ready_for_review`.
A beautiful composition that fails this gate is not done.

1. **Research** — every on-screen claim, number, or workflow must trace back
   to a real feature. Follow the same convention `marketing/ideas/backlog.json`
   already uses: cite the exact file, e.g. `feature:clean_website/artifacts/study-platform/src/pages/recorder.tsx`.
   Never animate a capability the product doesn't actually have.
2. **Authentic logos/product surfaces** — any UI mockup on screen (see
   `AppWindowReveal` in MarketingReel.tsx) must read as *this* product:
   the real brand colors (`primary hsl(195 85% 38%)`, `secondary hsl(28 90%
   58%)`), real Hebrew RTL copy in Heebo/Rubik, the real logo
   (`clean_website/artifacts/study-platform/public/logo.png`) — never a
   generic "app-looking" stand-in.
3. **Reference selection** — before animating a new camera move or card
   style, name 1-2 concrete references (an existing FocusStudy reel, a
   specific competitor Reel, or an existing component in this codebase) and
   say which one you're matching. "Something like a product launch ad" is
   not a reference; a linked example or a described specific reel is.
4. **Art direction** — stay inside the established system: the five
   `COLOR_THEMES` (violet/sunrise/ocean/forest/berry) in MarketingReel.tsx,
   Heebo/Rubik typography, the existing spring-pop entrance language. Adding
   a sixth theme or a new font is a deliberate decision to call out, not a
   drive-by choice.
5. **Evidence** — before marking work done, actually render (or at minimum
   `remotion studio` preview) the composition and look at real frames. A
   diff that "should look right" based on reading the code is not evidence.
6. **Independent criticism** — get a second look before shipping: run
   `/code-review` or `/simplify` on the diff, or explicitly re-open the
   rendered frames with fresh eyes asking "does this look like stock
   motion-graphics filler, or does it look like FocusStudy." If it could be
   any SaaS product's generic promo video, it fails this step.
7. **Delivery authorization** — nothing gets pushed to
   `marketing/video/queue.json` with `status: ready_for_review`, and nothing
   gets published via the publish-agent, until steps 1-6 all pass.

## Technique 2 — Cinematic Camera (movement)

**One continuous world + a keyframed camera rig.** Don't hard-cut between
disconnected static frames — build one continuous background/scene (like
`VibrantBackground` + `CameraDrift` already do in MarketingReel.tsx) and
move a single virtual camera across it. In Remotion terms: wrap the whole
scene in one `AbsoluteFill` and drive `transform: scale(...) translate(...)
rotate(...)` off `interpolate`/`spring` tied to `useCurrentFrame()` —
exactly the pattern `CameraDrift` already implements. New compositions
should extend that wrapper, not create a second, disconnected camera system.

**Choreography grammar** — reuse this small, consistent vocabulary of moves
instead of inventing new physics per video:
- *Settle-punch*: start punched in tight, spring-settle to the ambient
  drift over ~0.6s (see `hookPunch`/`hookSettle` in `CameraDrift`) — reads
  as "the camera is already moving" from frame 1.
- *Ambient drift*: slow independent sine waves on zoom/pan/rotate at
  different speeds/phases (see `ambientZoom`, `panX`, `panY`, `rotate`) so
  motion never looks like a repeating loop.
- *Orbit*: elements circling their own center at different speed/radius/
  phase (see `orbit()` in `VibrantBackground`) for background elements that
  should feel alive without competing with foreground motion.
- *Spring pop*: entrances use `spring({ damping: 10-14, stiffness: 110-200,
  mass: 0.5-0.8 })` scaled from ~0.2-0.4 to 1 — never a linear fade/scale.
  Match the damping/stiffness ranges already used per element type (bigger,
  slower elements get lower stiffness; small badges/words get higher).

**Reference-review gate** — before finalizing a new camera move, scrub the
Remotion Studio timeline frame-by-frame against the reference named in
Technique 1, step 3. If it doesn't match the reference's *feel* (not just
its shape), it's not there yet.

**Delivery QA** — check for edge clipping. A zoomed/panned `AbsoluteFill`
crops its own edges; near-edge content (corner badges, captions,
`BrandFooter`) must either live inside the camera wrapper with margin sized
for the max zoom/pan range (see the margin-math comment above `CameraDrift`)
or sit *outside* the wrapper entirely as a fixed overlay, the way
`BrandFooter` deliberately does.

## Technique 3 — Terminal Inserts (format)

A new reusable component (add as `TerminalWindow.tsx` alongside
`MotifAnimation.tsx`) for showing authentic CLI/agent-run content: package
installs, agent run logs (e.g. "Synthesizing narration...", "Rendering
MarketingReel..." — real strings from `video-agent.ts`'s own console
output), or a generated-output result card.

Concrete build notes:
- **Chrome**: reuse the traffic-light header bar already established in
  `AppWindowReveal` (`#ef4444`/`#f59e0b`/`#22c55e` dots, `rgba(15,23,42,0.06)`
  bar) so it reads as the same UI family as the browser-window mockup, not
  a different design system.
- **Body**: monospace font (`ui-monospace` / `SFMono-Regular` stack —
  terminal content is the one place this differs from the Heebo/Rubik used
  everywhere else), dark background (`#0B1220` — reuse
  `VibrantBackground`'s own base color so it feels like the same world),
  green/white text (`#4ade80` for prompts/success, `#e2e8f0` for output).
- **Real terminal symbols**: use an actual prompt glyph (`$` or `❯`), real
  command syntax, and realistic line-by-line output — not lorem-ipsum-style
  placeholder text. Pull real strings from this repo's own scripts
  (`video-agent.ts`, `publish-agent.ts`) wherever plausible so the terminal
  content is literally true, satisfying Technique 1's authenticity gate.
- **Typed reveal**: animate each line by revealing characters over a few
  frames — `interpolate(frame, [lineStartFrame, lineStartFrame + revealFrames],
  [0, line.length])`, then `line.slice(0, Math.floor(revealedChars))` — so it
  reads as typed/streamed, not pasted in all at once. Stagger each line's
  `lineStartFrame` after the previous line's reveal completes.
- **Generated-output cards**: after a command "finishes," pop in a small
  result card below it using the same staggered-spring pattern as
  `AppWindowReveal`'s header/line1/line2 pops (each ~5-6 frames after the
  previous element).
- **3D window motion**: wrap the whole terminal in the same
  `perspective: 1200` + `rotateX/rotateY` slow tilt pattern `AppWindowReveal`
  already uses, so it moves like it belongs in the same 3D space as the
  rest of the reel rather than sitting flat on top of it.

## Technique 4 — Article Highlights (format)

A new reusable component (`ArticleHighlightCard.tsx`) for editorial/news-
style callout cards: a headline + short paragraph styled like a real
article snippet, with a hand-drawn highlighter stroke animating over the
key phrase.

Concrete build notes:
- **Card**: white/near-white background, generous padding, a small byline/
  kicker line above the headline (reuse the card shadow style from
  `AppWindowReveal`'s `boxShadow: "0 50px 90px rgba(0,0,0,0.5)"` treatment),
  Heebo/Rubik for the headline (RTL, `direction: "rtl"`), matching the rest
  of the reel's typography rather than importing a second font for this
  one card type.
- **Highlighter strokes via rough.js**: add `roughjs` as a new dependency
  to `clean_website/artifacts/video-renderer/package.json` (there is no
  existing hand-drawn-line capability in this codebase to reuse — this is
  a deliberate, called-out addition per Technique 1 step 4, not a drive-by
  one). Generate a rough `rectangle`/`linearPath` behind or over the key
  phrase using `roughjs/bin/generator` (works without a DOM canvas, so it's
  safe inside Remotion's server-side render), convert its rough `OpTypes`
  to an SVG path, and reveal it with `strokeDasharray`/`strokeDashoffset`
  animated via `interpolate(frame, [start, start + revealFrames], [length, 0])`
  so the stroke visibly "draws on" rather than appearing instantly. Use the
  reel's own accent color (from `COLOR_THEMES`) at ~40-60% opacity so it
  reads as a highlighter, not a solid underline.
- **Blur-in**: the whole card enters with `filter: blur(${blurPx}px)`
  interpolated from ~14px to 0 over the entrance window, combined with (not
  instead of) a spring `scale`/`opacity` pop — the blur should resolve
  roughly in sync with the scale settling, not linger after it.
- **Subtle 3D rotation**: same `perspective` + small `rotateY` (a few
  degrees, animating to 0) pattern as `AppWindowReveal`/`TerminalWindow` —
  keep the rotation small (2-6°) since this card is meant to feel like a
  settling document, not a spinning object.

## Technique 5 — Sound Design (synced to motion)

Every visual pop deserves a sound, matched to the moment it lands on --
not narration-competing music, but short UI-style effects: a soft "pop" on
spring pop-ins, a sharper "click" on UI-build moments (element-by-element
reveals), a "whoosh" on camera movement (the hook-punch, most notably).

Concrete build notes:
- **Synthesize, don't source.** `clean_website/scripts/src/marketing/sfx.ts`
  generates all three effects from plain math (a decaying sine for "pop", a
  filtered-noise burst for "click", a frequency-swept noise envelope for
  "whoosh") into raw 16-bit PCM WAV buffers, base64-encoded as data URIs --
  the same reasoning as `MotifAnimation.tsx`'s hand-built SVG icons and
  Technique 4's `roughjs` choice: no external audio-library asset means no
  licensing question to ever chase down.
- **Wiring**: `video-agent.ts` calls `buildSfxDataUris()` once per render
  and passes the result as the `sfx` prop (`{ pop, click, whoosh }`, each a
  `data:audio/wav;base64,...` URI) through `marketingReelSchema`. Inside
  `MarketingReel.tsx`, drop a `<Sequence from={N}><Audio src={sfx.pop} />
  </Sequence>` at the exact same frame offset as the visual spring it's
  paired with -- see `AppWindowReveal`'s click cues at its header/line/badge
  reveal offsets (10/16/21/26) for the pattern. `sfx` is optional throughout
  (like `broll`/`keyPhrase`) -- an older cached render or a missing prop
  just plays silently, it doesn't error.
- **Don't spam it.** Reserve `pop`/`click` for distinct, discrete UI-build
  moments (a handful per video: `AppWindowReveal`'s 4 reveals,
  `MessageBubble`'s entrance) -- not every kinetic caption word. A caption
  line can have a dozen+ words; a click on each one reads as noise, not
  polish. `whoosh` is a one-shot, reserved for the camera's opening
  hook-punch.

## Conventions to reuse everywhere (don't reinvent these)

- **Fonts**: Heebo (already loaded via `@remotion/google-fonts/Heebo` in
  MarketingReel.tsx) for all UI/caption/headline text; a monospace stack
  only inside `TerminalWindow`.
- **RTL**: every piece of Hebrew text needs `direction: "rtl"` explicitly —
  Remotion doesn't inherit document-level RTL.
- **Color**: pull from the composition's own `colorTheme`/`accentColor`
  prop rather than hardcoding a new color per component, so every element
  in a given reel stays visually related.
- **Entrances**: `spring()`, never CSS transitions or linear
  `interpolate`-only fades, for anything that should feel alive.
- **No new icon/animation libraries** for simple shapes — `MotifAnimation.tsx`
  deliberately uses plain SVG/CSS to avoid licensing questions. `roughjs`
  (Technique 4) is the one called-out exception because it does something
  (hand-drawn stroke generation) plain SVG/CSS can't reasonably replicate.

## What this skill does NOT do

`video-agent.ts` is deterministic Node.js code — it doesn't call an LLM at
render time, so this skill can't change its runtime behavior by existing.
What it does is make sure that whenever a Claude Code session (this one or
a future one) is asked to touch `MarketingReel.tsx`, add a new composition,
or extend `Root.tsx`, it builds with these four techniques instead of
improvising a new style per session. If you want `video-agent.ts` itself to
*choose* between multiple composition styles per idea (rather than always
rendering the single `MarketingReel` composition), that's a separate,
larger change to its selection logic — flag it explicitly rather than
assuming this skill already does it.

## A note on honesty about status

Two parallel sessions once built overlapping versions of Technique 4 at the
same time without realizing it -- one of them, before actually building
anything, told the user a component "already existed" on the video-pipeline
branch when it didn't. That confusion cost real time to untangle. If you
update this skill (or any status claim in it) with a new technique or a
change to an existing one, verify against the actual files first --
`git grep`, read the file, run the typecheck -- before writing "done" or
"built." A skill documenting something that isn't real is worse than no
skill at all, because it's trusted by default.
