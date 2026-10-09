import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Permission } from "@/lib/permissions";
import { resolveSession } from "../services/auth.service";
import { can, type Actor } from "./actor";

export const SESSION_COOKIE = "erp_session";

export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** Current user for this request (memoized per request). */
export const getCurrentUser = cache(async (): Promise<Actor | null> => {
  const actor = await resolveSession(await getSessionToken());
  if (!actor) return null;
  return { ...actor, ip: await getClientIp() };
});

/** For server components/pages: redirects to /login when signed out. */
export async function requireUser(): Promise<Actor> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For server components/pages: redirects to /unauthorized without the permission. */
export async function requirePagePermission(permission: Permission): Promise<Actor> {
  const user = await requireUser();
  if (!can(user, permission)) redirect("/unauthorized");
  return user;
}
