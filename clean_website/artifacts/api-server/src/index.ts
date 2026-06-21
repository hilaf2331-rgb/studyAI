import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// נתיב למניעת הירדמות השרת
app.get("/ping", (_req: any, res: any) => {
  res.status(200).send("OK");
});

const server = app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// הגדרות Timeout לחיבור יציב מול Groq
server.requestTimeout = 120_000;
server.headersTimeout = 110_000;
server.keepAliveTimeout = 65_000;
server.timeout = 0;
