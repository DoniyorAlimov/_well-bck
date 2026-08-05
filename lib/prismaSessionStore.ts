import { Store, type SessionData } from "express-session";
import { prisma } from "../prisma/client";

// SQL Server-backed replacement for express-session's default MemoryStore
// (see middlewares/session.ts) — MemoryStore leaks memory over a long-running
// NSSM-managed process and loses every session on restart, which matters here
// specifically because ssoAuthMiddleware's useSession caches the SSPI
// handshake result in the session (see middlewares/sso.ts) — losing that
// cache forces every request back into a fresh NTLM challenge-response.
// Reuses the app's existing `prisma` singleton, no new connection/credentials.
//
// Every method swallows its own DB errors rather than passing them to
// express-session's callback: express-session's res.end hook only reports a
// store error to Express's error middleware *after* the response has
// already been written, which isn't a safe place to surface a failure from.
// Degrading instead — get() reports a miss (forces a cheap re-handshake),
// set()/destroy()/touch() report success (the in-flight request is
// unaffected either way; a real persistence gap just surfaces later as a
// get() miss) — keeps a transient DB blip from ever breaking a request.
// Failures are still logged so a persistent outage is visible.

const DEFAULT_MAX_AGE_MS = 1000 * 60 * 60 * 8; // matches cookie.maxAge in session.ts
const CLEANUP_INTERVAL_MS = 1000 * 60 * 60; // 1 hour

function resolveExpiresAt(cookie: SessionData["cookie"]): Date {
  if (cookie.expires instanceof Date) {
    return cookie.expires;
  }
  if (typeof cookie.maxAge === "number") {
    return new Date(Date.now() + cookie.maxAge);
  }
  return new Date(Date.now() + DEFAULT_MAX_AGE_MS);
}

export class PrismaSessionStore extends Store {
  constructor() {
    super();
    // SQL Server has no TTL/expiring-collection feature, so expired rows
    // only go away via this sweep (below) or a lazy check in get() — an
    // immediate sweep at construction catches anything stale from a
    // previous process lifetime, not just steady-state.
    void this.cleanupExpired();
    setInterval(() => void this.cleanupExpired(), CLEANUP_INTERVAL_MS).unref();
  }

  private async cleanupExpired(): Promise<void> {
    try {
      await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    } catch (err) {
      console.error("[prismaSessionStore] cleanup sweep failed:", err);
    }
  }

  override get(sid: string, callback: (err: unknown, session?: SessionData | null) => void): void {
    prisma.session
      .findUnique({ where: { sid } })
      .then((row) => {
        if (!row || row.expiresAt <= new Date()) {
          callback(null, null);
          if (row) {
            void prisma.session.delete({ where: { sid } }).catch(() => {});
          }
          return;
        }
        callback(null, JSON.parse(row.data) as SessionData);
      })
      .catch((err: unknown) => {
        console.error("[prismaSessionStore] get failed:", err);
        callback(null, null);
      });
  }

  override set(sid: string, sessionData: SessionData, callback?: (err?: unknown) => void): void {
    const expiresAt = resolveExpiresAt(sessionData.cookie);
    const data = JSON.stringify(sessionData);
    prisma.session
      .upsert({ where: { sid }, create: { sid, data, expiresAt }, update: { data, expiresAt } })
      .then(() => callback?.())
      .catch((err: unknown) => {
        console.error("[prismaSessionStore] set failed:", err);
        callback?.();
      });
  }

  override destroy(sid: string, callback?: (err?: unknown) => void): void {
    prisma.session
      .delete({ where: { sid } })
      .then(() => callback?.())
      .catch((err: { code?: string }) => {
        // P2025 = row already gone (e.g. lazy-expired by a concurrent get()) — not worth logging.
        if (err?.code !== "P2025") {
          console.error("[prismaSessionStore] destroy failed:", err);
        }
        callback?.();
      });
  }

  override touch(sid: string, sessionData: SessionData, callback?: () => void): void {
    const expiresAt = resolveExpiresAt(sessionData.cookie);
    prisma.session
      .update({ where: { sid }, data: { expiresAt } })
      .then(() => callback?.())
      .catch((err: { code?: string }) => {
        if (err?.code !== "P2025") {
          console.error("[prismaSessionStore] touch failed:", err);
        }
        callback?.();
      });
  }
}
