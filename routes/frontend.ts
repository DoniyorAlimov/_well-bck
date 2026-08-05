import express from "express";
import path from "path";

// Serves the built frontend (_well-web/dist) from the same origin as the
// API, so the browser never has to make a cross-origin request — required
// for the SSO session cookie/NTLM handshake to work reliably (see
// middlewares/sso.ts). Mounted before the SSO gate in index.ts, so loading
// the SPA itself never triggers an SSPI handshake.
//
// _well-bck and _well-web are two independent git repos; by default this
// assumes they stay siblings on disk (../../_well-web/dist relative to this
// file), matching local dev. Override FRONTEND_DIST_PATH if a deploy step
// copies the built frontend somewhere else instead (see setup docs).
const distPath = process.env.FRONTEND_DIST_PATH
  ? path.resolve(process.env.FRONTEND_DIST_PATH)
  : path.join(__dirname, "../../_well-web/dist");

const router = express.Router();

router.use(express.static(distPath));

// SPA fallback: any unmatched GET that isn't /api or /health returns
// index.html so client-side routing (react-router) can take over. Excluding
// /api means an unmatched API path still 404s through the API router
// instead of getting index.html back.
router.get(/^(?!\/api|\/health).*/, (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

export default router;
