import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodType } from "zod";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { AppError } from "./errors";
import { API_LIMITS, consume, type ApiLimit } from "./rate-limit";

/**
 * Route handler helpers. Every /api handler (except auth and health) goes
 * through `withUser`, so authentication, validation and error shaping are
 * uniform:
 *   success → { data, meta? }      error → { error: { code, message, details? } }
 */
export type ApiUser = { id: string; email: string; name: string };

const MAX_JSON_BYTES = 2 * 1024 * 1024;

export function ok<T>(data: T, init?: { status?: number; meta?: Record<string, unknown> }) {
  return NextResponse.json(init?.meta ? { data, meta: init.meta } : { data }, { status: init?.status ?? 200 });
}

export function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: details === undefined ? { code, message } : { code, message, details } }, { status });
}

export async function parseJson<S extends ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_JSON_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_JSON_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
    body = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  return parseWith(schema, body);
}

export function parseQuery<S extends ZodType>(req: Request, schema: S): z.infer<S> {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  return parseWith(schema, params);
}

export function parseWith<S extends ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_FAILED", "Request validation failed", z.flattenError(parsed.error));
  }
  return parsed.data;
}

type Handler<C> = (req: NextRequest, ctx: C & { user: ApiUser }) => Promise<Response>;

/**
 * Authenticated route handler with per-user rate limiting. The bucket defaults
 * to "read" for GET/HEAD and "write" otherwise; routes can choose a stricter one.
 */
export function withUser<C extends object>(handler: Handler<C>, options: { limit?: ApiLimit } = {}) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      // CSRF defence in depth (cookies are also SameSite=Lax): browsers send Origin on
      // cross-site mutations, so reject any that doesn't match the app's own origin.
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        if (origin && origin !== new URL(env.APPLICATION_URL).origin) {
          return errorResponse(403, "FORBIDDEN_ORIGIN", "Cross-origin requests are not allowed");
        }
      }
      const session = await auth.api.getSession({ headers: req.headers });
      if (!session) return errorResponse(401, "UNAUTHORIZED", "Sign in to continue");
      const { id, email, name } = session.user;
      const bucket = options.limit ?? (req.method === "GET" || req.method === "HEAD" ? "read" : "write");
      const verdict = await consume(`api:${bucket}:${id}`, API_LIMITS[bucket]);
      if (!verdict.allowed) {
        const res = errorResponse(429, "RATE_LIMITED", "Too many requests. Please slow down.");
        res.headers.set("Retry-After", String(verdict.retryAfter ?? 60));
        return res;
      }
      return await handler(req, { ...ctx, user: { id, email, name } });
    } catch (e) {
      if (e instanceof AppError) {
        const res = errorResponse(e.status, e.code, e.message, e.details);
        if (e.status === 416 && (e.details as { size?: number })?.size !== undefined) res.headers.set("Content-Range", `bytes */${(e.details as { size: number }).size}`);
        return res;
      }
      const ref = crypto.randomUUID().slice(0, 8);
      console.error(`[api] unhandled error ref=${ref}`, { path: new URL(req.url).pathname, name: (e as Error)?.name, code: (e as { code?: unknown })?.code });
      if (process.env.NODE_ENV !== "production") console.error(e);
      return errorResponse(500, "INTERNAL", `Something went wrong (ref ${ref})`);
    }
  };
}
