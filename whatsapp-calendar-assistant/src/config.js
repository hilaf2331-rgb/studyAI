require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  whatsapp: {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
  },
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
};

const REQUIRED_KEYS = [
  ['whatsapp.accessToken', config.whatsapp.accessToken],
  ['whatsapp.phoneNumberId', config.whatsapp.phoneNumberId],
  ['whatsapp.verifyToken', config.whatsapp.verifyToken],
  ['openai.apiKey', config.openai.apiKey],
  ['anthropic.apiKey', config.anthropic.apiKey],
  ['google.clientId', config.google.clientId],
  ['google.clientSecret', config.google.clientSecret],
  ['google.refreshToken', config.google.refreshToken],
];

function warnAboutMissingConfig() {
  const missing = REQUIRED_KEYS.filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    console.warn(
      `[config] Missing environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill these in before going live.',
    );
  }
}

module.exports = config;
module.exports.warnAboutMissingConfig = warnAboutMissingConfig;
