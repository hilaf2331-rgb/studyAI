const OpenAI = require('openai');
const { toFile } = require('openai');
const config = require('../config');

// Created lazily (not at module load) so a missing OPENAI_API_KEY only
// breaks voice-note handling, not the whole server's ability to start.
let openaiClient = null;
function getClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openaiClient;
}

/**
 * Sends a downloaded voice-note buffer to the Whisper API and returns the
 * transcribed text. WhatsApp voice notes arrive as audio/ogg (opus codec).
 */
async function transcribeAudio(buffer, mimeType = 'audio/ogg') {
  const extension = mimeType.includes('ogg') ? 'ogg' : 'mp3';
  const file = await toFile(buffer, `voice-note.${extension}`, { type: mimeType });

  const transcription = await getClient().audio.transcriptions.create({
    file,
    model: 'whisper-1',
  });

  return transcription.text;
}

module.exports = { transcribeAudio };
