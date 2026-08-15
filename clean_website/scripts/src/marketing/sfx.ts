// Short UI-style sound effects (a soft "pop", a sharper "click", and a
// "whoosh") for the marketing reel -- generated as raw audio samples from
// plain math instead of sourced from a sound-effects library, the same
// reasoning as the hand-built SVG motif icons in MotifAnimation.tsx: no
// external asset means no licensing question to ever track down. Matches
// what the user described hearing in a reference reel (keyboard-click-style
// pops on UI elements appearing, a whoosh on camera movement, a mouse-click
// texture) -- reproduced as an original, synthesized sound design in that
// same spirit, not sourced from anyone else's actual recording.

const SAMPLE_RATE = 44100;

// Writes a mono 16-bit PCM WAV file from samples in [-1, 1].
function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

function toDataUri(samples: Float32Array): string {
  return `data:audio/wav;base64,${encodeWav(samples, SAMPLE_RATE).toString("base64")}`;
}

// A soft, rounded "pop" -- a sine tone with a fast exponential decay, the
// kind of sound a UI element makes appearing. Used on each spring pop
// (kinetic caption words, AppWindowReveal's header/lines/badge).
function synthesizePop(): Float32Array {
  const durationSeconds = 0.12;
  const n = Math.floor(SAMPLE_RATE * durationSeconds);
  const samples = new Float32Array(n);
  const freq = 900;
  const decay = 28; // higher = faster decay
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    samples[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-decay * t);
  }
  return samples;
}

// A shorter, higher, noisier "click" -- a keyboard/mouse-click texture:
// a brief burst of filtered noise (simple leaky-integrator lowpass) with
// a very fast decay, plus a touch of high tone for the "snap".
function synthesizeClick(): Float32Array {
  const durationSeconds = 0.045;
  const n = Math.floor(SAMPLE_RATE * durationSeconds);
  const samples = new Float32Array(n);
  const decay = 90;
  let filtered = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const noise = Math.random() * 2 - 1;
    filtered = filtered * 0.7 + noise * 0.3; // soften the raw noise
    const tone = Math.sin(2 * Math.PI * 2200 * t) * 0.35;
    samples[i] = (filtered * 0.8 + tone) * Math.exp(-decay * t);
  }
  return samples;
}

// A "whoosh" -- amplitude-enveloped noise with a rising-then-falling pitch
// sweep (ring-modulated by a sweeping sine), for the camera hook-punch.
function synthesizeWhoosh(): Float32Array {
  const durationSeconds = 0.45;
  const n = Math.floor(SAMPLE_RATE * durationSeconds);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const progress = t / durationSeconds;
    // Attack over the first 25%, decay over the rest.
    const envelope = progress < 0.25 ? progress / 0.25 : Math.pow(1 - (progress - 0.25) / 0.75, 1.5);
    const sweepFreq = 200 + progress * 1400; // rises from 200Hz to 1600Hz
    const noise = Math.random() * 2 - 1;
    const modulator = Math.sin(2 * Math.PI * sweepFreq * t);
    samples[i] = noise * modulator * envelope * 0.9;
  }
  return samples;
}

export interface SfxDataUris {
  pop: string;
  click: string;
  whoosh: string;
}

// Generated once per render (cheap -- a handful of milliseconds of audio,
// pure math, no I/O) rather than cached to disk.
export function buildSfxDataUris(): SfxDataUris {
  return {
    pop: toDataUri(synthesizePop()),
    click: toDataUri(synthesizeClick()),
    whoosh: toDataUri(synthesizeWhoosh()),
  };
}
