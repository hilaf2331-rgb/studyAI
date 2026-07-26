const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');

// Created lazily (not at module load) so a missing ANTHROPIC_API_KEY only
// breaks intent parsing, not the whole server's ability to start.
let anthropicClient = null;
function getClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return anthropicClient;
}

// Structured-output schema: Claude's reply is guaranteed to be valid JSON
// matching this shape, so we never have to hand-parse free-form text.
const CALENDAR_INTENT_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['create_event', 'list_events', 'delete_event', 'chat'],
      description: 'What the user wants to do with their calendar.',
    },
    event: {
      type: 'object',
      description: 'Required when action is "create_event".',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        location: { type: 'string' },
        start_time: {
          type: 'string',
          description: 'ISO 8601 datetime with an explicit UTC offset, e.g. 2026-07-27T15:00:00-04:00',
        },
        end_time: {
          type: 'string',
          description:
            'ISO 8601 datetime with an explicit UTC offset. Default to 1 hour after start_time if the user gave no duration.',
        },
      },
      required: ['title', 'start_time', 'end_time'],
    },
    query_range: {
      type: 'object',
      description: 'Required when action is "list_events": the date/time range the user is asking about.',
      properties: {
        start: { type: 'string', description: 'ISO 8601 datetime with an explicit UTC offset.' },
        end: { type: 'string', description: 'ISO 8601 datetime with an explicit UTC offset.' },
      },
      required: ['start', 'end'],
    },
    event_search_text: {
      type: 'string',
      description:
        'Required when action is "delete_event": keywords (title, topic, person) to find the event the user means.',
    },
    reply_message: {
      type: 'string',
      description:
        'Required when action is "chat": the exact reply to send back to the user — answer their question, greet them, or ask a clarifying question if the calendar request was too ambiguous to act on safely.',
    },
  },
  required: ['action'],
  additionalProperties: false,
};

const SYSTEM_PROMPT_TEMPLATE = ({ now, timezone }) =>
  [
    "You are the intent-parsing layer for a personal WhatsApp assistant that manages one user's Google Calendar.",
    `The current date and time is ${now} in the ${timezone} timezone.`,
    'Resolve relative dates and times ("tomorrow", "next Tuesday", "in an hour", "this weekend") against that current time.',
    'Always return start_time, end_time, and query_range values as ISO 8601 datetimes with an explicit UTC offset — never a bare date or a timezone name.',
    'If the message is small talk, a question unrelated to the calendar, or too ambiguous to safely act on (e.g. missing a date/time for a new event), use action "chat" and write the reply yourself in reply_message rather than guessing.',
  ].join(' ');

/**
 * Parses a user's free-text (or transcribed voice) message into a structured
 * calendar action using Claude.
 */
async function parseCalendarIntent(userText, { timezone = config.defaultTimezone, now = new Date() } = {}) {
  const response = await getClient().messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: CALENDAR_INTENT_SCHEMA },
    },
    system: SYSTEM_PROMPT_TEMPLATE({ now: now.toISOString(), timezone }),
    messages: [{ role: 'user', content: userText }],
  });

  if (response.stop_reason === 'refusal') {
    return { action: 'chat', reply_message: "Sorry, I can't help with that request." };
  }

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) {
    throw new Error('Claude did not return a text block with the parsed intent.');
  }

  return JSON.parse(textBlock.text);
}

module.exports = { parseCalendarIntent };
