const express = require('express');
const config = require('../config');
const verifySignature = require('../utils/verifySignature');
const whatsapp = require('../services/whatsapp');
const { transcribeAudio } = require('../services/transcription');
const { parseCalendarIntent } = require('../services/intent');
const calendar = require('../services/calendar');

const router = express.Router();

/**
 * Meta calls this once, when you save the webhook URL in the App Dashboard,
 * to confirm you control the endpoint.
 */
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    console.log('[webhook] Verification succeeded.');
    return res.status(200).send(challenge);
  }
  console.warn('[webhook] Verification failed — check WHATSAPP_VERIFY_TOKEN.');
  return res.sendStatus(403);
});

/**
 * Meta calls this for every incoming message/status update. We must
 * acknowledge fast (WhatsApp retries/backs off if we're slow), so the real
 * work happens after we've already responded 200.
 */
router.post('/webhook', (req, res) => {
  if (!verifySignature(req)) {
    console.warn('[webhook] Rejected request with invalid signature.');
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  handleIncomingPayload(req.body).catch((err) => {
    console.error('[webhook] Unhandled error while processing event:', err);
  });
});

async function handleIncomingPayload(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];

  // Delivery/read receipts and other non-message callbacks land here too.
  if (!message) return;

  const from = message.from; // WhatsApp user ID (phone number, no "+")

  try {
    const userText = await extractUserText(message);
    if (userText === null) {
      await whatsapp.sendTextMessage(
        from,
        "Sorry, I can only handle text and voice messages for now.",
      );
      return;
    }

    const intent = await parseCalendarIntent(userText);
    const reply = await executeIntent(intent);
    await whatsapp.sendTextMessage(from, reply);
  } catch (err) {
    console.error('[webhook] Failed to handle message:', err);
    await whatsapp
      .sendTextMessage(from, "Sorry, something went wrong on my end. Please try again.")
      .catch(() => {});
  }
}

/** Returns the plain text of an incoming message, transcribing voice notes. */
async function extractUserText(message) {
  if (message.type === 'text') {
    return message.text.body;
  }

  if (message.type === 'audio') {
    const { url, mime_type: mimeType } = await whatsapp.getMediaMetadata(message.audio.id);
    const audioBuffer = await whatsapp.downloadMedia(url);
    return transcribeAudio(audioBuffer, mimeType);
  }

  return null;
}

/** Runs the Google Calendar action Claude decided on and builds the reply text. */
async function executeIntent(intent) {
  switch (intent.action) {
    case 'create_event': {
      const created = await calendar.createEvent(intent.event, config.defaultTimezone);
      return `✅ Created "${created.summary}" on your calendar.\n${created.htmlLink}`;
    }

    case 'list_events': {
      const events = await calendar.listEvents(intent.query_range);
      if (events.length === 0) {
        return "You don't have anything on your calendar for that time.";
      }
      const lines = events.map((event) => {
        const start = event.start.dateTime || event.start.date;
        return `• ${event.summary} — ${new Date(start).toLocaleString()}`;
      });
      return `Here's what's on your calendar:\n${lines.join('\n')}`;
    }

    case 'delete_event': {
      const deleted = await calendar.deleteEventByText(intent.event_search_text);
      return deleted
        ? `🗑️ Canceled "${deleted.summary}".`
        : `I couldn't find an upcoming event matching "${intent.event_search_text}".`;
    }

    case 'chat':
    default:
      return intent.reply_message || "I'm not sure how to help with that.";
  }
}

module.exports = router;
