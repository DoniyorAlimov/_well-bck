import { spawn } from "node:child_process";

// Wraps .NET's System.Security.Cryptography.ProtectedData (the same DPAPI
// Windows itself uses for saved credentials) via a PowerShell child process,
// rather than adding a native npm dependency. LocalMachine scope (not
// CurrentUser) so ciphertext decrypts under whatever account runs the
// process, including an NSSM service account with no loaded user profile.
//
// The secret is passed to the child process via its environment block, not
// as a -Command argument — that avoids both PowerShell quoting/injection
// issues if the secret contains quotes or backticks, and leaving the secret
// visible in a process-listing command line.
const SCOPE = "LocalMachine";

function runProtectedDataScript(
  operation: "Protect" | "Unprotect",
  input: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const script = [
      "Add-Type -AssemblyName System.Security",
      "$bytes = " +
        (operation === "Protect"
          ? "[System.Text.Encoding]::UTF8.GetBytes($env:DPAPI_INPUT)"
          : "[Convert]::FromBase64String($env:DPAPI_INPUT)"),
      `$result = [System.Security.Cryptography.ProtectedData]::${operation}($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::${SCOPE})`,
      operation === "Protect"
        ? "[Convert]::ToBase64String($result)"
        : "[System.Text.Encoding]::UTF8.GetString($result)",
    ].join("; ");

    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      env: { ...process.env, DPAPI_INPUT: input },
    });

    let stdout = "";
    let stderr = "";
    ps.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    ps.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(`DPAPI ${operation.toLowerCase()} failed (exit ${code}): ${stderr.trim()}`)
        );
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export function dpapiProtect(plaintext: string): Promise<string> {
  return runProtectedDataScript("Protect", plaintext);
}

export function dpapiUnprotect(base64Ciphertext: string): Promise<string> {
  return runProtectedDataScript("Unprotect", base64Ciphertext);
}
