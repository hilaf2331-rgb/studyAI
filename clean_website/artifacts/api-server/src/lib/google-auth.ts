import { OAuth2Client } from "google-auth-library";

// Public identifier for the OAuth client (not a secret -- it's baked into
// the frontend bundle too, see routes/auth.ts's GET /auth/google-client-id).
// Only set on the server, per the account owner's own setup choice, so the
// frontend fetches it at runtime instead of needing its own build-time copy.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();

let client: OAuth2Client | null = null;
function getClient(): OAuth2Client {
  client ??= new OAuth2Client(GOOGLE_CLIENT_ID);
  return client;
}

export function isGoogleSignInConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID);
}

export function getGoogleClientId(): string | null {
  return GOOGLE_CLIENT_ID ?? null;
}

export interface GoogleIdentity {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

// Verifies the ID token (the `credential` Google Identity Services hands the
// frontend on sign-in) cryptographically against Google's published keys --
// deliberately not the tokeninfo HTTP endpoint, which Google's own docs say
// is rate-limited and meant for debugging, not production auth checks.
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Google sign-in is not configured");
  }

  const ticket = await getClient().verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error("Invalid Google credential");
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified ?? false,
    name: payload.name ?? null,
  };
}
