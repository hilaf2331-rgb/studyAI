import { beforeAll, describe, expect, it } from "vitest";

// tokens.ts imports @workspace/db, which eagerly constructs a pg Pool from
// process.env.DATABASE_URL at module-load time (throwing if it's unset) --
// harmless for the pure computeAudioAffordability math this file tests (no
// query is ever actually issued), but the env var still has to exist before
// the module is evaluated. A dynamic import inside beforeAll (after setting
// the var, if it isn't already) guarantees that ordering, the same pattern
// processing-queue.test.ts uses for its own module-load-time env dependency.
describe("computeAudioAffordability", () => {
  let computeAudioAffordability: typeof import("./tokens").computeAudioAffordability;
  let RAW_UNITS_PER_TOKEN: number;
  let TRANSCRIPTION_SECONDS_PER_TOKEN: number;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
    const mod = await import("./tokens");
    computeAudioAffordability = mod.computeAudioAffordability;
    RAW_UNITS_PER_TOKEN = mod.RAW_UNITS_PER_TOKEN;
    TRANSCRIPTION_SECONDS_PER_TOKEN = mod.TRANSCRIPTION_SECONDS_PER_TOKEN;
  });

  it("affords the full request when the balance comfortably covers it", () => {
    const requestedSeconds = 3600; // 60 minutes -> 6 Tokens needed
    const availableRaw = 10 * RAW_UNITS_PER_TOKEN; // 10 Tokens available
    const result = computeAudioAffordability(requestedSeconds, availableRaw);
    expect(result).toEqual({
      canAffordFull: true,
      affordableSeconds: 3600,
      tokensNeeded: 6,
      tokensAvailable: 10,
    });
  });

  it("reports exactly how many seconds ARE affordable when the balance falls short", () => {
    const requestedSeconds = 3600; // 6 Tokens needed
    const availableRaw = 3 * RAW_UNITS_PER_TOKEN; // only 3 Tokens available
    const result = computeAudioAffordability(requestedSeconds, availableRaw);
    expect(result.canAffordFull).toBe(false);
    expect(result.tokensNeeded).toBe(6);
    expect(result.tokensAvailable).toBe(3);
    // 3 Tokens * 600s/Token = 1800s (30 minutes) -- never more than what was
    // actually requested, and never negative.
    expect(result.affordableSeconds).toBe(3 * TRANSCRIPTION_SECONDS_PER_TOKEN);
    expect(result.affordableSeconds).toBeLessThanOrEqual(requestedSeconds);
  });

  it("treats an exact balance match as fully affordable (boundary, not off-by-one)", () => {
    const requestedSeconds = 1200; // exactly 2 Tokens
    const availableRaw = 2 * RAW_UNITS_PER_TOKEN;
    const result = computeAudioAffordability(requestedSeconds, availableRaw);
    expect(result.canAffordFull).toBe(true);
    expect(result.affordableSeconds).toBe(requestedSeconds);
  });

  it("floors affordableSeconds at 0 for a zero (or negative) balance", () => {
    const result = computeAudioAffordability(3600, 0);
    expect(result.canAffordFull).toBe(false);
    expect(result.affordableSeconds).toBe(0);
    expect(result.tokensAvailable).toBe(0);
  });

  it("treats a zero-length request as trivially affordable", () => {
    const result = computeAudioAffordability(0, 0);
    expect(result.canAffordFull).toBe(true);
    expect(result.affordableSeconds).toBe(0);
    expect(result.tokensNeeded).toBe(0);
  });

  it("never lets affordableSeconds exceed the requested duration even with a huge balance", () => {
    const requestedSeconds = 600; // 1 Token needed
    const availableRaw = 1000 * RAW_UNITS_PER_TOKEN; // way more than enough
    const result = computeAudioAffordability(requestedSeconds, availableRaw);
    expect(result.canAffordFull).toBe(true);
    expect(result.affordableSeconds).toBe(requestedSeconds);
  });
});
