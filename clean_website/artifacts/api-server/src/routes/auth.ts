import { Router } from "express";
import { randomBytes } from "crypto";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { signToken, hashPassword, verifyPassword, requireAuth } from "../lib/auth";
import { isPremium } from "../lib/subscription";
import { verifyGoogleIdToken, isGoogleSignInConfigured, getGoogleClientId } from "../lib/google-auth";

const router = Router();

const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  name: z.string().min(1).optional(),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/auth/register", async (req, res) => {
  const body = RegisterBody.parse(req.body);

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, body.email));

  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await hashPassword(body.password);
  const [user] = await db
    .insert(usersTable)
    .values({ email: body.email, passwordHash, name: body.name ?? null })
    .returning({ id: usersTable.id, email: usersTable.email, name: usersTable.name, role: usersTable.role, subscriptionTier: usersTable.subscriptionTier, dailyReminderEmailEnabled: usersTable.dailyReminderEmailEnabled, gender: usersTable.gender });

  const token = signToken({ userId: user.id, email: user.email });
  res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, subscriptionTier: user.subscriptionTier, isPremium: isPremium(user), dailyReminderEmailEnabled: user.dailyReminderEmailEnabled, gender: user.gender } });
});

router.post("/auth/login", async (req, res) => {
  const body = LoginBody.parse(req.body);

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, body.email));

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signToken({ userId: user.id, email: user.email });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, subscriptionTier: user.subscriptionTier, isPremium: isPremium(user), dailyReminderEmailEnabled: user.dailyReminderEmailEnabled, gender: user.gender } });
});

router.get("/auth/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const { verifyToken } = await import("../lib/auth");
    const payload = verifyToken(authHeader.slice(7));
    const [user] = await db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, createdAt: usersTable.createdAt, role: usersTable.role, subscriptionTier: usersTable.subscriptionTier, dailyReminderEmailEnabled: usersTable.dailyReminderEmailEnabled, gender: usersTable.gender })
      .from(usersTable)
      .where(eq(usersTable.id, payload.userId));

    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: { ...user, isPremium: isPremium(user) } });
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
});

// Public: the frontend fetches the client ID at runtime instead of needing
// its own build-time env var, since the account owner only sets
// GOOGLE_CLIENT_ID on the server. Not a secret -- it's meant to end up in
// the browser either way, this just controls where it's configured.
router.get("/auth/google-client-id", (_req, res) => {
  res.json({ clientId: getGoogleClientId() });
});

const GoogleSignInBody = z.object({
  credential: z.string().min(1),
});

router.post("/auth/google", async (req, res) => {
  if (!isGoogleSignInConfigured()) {
    return res.status(503).json({ error: "Google sign-in is not configured" });
  }

  const body = GoogleSignInBody.parse(req.body);

  let identity;
  try {
    identity = await verifyGoogleIdToken(body.credential);
  } catch {
    return res.status(401).json({ error: "Invalid Google credential" });
  }

  // Google is the one vouching for this address here, not the user typing
  // it in -- an unverified email on the token isn't proof of ownership, so
  // it can't be trusted to create or link an account.
  if (!identity.emailVerified) {
    return res.status(401).json({ error: "Google account email is not verified" });
  }

  let [user] = await db.select().from(usersTable).where(eq(usersTable.googleId, identity.googleId));

  if (!user) {
    const [byEmail] = await db.select().from(usersTable).where(eq(usersTable.email, identity.email));
    if (byEmail) {
      // Same verified email as an existing password account -- link rather
      // than create a duplicate, same reasoning as the emailVerified check
      // above (Google has already proven ownership).
      [user] = await db.update(usersTable).set({ googleId: identity.googleId }).where(eq(usersTable.id, byEmail.id)).returning();
    } else {
      // No password will ever be checked against this account through the
      // normal login route, but the column is NOT NULL (see schema/users.ts)
      // -- an unguessable random value keeps that constraint satisfied
      // without ever being a usable password.
      const placeholderPassword = await hashPassword(randomBytes(32).toString("hex"));
      [user] = await db.insert(usersTable).values({
        email: identity.email,
        passwordHash: placeholderPassword,
        name: identity.name,
        googleId: identity.googleId,
      }).returning();
    }
  }

  const token = signToken({ userId: user.id, email: user.email });
  return res.json({
    token,
    user: {
      id: user.id, email: user.email, name: user.name, role: user.role,
      subscriptionTier: user.subscriptionTier, isPremium: isPremium(user),
      dailyReminderEmailEnabled: user.dailyReminderEmailEnabled, gender: user.gender,
    },
  });
});

const ReminderSettingsBody = z.object({
  dailyReminderEmailEnabled: z.boolean(),
});

// Behind requireAuth explicitly (not the global app.ts mount, which skips
// authRouter entirely) since this one route -- unlike register/login/me --
// needs to identify an already-logged-in user.
router.patch("/auth/me/reminder-settings", requireAuth, async (req, res) => {
  const body = ReminderSettingsBody.parse(req.body);
  const userId = req.user!.userId;

  const [user] = await db
    .update(usersTable)
    .set({ dailyReminderEmailEnabled: body.dailyReminderEmailEnabled })
    .where(eq(usersTable.id, userId))
    .returning({ dailyReminderEmailEnabled: usersTable.dailyReminderEmailEnabled });

  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ dailyReminderEmailEnabled: user.dailyReminderEmailEnabled });
});

const GenderBody = z.object({
  gender: z.enum(["male", "female", "other"]),
});

// Persists the "form of address" preference so it survives a fresh login --
// previously frontend/localStorage-only (see lib/auth.tsx's updateUser),
// which meant the very next login overwrote it with the server's response
// that never had a gender field to begin with.
router.patch("/auth/me/gender", requireAuth, async (req, res) => {
  const body = GenderBody.parse(req.body);
  const userId = req.user!.userId;

  const [user] = await db
    .update(usersTable)
    .set({ gender: body.gender })
    .where(eq(usersTable.id, userId))
    .returning({ gender: usersTable.gender });

  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ gender: user.gender });
});

export default router;
