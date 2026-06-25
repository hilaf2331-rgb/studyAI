import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { signToken, hashPassword, verifyPassword } from "../lib/auth";
import { isPremium } from "../lib/subscription";

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
    .returning({ id: usersTable.id, email: usersTable.email, name: usersTable.name, role: usersTable.role, subscriptionTier: usersTable.subscriptionTier });

  const token = signToken({ userId: user.id, email: user.email });
  res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, subscriptionTier: user.subscriptionTier, isPremium: isPremium(user) } });
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
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, subscriptionTier: user.subscriptionTier, isPremium: isPremium(user) } });
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
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, createdAt: usersTable.createdAt, role: usersTable.role, subscriptionTier: usersTable.subscriptionTier })
      .from(usersTable)
      .where(eq(usersTable.id, payload.userId));

    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: { ...user, isPremium: isPremium(user) } });
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
});

export default router;
