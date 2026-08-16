# FocusStudy Marketing Automation — Status Summary (2026-08-16)

Paste this into a fresh session if you want to continue work without re-explaining everything.

## Two separate branches, two separate content types

| | Videos (Reels) | Images (Posts) |
|---|---|---|
| **Days** | Sunday, Tuesday, Thursday | Monday, Wednesday |
| **Branch** | `claude/focusstudy-publish-automation-nqyxss` | `claude/focus-study-social-automation-bx66q8` |
| **Runs where** | Your Windows PC (needs your ElevenLabs/GCS keys) | Cloud (Claude Code Remote routine) |
| **Session** | This one | `session_012wC8XMTawhcsJrqCXRmW4F` ("פוסטים לאינסטגרם") — **consider retiring this session and starting fresh**; it gave itself a confusing self-summary once (see below) |

## Video pipeline (this session's branch)

- **Script**: `clean_website/scripts/src/marketing/video-agent.ts` — reads `marketing/ideas/backlog.json` (ideas with `channel_hint: "video"` and `status: "new"`), synthesizes narration via **ElevenLabs** (`eleven_v3` model — required for correct Hebrew), renders via **Remotion** (`clean_website/artifacts/video-renderer`), uploads to **GCS**, writes results to `marketing/video/queue.json`.
- **Visual style** (documented in `.claude/skills/remotion-video-editing/SKILL.md` — read this before touching the composition): cinematic camera drift, an app-window mockup that "builds itself" with sound-effect clicks, an editorial highlight card with a hand-drawn (roughjs) underline on a key phrase, procedurally-synthesized sound effects (pop/click/whoosh — no external audio files), 5 color themes, 7 hand-built motif icons.
- **Pronunciation fixes**: `PRONUNCIATION_FIXES` dict in `video-agent.ts` — currently just "היוש" → `ahˈjoʃ`. Add entries reactively (only after hearing a real mispronunciation).
- **B-roll**: drop real clips (e.g. from Google Flow) into `marketing/assets/broll/` — picked at random, shown behind the intro.
- **Unattended automation**: `clean_website/scripts/run-weekly-render.ps1` (does reset+pull+render+push) registered via Windows Task Scheduler (`register-weekly-render-task.ps1`, one-time setup, already done) — fires every Sunday 8am, computer just needs to be powered on. **Auth for the automated push is working now** (GitHub Personal Access Token + `git config --global credential.helper store`, confirmed working tonight).
- **Publishing**: currently done manually by asking Claude in this session to publish via the Zapier Instagram for Business / Facebook Pages connections (see below) — `publish-agent.ts` (the older direct-Meta-API-token version) is NOT what's actually used anymore.

## Image pipeline (other branch/session)

- Weekly cycle: Sunday drafts 2 posts (Gemini-generated images via Zapier's Google AI Studio connection, `gemini-2.5-flash-image` model — NOT `imagen-*`, those are being discontinued Aug 17 2026) + asks for one approval; Monday/Wednesday triggers auto-publish from the approved queue (`marketing/instagram/queue.json` on that branch) without asking again.
- Confirmed working end-to-end: 2 real posts published (daily-review feature → Monday, recorder feature → Wednesday), real Instagram media IDs.

## Active triggers (Claude Code Remote routines)

| Day | Trigger ID | What it does | Target session |
|---|---|---|---|
| Sun 05:00 UTC | `trig_01W1XvuAShNfviBFPzruRZbN` | Writes new video ideas to backlog.json | this session |
| Sun 06:00 UTC | `trig_01WNqbqGRrQ2txTLZR2ztAuo` | Drafts 2 image posts, asks approval | פוסטים לאינסטגרם session |
| Mon 06:00 UTC | `trig_01EWf1fxbX5xPM3WaHqvYp1U` | Auto-publishes approved Monday image post | פוסטים לאינסטגרם session |
| Wed 06:00 UTC | `trig_01FfihMcVtJEhAGZUcWgScHV` | Auto-publishes approved Wednesday image post | פוסטים לאינסטגרם session |

(Video render itself is NOT a cloud trigger — it's the Windows Task Scheduler job on your PC, Sunday 8am local time.)

## Zapier connections (used for publishing)

- **Instagram for Business**: connected, working (published 2 video Reels + tested via 2 image posts tonight). Connection had gone stale once — reconnect via Zapier's connect-auth flow if `Authorization access_token missing` errors resurface.
- **Facebook Pages**: connection itself is authorized (you completed the page-picker screen, selected "Focus Study"), but the "page" list still isn't resolving on Zapier's side — likely just needs more time to propagate. Revisit this, don't need to redo the OAuth flow.
- **Google AI Studio (Gemini)**: connected, used for image generation.

## What's genuinely open / not yet done

1. Facebook Pages video/photo publishing — connection authorized but not yet actually working (see above).
2. The two overlapping "which day" self-summaries the image-post session gave itself were just wording mistakes, not real data problems — the actual published posts are correctly labeled. If you retire that session for a fresh one, no data is at risk (it lives in `marketing/instagram/queue.json` on its branch, not in the session itself).
3. If you want ONE session going forward instead of two, say so explicitly and the 3 image-pipeline triggers above need retargeting to whichever session you pick (I can't retarget a routine's prompt into a session I'm not in without recreating it — deleting + recreating with the new session ID is the way to do it).
