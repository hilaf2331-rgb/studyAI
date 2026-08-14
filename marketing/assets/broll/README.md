# B-roll clips

Drop short video clips here (e.g. exported from Google Flow: https://labs.google/flow) --
`.mp4`, `.mov`, `.webm`, or `.mkv`.

Every time `pnpm --filter scripts run video:sync` renders a video, it picks
one random clip from this folder and plays it full-bleed behind the opening
title card (the first ~1.8 seconds), then the usual captions/animations
continue for the rest of the video.

This folder can be empty -- renders fall back to the plain animated
background when there's nothing here to pick from. There's no naming
convention to follow; any file that's a few seconds long or longer works.
