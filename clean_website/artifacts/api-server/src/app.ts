import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import authRouter from "./routes/auth";
import { requireAuth } from "./lib/auth";
import { logger } from "./lib/logger";

const app: Express = express();

// TEMPORARY DIAGNOSTIC — remove once the 405 is resolved. This sits before
// CORS, before auth, before everything. If you see a request logged here for
// a call that the browser reports as 405, the 405 is coming from inside this
// Express app (most likely the cors middleware's preflight handling). If you
// DON'T see it logged at all, the request is being intercepted before it
// ever reaches Node — i.e. Render's edge/proxy layer, not your code.
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

const allowedOrigins = isProd
  ? function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      // מאפשר לכל דומיין שמסתיים ב-vercel.app או localhost לגשת לשרת
      if (!origin || origin.endsWith('.vercel.app') || origin.includes('localhost')) {
        callback(null, true);
      } else {
        // בודק גם מול רשימת הדומיינים הקבועה במשתני הסביבה (אם יש דומיין קסטום משלך)
        const envOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map(d => d.trim()).filter(Boolean);
        if (envOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    }
  : true;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", authRouter);
app.use("/api", requireAuth, router);

// Catch-all error handler. Must be registered last and take 4 args so
// Express recognizes it as an error handler. Without this, an unhandled
// throw anywhere in a route produces Express's default HTML error page,
// which is what was causing "Unexpected end of JSON input" on the
// frontend (res.json() on a non-JSON body).
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled error");
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error. Please try again." });
  }
});

export default app;
