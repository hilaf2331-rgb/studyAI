import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, AlertCircle, RotateCcw, RotateCw } from "lucide-react";

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

// Standard podcast-style skip increment for both the on-screen skip buttons
// and the lock-screen/notification "seekbackward"/"seekforward" actions.
const SKIP_SECONDS = 15;

// MediaError.code values don't come with human-readable text from the
// browser, so they're mapped here for the console log / inline error message.
const MEDIA_ERROR_NAMES: Record<number, string> = {
  1: "MEDIA_ERR_ABORTED",
  2: "MEDIA_ERR_NETWORK",
  3: "MEDIA_ERR_DECODE",
  4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Minimal embedded player for a single Course Media item -- native <audio>
// element driving the Play/Pause/Speed UI, no third-party player library.
// Deliberately does NOT set crossOrigin: plain playback (no Web Audio /
// canvas access) doesn't require CORS, and setting crossOrigin without a
// matching CORS config on the bucket would make playback *fail* instead of
// just degrading -- the browser starts enforcing CORS the moment that
// attribute is present.
//
// `src` is a short-lived GCS signed URL, re-minted by the backend on every
// fetch of the asset list -- a React Query background refetch (e.g. window
// refocus) would otherwise hand this component a brand new URL string for
// the *same* underlying file mid-playback, and swapping <audio src> resets
// playback to 0. The signed URL's ~1hr TTL comfortably outlasts a normal
// listening session, so the fix is simply to lock onto whichever URL was
// current the first time this asset was rendered and ignore later prop
// updates -- a remount (e.g. navigating away and back) picks up a fresh one.
//
// `title`/`artist` feed the Media Session API so the OS lock-screen /
// notification player shows something more useful than the bare filename.
// Registering a Media Session is also what tells mobile Chrome/iOS Safari
// "this is real media playback" -- without it the OS has no lock-screen
// surface for the audio at all, and is far more eager to suspend a
// background tab's playback since there's no signal it should keep going.
export function AudioPlayer({ src, title, artist }: { src: string; title?: string; artist?: string }) {
  const [lockedSrc] = useState(src);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
  }, [speed]);

  const skip = (delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(Math.max(audio.currentTime + delta, 0), audio.duration || Infinity);
  };

  // Registers this player's transport controls with the OS-level Media
  // Session (lock screen, notification shade, headset buttons, car
  // displays). Re-registered on every play so the *currently playing*
  // player always owns the session -- with several podcast cards on one
  // page, only one <audio> is ever actually playing, but each has its own
  // handlers, so whichever one most recently started is the one the OS
  // controls end up wired to.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !isPlaying) return;
    const audio = audioRef.current;
    if (!audio) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || "Audio",
      artist: artist || "studyAI",
    });
    navigator.mediaSession.playbackState = "playing";

    navigator.mediaSession.setActionHandler("play", () => audio.play().catch(() => {}));
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("seekbackward", (details) => skip(-(details.seekOffset || SKIP_SECONDS)));
    navigator.mediaSession.setActionHandler("seekforward", (details) => skip(details.seekOffset || SKIP_SECONDS));
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime != null) audio.currentTime = details.seekTime;
    });

    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
      navigator.mediaSession.setActionHandler("seekto", null);
    };
  }, [isPlaying, title, artist]);

  // Keeps the lock-screen playback indicator and scrub bar (where
  // supported, e.g. Chrome on Android) in sync as time advances, and
  // flips the OS playback indicator to "paused" the moment the user (or
  // another app taking audio focus) pauses -- without this, locking the
  // screen mid-pause can leave a stale "playing" glyph on some OSes.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    if (isPlaying && duration && Number.isFinite(duration) && "setPositionState" in navigator.mediaSession) {
      try {
        navigator.mediaSession.setPositionState({ duration, playbackRate: speed, position: currentTime });
      } catch {
        // Throws if duration/position are out of range during a seek race; harmless to skip a frame of sync.
      }
    }
  }, [isPlaying, duration, currentTime, speed]);

  const handleError = () => {
    const audio = audioRef.current;
    const mediaError = audio?.error;
    const codeName = mediaError ? MEDIA_ERROR_NAMES[mediaError.code] ?? `code ${mediaError.code}` : "unknown";
    // eslint-disable-next-line no-console
    console.error("[AudioPlayer] failed to load audio", {
      src: lockedSrc,
      errorCode: mediaError?.code,
      errorName: codeName,
      networkState: audio?.networkState,
      readyState: audio?.readyState,
    });
    setLoadError(codeName);
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      return;
    }
    // eslint-disable-next-line no-console
    console.log("[AudioPlayer] play requested", { src: lockedSrc });
    audio.play().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[AudioPlayer] play() rejected", { src: lockedSrc, err });
    });
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Number(e.target.value);
  };

  const cycleSpeed = () => {
    const idx = SPEED_OPTIONS.indexOf(speed);
    setSpeed(SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length]);
  };

  if (loadError) {
    return (
      <div className="flex items-center gap-2 w-full text-xs text-destructive">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span className="truncate">Failed to load audio ({loadError})</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 w-full">
      <audio
        ref={audioRef}
        src={lockedSrc}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onError={handleError}
      />
      <Button size="icon" variant="outline" className="shrink-0 h-8 w-8 hidden sm:inline-flex" onClick={() => skip(-SKIP_SECONDS)}>
        <RotateCcw className="w-4 h-4" />
      </Button>
      <Button size="icon" variant="outline" className="shrink-0 h-8 w-8" onClick={togglePlay}>
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </Button>
      <Button size="icon" variant="outline" className="shrink-0 h-8 w-8 hidden sm:inline-flex" onClick={() => skip(SKIP_SECONDS)}>
        <RotateCw className="w-4 h-4" />
      </Button>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={currentTime}
        onChange={handleSeek}
        className="flex-1 h-1.5 accent-primary"
      />
      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
      <Button size="sm" variant="outline" className="shrink-0 h-8 px-2 text-xs" onClick={cycleSpeed}>
        {speed}x
      </Button>
    </div>
  );
}
