---
name: focusstudy-motion-ad
description: Design language for FocusStudy's Remotion-based marketing reel pipeline (clean_website/artifacts/video-renderer, driven by clean_website/scripts/src/marketing/video-agent.ts). Use this whenever working on MarketingReel.tsx, adding a new visual beat/component to the reel, tuning camera motion, captions, or sound effects, or when the user asks to make a video "more professional," "more premium," or references the "4 skills" / motion-graphics reel style she's after. Encodes 5 concrete principles distilled from reference reels she shared, each mapped to what's actually built in this repo (not aspirational) so a session doesn't have to re-derive or re-explain the style from scratch.
---

# FocusStudy motion-ad design language

FocusStudy's marketing reels (`clean_website/artifacts/video-renderer/src/compositions/MarketingReel.tsx`) aim for a "premium product-launch ad" feel -- bouncy, kinetic, cinematic -- rather than a flat slideshow with narration over it. The 5 principles below came from reference reels the user shared (an influencer's "4 skills" carousel, plus a screen recording of a Spotify-UI-mockup ad analyzed frame-by-frame). Each one is mapped to the actual component that implements it today, so this skill stays accurate as the pipeline evolves -- update the "Status" line when something changes instead of letting this drift into the same kind of false "already built" claim that caused real confusion once already in this project.

## Why this exists

Two things kept going wrong before this skill existed: (1) the design language got re-explained from scratch in nearly every session, and (2) a different session once asserted a component existed on this branch when it didn't, and nobody caught it until code was checked against git history. Every claim below has been verified against the actual files -- if you extend this skill, verify the same way (`git grep`, read the file, don't take another session's word for it) before writing "done."

## The 5 principles

### 1. Authentic surfaces (not generic placeholders)

Every visual element should read as *this specific product*, not a generic stock-icon stand-in. Concretely: the floating motif icon always corresponds to the actual feature the video is about (chat bubble for the chat feature, mic for recording, etc. -- see `MotifAnimation.tsx`'s `MOTIF_ANIMATIONS` map), and the "app window" mockup shows FocusStudy's real accent colors and RTL Hebrew layout, not a generic browser chrome.

**Status: built.** `AppWindowReveal` in `MarketingReel.tsx` + the 7 hand-built SVG icons in `MotifAnimation.tsx`.

### 2. Continuous camera, not hard cuts

One continuous "world" with a keyframed camera drifting over it (zoom/pan/rotate on independent sine waves, plus an opening zoom-punch hook) reads as more cinematic and expensive than static frames or hard cuts between shots.

**Status: built.** `CameraDrift` wraps the whole composition. Ambient zoom 1.04-1.1, an opening hook-punch that settles via `spring()` over ~0.6s, small pan/rotate drift. If you widen these ranges, re-check for clipping against the message bubble (top-right) and re-verify with a still-frame render -- the ranges were deliberately tightened once already after a clipping bug.

### 3. UI-build authenticity (terminal/interface reveals)

A mockup interface should look like it's being *built*, element by element -- not fading in as one flat block. Each element gets its own staggered spring pop, and (new) a matching sound: a soft click as each piece appears, echoing the keyboard/mouse-click texture of a real UI being typed/clicked into existence.

**Status: built.** `AppWindowReveal`'s header/line1/line2/badge staggered springs (frame offsets 0/10/16/21/26), now paired with `sfx.click`/`sfx.pop` `<Audio>` cues at the same offsets.

### 4. Editorial highlight cards (rough.js hand-drawn marks)

A lighter, "human" beat -- an editorial/article-style card with a hand-drawn highlighter stroke (via `roughjs`, not a plain CSS underline) under a key phrase, blur-in entrance, subtle 3D tilt. Reads as "someone marked this up by hand," which is what makes the technique recognizable.

**Status: component built, not yet wired into the main timeline.** `ArticleHighlightCard.tsx` exists and typechecks. It measures the highlighted phrase's real rendered size via `useLayoutEffect` (not `useEffect` -- must run before Remotion captures the frame) before drawing the `rough.svg().rectangle()` mark with a **fixed** seed (`HIGHLIGHT_SEED = 7412` -- a fixed seed matters, a random one redraws the wobble differently every frame and looks like flickering, not a static mark). It is NOT currently placed inside `MarketingReel`'s Sequence timeline -- where it should appear (as a mid-narration beat? replacing something?) is a real design decision, not a default to guess at. Ask the user before wiring it in, and pass real content (an eyebrow label + a headline with the exact substring to highlight) rather than a placeholder.

### 5. Sound design synced to motion

Every visual pop deserves a sound. Not narration-competing music -- short, synthesized UI-style effects (`clean_website/scripts/src/marketing/sfx.ts`): a soft "pop" (sine + fast exponential decay) on spring pop-ins, a sharper "click" (filtered noise burst) on UI-build moments, a "whoosh" (frequency-swept noise envelope) once on the camera's opening hook-punch. These are generated procedurally from plain math -- no external sound-library asset, so (like the hand-built SVG icons) there's no licensing question to ever chase down.

**Status: built and wired in.** `video-agent.ts` calls `buildSfxDataUris()` once per render and passes it as the `sfx` prop; `MarketingReel.tsx` plays `sfx.click`/`sfx.pop` at `AppWindowReveal`'s reveal beats, `sfx.pop` on `MessageBubble`'s entrance, `sfx.whoosh` on `CameraDrift`'s hook-punch. `sfx` is optional throughout -- a render without it (or an older cached composition) just plays silently, it doesn't break.

## Extending this list

If the user shares another reference (a screenshot, a screen recording, a described reel) and asks for a new visual/audio principle:
1. Get the actual reference material first -- a description in her own words, screenshots, or (for video/audio) a real downloadable file. Claude cannot watch or listen to video/audio directly; for a video file, extract frames with ffmpeg and `Read` them as images, or use the `google_ai_studio_gemini_understand_video` Zapier action (needs a directly-downloadable file URL, not a page link) if it's already connected.
2. Build the actual component/effect, verify it (typecheck at minimum; a still-frame render via `@remotion/renderer`'s `renderStill` if the sandbox's network policy allows downloading headless Chrome -- it doesn't always).
3. Add a numbered entry here with an honest **Status** line. Never write "built" for something you haven't verified compiles/exists in the actual files on this branch.
