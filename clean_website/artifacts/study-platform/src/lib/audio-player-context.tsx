import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export interface AudioTrack {
  id: string;
  src: string;
  title?: string;
  artist?: string;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];
const SKIP_SECONDS = 15;

const MEDIA_ERROR_NAMES: Record<number, string> = {
  1: "MEDIA_ERR_ABORTED",
  2: "MEDIA_ERR_NETWORK",
  3: "MEDIA_ERR_DECODE",
  4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
};

interface AudioPlayerState {
  track: AudioTrack | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  loadError: string | null;
}

interface AudioPlayerContextValue extends AudioPlayerState {
  play: (track: AudioTrack) => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  skip: (deltaSeconds: number) => void;
  cycleSpeed: () => void;
  close: () => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

// One <audio> element for the entire app, rendered once here and never
// unmounted by route changes -- the same element keeps playing across
// navigation since playback state (currentTime, isPlaying) lives in this
// element itself, not in whichever page happened to render the trigger.
export const AudioPlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [track, setTrack] = useState<AudioTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Tracks the currently loaded asset's id, not its (possibly refreshed)
  // signed-URL src -- see the `play()` guard below.
  const loadedTrackId = useRef<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
  }, [speed]);

  const skip = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(Math.max(audio.currentTime + delta, 0), audio.duration || Infinity);
  }, []);

  const play = useCallback((next: AudioTrack) => {
    const audio = audioRef.current;
    if (!audio) return;

    // Same asset already loaded (e.g. a React Query refetch handed back a
    // freshly re-minted signed URL for the same id) -- just resume instead
    // of swapping `src`, which would reset playback to 0.
    if (loadedTrackId.current === next.id) {
      audio.play().catch(() => {});
      return;
    }

    loadedTrackId.current = next.id;
    setTrack(next);
    setLoadError(null);
    setCurrentTime(0);
    setDuration(0);
    audio.src = next.src;
    audio.play().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[AudioPlayer] play() rejected", { src: next.src, err });
    });
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }, [isPlaying]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeed((prev) => {
      const idx = SPEED_OPTIONS.indexOf(prev);
      return SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    });
  }, []);

  const close = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    loadedTrackId.current = null;
    setTrack(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setLoadError(null);
  }, []);

  const handleError = useCallback(() => {
    const audio = audioRef.current;
    const mediaError = audio?.error;
    const codeName = mediaError ? MEDIA_ERROR_NAMES[mediaError.code] ?? `code ${mediaError.code}` : "unknown";
    // eslint-disable-next-line no-console
    console.error("[AudioPlayer] failed to load audio", {
      src: track?.src,
      errorCode: mediaError?.code,
      errorName: codeName,
      networkState: audio?.networkState,
      readyState: audio?.readyState,
    });
    setLoadError(codeName);
  }, [track?.src]);

  // Registers transport controls with the OS-level Media Session (lock
  // screen, notification shade, headset buttons, car displays) -- now a
  // single registration for the single shared <audio>, instead of one per
  // rendered card fighting over which one "owns" the session.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !isPlaying || !track) return;
    const audio = audioRef.current;
    if (!audio) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || "Audio",
      artist: track.artist || "studyAI",
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
  }, [isPlaying, track, skip]);

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

  const value: AudioPlayerContextValue = {
    track,
    isPlaying,
    currentTime,
    duration,
    speed,
    loadError,
    play,
    togglePlay,
    seek,
    skip,
    cycleSpeed,
    close,
  };

  return (
    <AudioPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onError={handleError}
        className="hidden"
      />
    </AudioPlayerContext.Provider>
  );
};

export function useAudioPlayer(): AudioPlayerContextValue {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error("useAudioPlayer must be used within an AudioPlayerProvider");
  return ctx;
}
