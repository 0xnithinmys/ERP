import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db";
import { AppError } from "../errors";
import { burnPasswordCheck, verifyPassword } from "../auth/password";
import { rateLimit, resetRateLimit } from "../auth/rate-limit";
import type { Actor } from "../auth/actor";
import { audit } from "./audit.service";
import type { RoleCode } from "@/lib/permissions";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours (one working day)
const TOUCH_INTERVAL_MS = 1000 * 60 * 5;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function login(input: { username: string; password: string; ip?: string | null; userAgent?: string | null }) {
  const username = input.username.trim().toLowerCase();
  const limiterKey = `login:${input.ip ?? "unknown"}:${username}`;
  const limit = rateLimit(limiterKey, 8, 1000 * 60 * 5);
  if (!limit.ok) {
    throw new AppError("RATE_LIMITED", "Too many login attempts. Please wait a few minutes and try again.");
  }

  const user = await prisma.user.findUnique({ where: { username } });
  const valid = user ? await verifyPassword(input.password, user.passwordHash) : await burnPasswordCheck(input.password);
  if (!user || !valid || !user.isActive) {
    throw new AppError("UNAUTHENTICATED", user && valid && !user.isActive ? "This account is disabled" : "Invalid username or password");
  }
  resetRateLimit(limiterKey);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.$transaction([
    prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    }),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } }),
  ]);
  const actor: Actor = { id: user.id, name: user.name, username: user.username, role: user.role as RoleCode, ip: input.ip };
  await audit(prisma, actor, { action: "auth.login", entity: "User", entityId: user.id, summary: `${user.name} signed in` });
  return { token, expiresAt, user: actor };
}

/** Resolves a session token to an active user, or null. Sliding refresh of lastSeen. */
export async function resolveSession(token: string | undefined | null): Promise<Actor | null> {
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, name: true, username: true, role: true, isActive: true } } },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.isActive) return null;
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  const { user } = session;
  return { id: user.id, name: user.name, username: user.username, role: user.role as RoleCode };
}

export async function logout(token: string | undefined | null) {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
