import { normalizeDomainUsername } from "./domainUsername";
import { prisma } from "../prisma/client";

// isAdmin is read straight off the resolved User row — no separate role
// table to join. Never auto-creates a User row on login — only the admin's
// explicit "add user" flow (routes/users.ts) creates rows, so this table
// doesn't fill up with every AD login that happens to hit the app.
export async function resolveCurrentUser(domain: string, username: string) {
  return prisma.user.findUnique({
    where: { domainUsername: normalizeDomainUsername(domain, username) },
  });
}
