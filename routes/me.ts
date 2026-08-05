import express from "express";
import { resolveCurrentUser } from "../lib/resolveUser";

const router = express.Router();

router.get("/", async (req, res) => {
  const { user } = req.sso;
  if (!user?.domain || !user?.name) {
    return res.status(401).json({ error: "authentication_failed", message: "No SSO user on request." });
  }

  const record = await resolveCurrentUser(user.domain, user.name);

  res.json({
    domain: user.domain,
    username: user.name,
    displayName: user.displayName || user.name,
    isAdmin: record?.isAdmin ?? false,
    userId: record?.id ?? null,
    // Distinguishes "AD-authenticated but not provisioned in this app" from "fully set up".
    known: record != null,
  });
});

export default router;
