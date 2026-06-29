import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import authRouter from "./routes/auth";
import { billingPublicRouter } from "./routes/billing";
import { sharedPublicRouter } from "./routes/shared";
import { requireAuth } from "./lib/auth";
import { logger } from "./lib/logger";
import { RateLimitExhaustedError, SystemBlockedError, AIServiceError } from "./lib/ai";
import { InsufficientTokensError } from "./lib/tokens";
import { PremiumRequiredError } from "./lib/subscription";
import { globalRateLimiter } from "./lib/rate-limit";

const app: Express = express();
app.set("trust proxy", 1);

// הגדרת CORS קשיחה למניעת שגיאות דינמיות
const ALLOWED_ORIGINS = ["https://focusstudy.net", "https://www.focusstudy.net"];

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "data:"],
        imgSrc: ["'self'", "data:", "https:"],
        mediaSrc: ["'self'", "https://storage.googleapis.com"],
        connectSrc: ["'self'", "https://storage.googleapis.com", "https://focusstudy.net"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// לוגר אבחון קריטי - אל תמחקי אותו עד שהאתר יעלה!
app.use((req, res, next) => {
  const origin = req.headers.origin;
  console.log(`[DEBUG CORS] Request Method: ${req.method} | Origin Header: ${origin}`);
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      // מאשר בקשות ללא origin (כמו כלי בדיקה/שרת-לשרת) או דומיינים מורשים
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        console.error(`[CORS BLOCK] Origin ${origin} not allowed.`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", globalRateLimiter);
app.use("/api", authRouter);
app.use("/api", billingPublicRouter);
app.use("/api", sharedPublicRouter);
app.use("/api", requireAuth, router);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled error");
  if (res.headersSent) return;
  // טיפול בשגיאות קלאסי...
  res.status(500).json({ error: "Internal server error." });
});

export default app;
