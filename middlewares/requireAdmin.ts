import type { NextFunction, Request, Response } from "express";
import { resolveCurrentUser } from "../lib/resolveUser";

// Real security boundary for admin-only routes. Re-derives isAdmin from the
// DB on every request via the SSPI-resolved identity — never trust a
// client-supplied value.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const { user } = req.sso;
  if (!user?.domain || !user?.name) {
    res.status(401).json({ error: "authentication_failed", message: "No SSO user on request." });
    return;
  }

  resolveCurrentUser(user.domain, user.name)
    .then((record) => {
      if (!record?.isAdmin) {
        res.status(403).json({ error: "forbidden", message: "This action requires an admin." });
        return;
      }
      next();
    })
    .catch(next);
}
