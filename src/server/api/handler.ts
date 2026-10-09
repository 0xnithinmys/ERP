import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import type { Permission } from "@/lib/permissions";
import { AppError, forbidden, toAppError, unauthenticated } from "../errors";
import { can, type Actor } from "../auth/actor";
import { getCurrentUser } from "../auth/session";
import { logger } from "../logger";

export interface RouteContext<P> {
  req: NextRequest;
  actor: Actor;
  params: P;
  /** Parses and validates the JSON body with a Zod schema. */
  body: <S extends z.ZodTypeAny>(schema: S) => Promise<z.output<S>>;
  /** Parses and validates the query string with a Zod schema. */
  query: <S extends z.ZodTypeAny>(schema: S) => z.output<S>;
}

interface RouteOptions {
  /** Permission required (checked server-side for every call). */
  permission?: Permission;
}

type Handler<P> = (ctx: RouteContext<P>) => Promise<unknown>;

/**
 * Wraps a route handler with: authentication, permission check, same-origin check
 * for mutations, input validation and safe error responses. Every API route uses
 * this, so authorization cannot be bypassed by calling the API directly.
 */
export function route<P = Record<string, string>>(opts: RouteOptions, handler: Handler<P>) {
  return async (req: NextRequest, segment: { params: Promise<P> }) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      const actor = await getCurrentUser();
      if (!actor) throw unauthenticated();
      if (opts.permission && !can(actor, opts.permission)) throw forbidden();
      const params = (await segment?.params) ?? ({} as P);
      const result = await handler({
        req,
        actor,
        params,
        body: async (schema) => {
          let raw: unknown;
          try {
            raw = await req.json();
          } catch {
            throw new AppError("VALIDATION", "Request body must be valid JSON");
          }
          return schema.parse(raw);
        },
        query: (schema) => schema.parse(Object.fromEntries(req.nextUrl.searchParams)),
      });
      if (result instanceof Response) return result;
      return NextResponse.json({ data: result ?? null });
    } catch (err) {
      return errorResponse(err, req);
    }
  };
}

export function errorResponse(err: unknown, req?: NextRequest) {
  const appErr = toAppError(err);
  if (appErr.code === "INTERNAL") logger.error("API request failed", { path: req?.nextUrl.pathname, method: req?.method });
  return NextResponse.json(
    { error: { code: appErr.code, message: appErr.message, details: appErr.details ?? null } },
    { status: appErr.status },
  );
}

/** CSRF defence in depth (cookies are SameSite=Lax): mutations must come from our own origin. */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients; the session cookie is still required
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden("Invalid request origin");
  }
  const allowed = new Set([host, process.env.APP_URL ? new URL(process.env.APP_URL).host : null].filter(Boolean));
  if (!allowed.has(originHost)) throw forbidden("Cross-site request blocked");
}
