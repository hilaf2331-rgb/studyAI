/**
 * One-time helper: run this locally once to mint a Google OAuth refresh
 * token for your own Google Calendar, then paste it into .env as
 * GOOGLE_REFRESH_TOKEN. The running assistant never does this interactive
 * flow itself — it just uses the refresh token you generate here.
 *
 * Usage:
 *   node scripts/get-google-refresh-token.js
 *
 * Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI
 * (a loopback URL, e.g. http://localhost:3000/oauth2callback) in your .env.
 * That redirect URI must also be added as an "Authorized redirect URI" on
 * the OAuth client in Google Cloud Console.
 */
require('dotenv').config();
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  console.error(
    'Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI in .env',
  );
  process.exit(1);
}

const redirect = new URL(GOOGLE_REDIRECT_URI);
const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', // required to receive a refresh_token
  prompt: 'consent', // forces a refresh_token even on repeat runs
  scope: ['https://www.googleapis.com/auth/calendar'],
});

console.log('\n1. Open this URL and approve access with your Google account:\n');
console.log(authUrl);
console.log('\n2. Waiting for the redirect back to', GOOGLE_REDIRECT_URI, '...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== redirect.pathname) {
    res.writeHead(404).end();
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('Missing "code" query param.');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Success! You can close this tab and return to the terminal.');
  server.close();

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      '\nNo refresh_token returned. Revoke prior access at ' +
        'https://myaccount.google.com/permissions and re-run this script.',
    );
    process.exit(1);
  }

  console.log('\nAdd this to your .env file:\n');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  process.exit(0);
});

server.listen(Number(redirect.port) || 80);
