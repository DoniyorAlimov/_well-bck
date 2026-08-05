import { sso } from "node-expose-sspi";

// Requires Windows SSO (Kerberos/NTLM via SSPI). Mount after any routes that
// should stay open (e.g. /health) — everything after this in the chain is gated.
//
// useSession caches the result of a successful handshake in req.session.sso
// so later requests skip SSPI entirely. Without it, every single request
// (including each fetch from the SPA) re-runs the full Negotiate/NTLM
// challenge-response from scratch, which is tied to one raw TCP connection —
// browsers don't guarantee a fetch()'s retries land on the same connection,
// so it can spin in an endless 401 loop instead of ever finishing. See
// https://github.com/jlguenego/node-expose-sspi (useSession option).
// forceNTLM skips Kerberos and always negotiates NTLM. This server isn't
// registered with a Kerberos SPN in AD (it's a plain Node process, not
// IIS/a domain service account), so from a genuinely remote machine the
// default "Negotiate" tries Kerberos first, fails to get a ticket, and never
// falls back cleanly — that's what produces an auth loop from other PCs.
// node-expose-sspi hardcodes NTLM when client === server, which is why it
// works from the box itself even without this flag. Forcing NTLM makes
// every client use the same path that already works locally.
export const ssoAuthMiddleware = sso.auth({
  useActiveDirectory: true,
  useGroups: true,
  allowsGuest: false,
  allowsAnonymousLogon: false,
  useSession: true,
  forceNTLM: true,
});
