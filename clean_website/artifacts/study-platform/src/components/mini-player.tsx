import React from "react";
import { Button } from "@/components/ui/button";
import { useAudioPlayer } from "@/lib/audio-player-context";
import { useLanguage } from "@/lib/i18n";
import { Play, Pause, RotateCcw, RotateCw, X, AlertCircle } from "lucide-react";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SKIP_SECONDS = 15;

// Persistent bottom bar -- rendered once in the root layout, stays mounted
// (and keeps reflecting playback state) across every route change. Renders
// nothing when no track has ever been played, so it costs nothing for users
// who never touch the podcast feature.
export const MiniPlayer: React.FC = () => {
  const { isRTL } = useLanguage();
  const { track, isPlaying, currentTime, duration, speed, loadError, togglePlay, seek, skip, cycleSpeed, close } = useAudioPlayer();

  if (!track) return null;

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm shadow-[0_-2px_12px_rgba(0,0,0,0.08)]"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2 flex items-center gap-3">
        <div className="min-w-0 flex-1 sm:flex-initial sm:w-44">
          <p className="text-sm font-medium truncate">{track.title || "Audio"}</p>
          {track.artist && <p className="text-xs text-muted-foreground truncate">{track.artist}</p>}
        </div>

        {loadError ? (
          <div className="flex items-center gap-2 text-xs text-destructive flex-1">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="truncate">{isRTL ? "טעינת השמע נכשלה" : "Failed to load audio"}</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => skip(-SKIP_SECONDS)}>
                <RotateCcw className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="default" className="h-9 w-9" onClick={togglePlay}>
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
              <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => skip(SKIP_SECONDS)}>
                <RotateCw className="w-4 h-4" />
              </Button>
            </div>

            <div className="hidden sm:flex items-center gap-2 flex-1 min-w-0">
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatTime(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={(e) => seek(Number(e.target.value))}
                className="flex-1 h-1.5 accent-primary"
              />
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatTime(duration)}</span>
            </div>

            <Button size="sm" variant="outline" className="hidden sm:inline-flex h-8 px-2 text-xs shrink-0" onClick={cycleSpeed}>
              {speed}x
            </Button>
          </>
        )}

        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={close} aria-label={isRTL ? "סגור נגן" : "Close player"}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {!loadError && (
        <div className="sm:hidden px-3 pb-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={(e) => seek(Number(e.target.value))}
            className="flex-1 h-1.5 accent-primary"
          />
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatTime(duration)}</span>
        </div>
      )}
    </div>
  );
};
