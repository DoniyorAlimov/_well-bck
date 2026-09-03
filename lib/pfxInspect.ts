import { spawn } from "node:child_process";
import path from "node:path";

// Spawns scripts/inspect-pfx.ps1 (path/passphrase via env, not CLI args,
// same anti-injection precaution as dpapi.ts's runProtectedDataScript) to
// validate/describe a PFX without ever touching a Windows certificate store
// or requiring Administrator (X509KeyStorageFlags.EphemeralKeySet).

export interface PfxInspectResult {
  ok: true;
  hasPrivateKey: boolean;
  notBefore: string;
  notAfter: string;
  subject: string;
  dnsNames: string[];
  hasServerAuthEku: boolean;
  thumbprint: string;
}

export interface PfxInspectFailure {
  ok: false;
  error: string;
}

export function inspectPfx(
  filePath: string,
  passphrase: string
): Promise<PfxInspectResult | PfxInspectFailure> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "scripts", "inspect-pfx.ps1");

    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", scriptPath], {
      windowsHide: true,
      env: { ...process.env, PFX_INSPECT_PATH: filePath, PFX_INSPECT_PASSPHRASE: passphrase },
    });

    let stdout = "";
    let stderr = "";
    ps.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    ps.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`PFX inspection failed (exit ${code}): ${stderr.trim()}`));
        return;
      }
      resolve(JSON.parse(stdout.trim()) as PfxInspectResult | PfxInspectFailure);
    });
  });
}
