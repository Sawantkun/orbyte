import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodType } from "zod";
import { auth } from "@/lib/auth";
import { AppError } from "./errors";

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

export function withUser<C extends object>(handler: Handler<C>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      const session = await auth.api.getSession({ headers: req.headers });
      if (!session) return errorResponse(401, "UNAUTHORIZED", "Sign in to continue");
      const { id, email, name } = session.user;
      return await handler(req, { ...ctx, user: { id, email, name } });
    } catch (e) {
      if (e instanceof AppError) return errorResponse(e.status, e.code, e.message, e.details);
      const ref = crypto.randomUUID().slice(0, 8);
      console.error(`[api] unhandled error ref=${ref}`, { path: new URL(req.url).pathname, name: (e as Error)?.name, code: (e as { code?: unknown })?.code });
      if (process.env.NODE_ENV !== "production") console.error(e);
      return errorResponse(500, "INTERNAL", `Something went wrong (ref ${ref})`);
    }
  };
}
