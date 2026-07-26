const config = require('../config');

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

function authHeaders() {
  return { Authorization: `Bearer ${config.whatsapp.accessToken}` };
}

/** Sends a plain text reply to a WhatsApp user. */
async function sendTextMessage(to, body) {
  const res = await fetch(`${GRAPH_BASE}/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });

  if (!res.ok) {
    throw new Error(`WhatsApp send failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

/** Resolves a WhatsApp media ID to a short-lived download URL + mime type. */
async function getMediaMetadata(mediaId) {
  const res = await fetch(`${GRAPH_BASE}/${mediaId}`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to resolve media URL (${res.status}): ${await res.text()}`);
  }
  return res.json(); // { url, mime_type, sha256, file_size, id }
}

/** Downloads WhatsApp media (e.g. a voice note) into a Buffer. */
async function downloadMedia(url) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to download media (${res.status}): ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { sendTextMessage, getMediaMetadata, downloadMedia };
