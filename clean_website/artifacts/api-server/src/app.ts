import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import authRouter from "./routes/auth";
import { billingPublicRouter } from "./routes/billing";
import { requireAuth } from "./lib/auth";
import { logger } from "./lib/logger";
import { RateLimitExhaustedError, SystemBlockedError, AIServiceError } from "./lib/ai";
import { InsufficientTokensError } from "./lib/tokens";
import { PremiumRequiredError } from "./lib/subscription";
import { globalRateLimiter } from "./lib/rate-limit";

const app: Express = express();

// Render sits behind a reverse proxy, so without this every request's
// req.ip resolves to the proxy's address instead of the real client —
// collapsing the rate limiter into a single shared bucket for all users.
app.set("trust proxy", 1);

// TEMPORARY DIAGNOSTIC — remove once the 405 is resolved.
app.use((req, res, next) => {
  console.log(`[DIAG] ${req.method} ${req.originalUrl} | Origin: ${req.headers.origin}`);
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

const isProd = process.env.NODE_ENV === "production";

// 1. הגדרת הלוגיקה של ה-Origins
const allowedOrigins = isProd
  ? function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      if (!origin || origin.endsWith('.vercel.app') || origin.includes('localhost')) {
        callback(null, true);
      } else {
        const envOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map(d => d.trim()).filter(Boolean);
        if (envOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    }
  : true;

// 2. הפעלת ה-CORS Middleware (זה החלק שהיה חסר!)
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", globalRateLimiter);

app.use("/api", authRouter);
app.use("/api", billingPublicRouter);
app.use("/api", requireAuth, router);

// Catch-all error handler.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled error");
  if (res.headersSent) return;
  if (err instanceof RateLimitExhaustedError || err instanceof SystemBlockedError) {
    res.status(429).json({ error: err.message });
    return;
  }
  if (err instanceof InsufficientTokensError) {
    res.status(402).json({ error: err.message });
    return;
  }
  if (err instanceof PremiumRequiredError) {
    res.status(403).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof AIServiceError) {
    res.status(503).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: "Internal server error. Please try again." });
});

export default app;
