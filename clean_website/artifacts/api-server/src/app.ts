import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import authRouter from "./routes/auth";
import { requireAuth } from "./lib/auth";
import { logger } from "./lib/logger";

const app: Express = express();

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
  ? (process.env.CORS_ORIGINS ?? "").split(",").map(d => d.trim()).filter(Boolean)
  : true;

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
