import { useEffect, useRef, useState } from "react";

const CEILING = 96;

/**
 * Simulated progress that decelerates as it approaches `CEILING` instead of
 * crawling at a fixed rate and then freezing (the old `v >= 90 ? 90 : v + 2`
 * pattern) -- it keeps visibly creeping forward for as long as `active` stays
 * true, no matter how much longer the real operation ends up taking. If a
 * real percentage from the server is ever ahead of the simulation, that takes
 * over (a real number is always more trustworthy than a guess). Snaps to 100
 * the instant `active` turns false after having run, since that's the only
 * signal that the operation actually finished.
 */
export function useSmartProgress(active: boolean, opts: { expectedDurationMs: number; realPercent?: number | null }): number {
  const { expectedDurationMs, realPercent } = opts;
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setValue(prev => (prev > 0 ? 100 : 0));
      startRef.current = null;
      return;
    }

    setValue(0);
    startRef.current = Date.now();
    const tau = expectedDurationMs / 2.2;
    const tick = () => {
      const elapsed = Date.now() - (startRef.current as number);
      const simulated = CEILING * (1 - Math.exp(-elapsed / tau));
      setValue(prev => Math.max(prev, Math.min(CEILING, simulated)));
    };
    const interval = setInterval(tick, 250);
    tick();
    return () => clearInterval(interval);
  }, [active, expectedDurationMs]);

  useEffect(() => {
    if (active && realPercent != null) {
      setValue(prev => Math.max(prev, Math.min(100, realPercent)));
    }
  }, [active, realPercent]);

  return value;
}
