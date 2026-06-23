import rateLimit from "express-rate-limit";

// Single free Render instance, no Redis -- the default in-memory store is
// fine since there's only ever one process to keep counters in sync with.

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many requests. Please wait a few minutes and try again." });
  },
});

// AI generation/upload endpoints are the expensive ones (Groq tokens, CPU for
// PDF/audio parsing) -- clamp those much harder than general API traffic.
export const generationRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Generation limit reached. Please wait a few minutes before generating more content." },
  handler: (_req, res) => {
    res.status(429).json({ error: "Generation limit reached. Please wait a few minutes before generating more content." });
  },
});
