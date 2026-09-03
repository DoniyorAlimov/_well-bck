import fs from "node:fs";
import path from "node:path";
import { dpapiUnprotect } from "./lib/dpapi";

// HTTPS is production-only (`npm start`, which sets NODE_ENV=production) —
// `npm run dev` keeps serving plain HTTP (see index.ts). The active cert is
// always cert/active.pfx, with its DPAPI-protected passphrase in the
// sidecar file cert/active.pfx.passphrase (both git-ignored) — a fixed
// convention (not env-configurable) so there's only ever one active cert on
// disk. Written by `npm run setup:tls-cert` (bootstrap self-signed, see
// scripts/setup-tls-cert.ps1) or replaced via Admin Console -> TLS
// Certificate (see routes/adminTlsCert.ts).
const certDir = path.join(process.cwd(), "cert");
const certPath = path.join(certDir, "active.pfx");
const passphrasePath = path.join(certDir, "active.pfx.passphrase");

export function getCertPath(): string {
  return certPath;
}

export function getCertPassphrase(): Promise<string> {
  const protectedPassphrase = fs.readFileSync(passphrasePath, "utf8").trim();
  return dpapiUnprotect(protectedPassphrase);
}
