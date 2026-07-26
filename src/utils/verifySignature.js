const crypto = require('crypto');
const config = require('../config');

/**
 * Confirms a webhook POST body actually came from Meta by recomputing the
 * HMAC-SHA256 signature over the raw request body and comparing it to the
 * X-Hub-Signature-256 header, using a constant-time comparison.
 */
function verifySignature(req) {
  const signatureHeader = req.get('X-Hub-Signature-256');
  if (!signatureHeader || !req.rawBody) {
    return false;
  }

  const expected = `sha256=${crypto
    .createHmac('sha256', config.whatsapp.appSecret)
    .update(req.rawBody)
    .digest('hex')}`;

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signatureHeader);

  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

module.exports = verifySignature;
