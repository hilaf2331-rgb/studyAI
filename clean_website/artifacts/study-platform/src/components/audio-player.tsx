import React from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause } from "lucide-react";
import { useAudioPlayer } from "@/lib/audio-player-context";

// Thin per-card trigger for the global persistent player (see
// lib/audio-player-context.tsx + components/mini-player.tsx). Holds no
// playback state and no <audio> element of its own -- there's exactly one
// <audio> for the whole app, owned by AudioPlayerProvider, so switching
// pages never stops playback. Each card just shows whether ITS asset is the
// one currently loaded, and starts/resumes/toggles it via the shared
// context.
export function AudioPlayer({ id, src, title, artist }: { id: string; src: string; title?: string; artist?: string }) {
  const { track, isPlaying, play, togglePlay } = useAudioPlayer();
  const isActive = track?.id === id;

  const handleClick = () => {
    if (isActive) {
      togglePlay();
    } else {
      play({ id, src, title, artist });
    }
  };

  return (
    <div className="flex items-center gap-2 w-full">
      <Button size="icon" variant="outline" className="shrink-0 h-8 w-8" onClick={handleClick}>
        {isActive && isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </Button>
      <span className="text-xs text-muted-foreground truncate">
        {isActive ? (isPlaying ? "מתנגן כעת" : "מושהה") : title}
      </span>
    </div>
  );
}
