import "server-only";
import { db } from "@/lib/db";

export type SessionSummary = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  updatedAt: string;
  current: boolean;
};

/** Active sessions for a user. Never includes the session token. */
export async function listActiveSessions(userId: string, currentSessionId: string | undefined): Promise<SessionSummary[]> {
  const rows = await db.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, userAgent: true, ipAddress: true, createdAt: true, updatedAt: true },
  });
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    current: r.id === currentSessionId,
  }));
}

/** Compact "Browser on OS" label from a user agent string. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : /Playwright|HeadlessChrome/.test(ua)
            ? "Automated browser"
            : "Browser";
  const os = /Mac OS X/.test(ua)
    ? "macOS"
    : /Windows/.test(ua)
      ? "Windows"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Android/.test(ua)
          ? "Android"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${os}`;
}

const LOOPBACK = new Set(["::1", "127.0.0.1", "0000:0000:0000:0000:0000:0000:0000:0001", "0000:0000:0000:0000:0000:0000:0000:0000"]);

export function describeIp(ip: string | null): string {
  if (!ip) return "Unknown IP";
  return LOOPBACK.has(ip) ? "Local network" : ip;
}

export type RevokeResult = { ok: true } | { ok: false; error: string };

/**
 * Revoke one of a user's sessions by id. Refuses the caller's current session
 * and only deletes rows owned by `userId`, so ids belonging to other users are
 * indistinguishable from missing ones.
 */
export async function revokeUserSession(userId: string, sessionId: unknown, currentSessionId: string | undefined): Promise<RevokeResult> {
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 64) {
    return { ok: false, error: "Invalid session" };
  }
  if (sessionId === currentSessionId) return { ok: false, error: "Use sign out to end your current session." };
  const result = await db.session.deleteMany({ where: { id: sessionId, userId } });
  if (result.count === 0) return { ok: false, error: "Session not found" };
  return { ok: true };
}
