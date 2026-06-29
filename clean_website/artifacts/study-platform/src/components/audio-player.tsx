import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, AlertCircle } from "lucide-react";

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

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
export function AudioPlayer({ src }: { src: string }) {
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

  // Reset any stale error state whenever the URL changes, so switching
  // between assets (or a successful retry) doesn't keep showing an old
  // failure.
  useEffect(() => {
    setLoadError(null);
  }, [src]);

  const handleError = () => {
    const audio = audioRef.current;
    const mediaError = audio?.error;
    const codeName = mediaError ? MEDIA_ERROR_NAMES[mediaError.code] ?? `code ${mediaError.code}` : "unknown";
    // eslint-disable-next-line no-console
    console.error("[AudioPlayer] failed to load audio", {
      src,
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
    console.log("[AudioPlayer] play requested", { src });
    audio.play().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[AudioPlayer] play() rejected", { src, err });
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
        src={src}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onError={handleError}
      />
      <Button size="icon" variant="outline" className="shrink-0 h-8 w-8" onClick={togglePlay}>
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
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
