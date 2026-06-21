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
// הוספת נתיב כדי למנוע מהשרת להירדם
app.get("/ping", (_req, res) => {
  res.status(200).send("OK");
});

const server = app.listen(port, (err) => {
  // ... שאר הקוד שלך נשאר כפי שהוא
const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// "Generate everything" can take 30-90s (three sequential-feeling but
// parallel AI calls). Node's defaults (headersTimeout ~60s, server.timeout
// ~120s idle socket) are usually fine, but Render's proxy / keep-alive
// behavior can be stricter than a bare Node server, so we widen these
// explicitly to make sure the AI has enough time to respond before the
// connection is torn down.
server.requestTimeout = 120_000; // max time to fully receive a request
server.headersTimeout = 110_000; // must be < requestTimeout
server.keepAliveTimeout = 65_000; // a bit above typical LB idle timeouts
server.timeout = 0; // disable the overall idle-socket timeout
