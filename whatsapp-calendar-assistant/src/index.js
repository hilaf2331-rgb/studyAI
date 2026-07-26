const express = require('express');
const config = require('./config');
const webhookRouter = require('./routes/webhook');

config.warnAboutMissingConfig();

const app = express();

// Capture the raw request body (needed for X-Hub-Signature-256 verification)
// while still getting `req.body` parsed as JSON everywhere else.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use(webhookRouter);

app.listen(config.port, () => {
  console.log(`WhatsApp calendar assistant listening on port ${config.port}`);
});
