import session from "express-session";
import { PrismaSessionStore } from "../lib/prismaSessionStore";

// Session cache so the SSPI handshake (see ssoAuthMiddleware) runs once per
// browser session instead of on every request. Mount before ssoAuthMiddleware
// only — public/static requests should never get a session cookie.
// store: PrismaSessionStore persists to SQL Server instead of the default
// MemoryStore, which leaks memory over this NSSM-managed process's uptime
// and loses every session on restart — see lib/prismaSessionStore.ts.
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.error("FATAL ERROR: SESSION_SECRET is not defined.");
  process.exit(1);
}

export const sessionMiddleware = session({
  name: "well.sid",
  secret: sessionSecret,
  store: new PrismaSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 },
});
