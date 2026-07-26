# WhatsApp Calendar Assistant

A personal WhatsApp bot that reads your texts and voice notes, figures out
what you want to do with your Google Calendar, does it, and replies to
confirm.

```
WhatsApp Cloud API  --webhook-->  Node/Express server
                                        |
                                        |-- audio? --> Whisper (transcribe)
                                        |
                                        |-- text -----> Claude (parse intent as JSON)
                                        |
                                        |-- calendar action --> Google Calendar API
                                        |
                                        <-- confirmation reply -- WhatsApp Cloud API
```

## Project layout

```
whatsapp-calendar-assistant/
├── src/
│   ├── index.js              # Express app bootstrap
│   ├── config.js             # Reads/validates env vars
│   ├── routes/
│   │   └── webhook.js        # GET verify + POST message handling
│   ├── services/
│   │   ├── whatsapp.js       # Send messages, resolve/download media
│   │   ├── transcription.js  # Whisper API call
│   │   ├── intent.js         # Claude call -> structured calendar intent
│   │   └── calendar.js       # Google Calendar create/list/delete
│   └── utils/
│       └── verifySignature.js
├── scripts/
│   └── get-google-refresh-token.js  # one-time OAuth setup helper
├── .env.example
└── package.json
```

## 1. Install dependencies

```bash
cd whatsapp-calendar-assistant
npm install
cp .env.example .env
```

## 2. WhatsApp Cloud API

1. Create an app at [Meta for Developers](https://developers.facebook.com/) and
   add the **WhatsApp** product.
2. From **WhatsApp > API Setup**, copy the temporary access token (or
   generate a permanent one via a System User) and the **Phone number ID**
   into `.env` as `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`.
3. From **App Settings > Basic**, copy the **App Secret** into
   `WHATSAPP_APP_SECRET` (used to verify incoming webhook signatures).
4. Pick any string for `WHATSAPP_VERIFY_TOKEN` — you'll enter the same value
   in the next step.

You'll wire up the actual webhook URL in step 5, once the server is
reachable from the internet.

## 3. OpenAI (Whisper) and Anthropic (Claude)

Set `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` in `.env`.

## 4. Google Calendar

This app expects an **OAuth 2.0 Client ID** (Desktop app type is simplest),
not a service account, since it needs to act on *your* personal calendar.

1. In Google Cloud Console, enable the **Google Calendar API** and create an
   OAuth 2.0 Client ID.
2. Put its Client ID / Secret into `.env`, and set `GOOGLE_REDIRECT_URI` to
   `http://localhost:3000/oauth2callback` (add that exact URL as an
   "Authorized redirect URI" on the client).
3. Run the one-time helper to mint a refresh token for your account:

   ```bash
   node scripts/get-google-refresh-token.js
   ```

   It prints a URL — open it, approve access, and the script will print a
   `GOOGLE_REFRESH_TOKEN` value to paste into `.env`.

## 5. Run it and expose it to WhatsApp

```bash
npm start
```

For local development, WhatsApp needs an HTTPS URL to reach your webhook —
tunnel your local port with something like [ngrok](https://ngrok.com/):

```bash
ngrok http 3000
```

Then in **Meta for Developers > WhatsApp > Configuration**:

- **Callback URL**: `https://<your-ngrok-domain>/webhook`
- **Verify token**: the same value you put in `WHATSAPP_VERIFY_TOKEN`
- Subscribe to the **messages** webhook field.

Send yourself a WhatsApp message (text or voice note) and watch the server
logs.

## What it can do today

- **Create an event**: _"Book a dentist appointment tomorrow at 3pm"_
- **List events**: _"What's on my calendar this weekend?"_
- **Cancel an event**: _"Cancel my dentist appointment"_ (matches by
  searching your upcoming events for the given text)
- Anything else falls back to a plain conversational reply from Claude.

## Next steps (not yet built)

- Persist conversation context per user (currently every message is parsed
  independently, so "move it an hour later" without restating which event
  won't work yet).
- Support updating/rescheduling an existing event.
- Multi-user support (right now it's wired to a single Google account via
  one refresh token).
- Move the in-memory nothing-persisted state to a real datastore if this
  grows beyond a single-user personal tool.
