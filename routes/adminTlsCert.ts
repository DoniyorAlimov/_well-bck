import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { Request, Response } from "express";
import { dpapiProtect, dpapiUnprotect } from "../lib/dpapi";
import { inspectPfx } from "../lib/pfxInspect";
import { isRestartRequired, markRestartRequired } from "../lib/tlsCertState";
import { requireAdmin } from "../middlewares/requireAdmin";
import { uploadTlsCertRequestSchema } from "../schemas";

const router = express.Router();

const certDir = path.join(process.cwd(), "cert");
const activePfxPath = path.join(certDir, "active.pfx");
const activePassphrasePath = path.join(certDir, "active.pfx.passphrase");
// Sibling to cert/, not inside it, and on the same volume as cert/ (both
// under the repo root) so the final swap can use an atomic fs.renameSync —
// an upload is fully validated here before cert/ is ever touched, and this
// directory never holds more than one in-flight upload at a time.
const uploadTmpDir = path.join(process.cwd(), "cert-upload-tmp");

// Current active certificate, or null if none has been installed yet.
router.get("/", [requireAdmin], async (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(activePfxPath)) {
      res.send(null);
      return;
    }

    const passphrase = await dpapiUnprotect(fs.readFileSync(activePassphrasePath, "utf8").trim());
    const result = await inspectPfx(activePfxPath, passphrase);
    if (!result.ok) {
      // The active cert should always be one we ourselves validated on the
      // way in — if it can't be read back, that's a server-side problem,
      // not a client input problem.
      res.status(500).send({ error: "active_cert_unreadable", message: result.error });
      return;
    }

    res.send({
      subject: result.subject,
      dnsNames: result.dnsNames,
      notBefore: result.notBefore,
      notAfter: result.notAfter,
      restartRequired: isRestartRequired(),
    });
  } catch (err) {
    // An uncaught rejection inside an async Express handler crashes the
    // whole process, not just this one request (seen for real in the
    // sibling APM project: an EPERM from a locked-down cert file took the
    // entire backend down) — always resolve to a response here.
    res.status(500).send({
      error: "tls_cert_read_failed",
      message: err instanceof Error ? err.message : "Failed to read the active certificate.",
    });
  }
});

// Replace the active certificate with an uploaded PFX.
router.put("/", [requireAdmin], async (req: Request, res: Response) => {
  const validation = uploadTlsCertRequestSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).send(validation.error.format());

  const { pfxBase64, passphrase } = validation.data;

  fs.mkdirSync(uploadTmpDir, { recursive: true });
  const tmpPfxPath = path.join(uploadTmpDir, `${randomUUID()}.pfx`);

  try {
    fs.writeFileSync(tmpPfxPath, Buffer.from(pfxBase64, "base64"));

    const result = await inspectPfx(tmpPfxPath, passphrase);
    if (!result.ok) {
      res.status(400).send({ error: "invalid_pfx", message: result.error });
      return;
    }
    if (!result.hasPrivateKey) {
      res.status(400).send({
        error: "pfx_missing_private_key",
        message: "The uploaded PFX does not contain a private key.",
      });
      return;
    }
    const now = new Date();
    if (now < new Date(result.notBefore) || now > new Date(result.notAfter)) {
      res.status(400).send({
        error: "pfx_not_currently_valid",
        message: `Certificate validity window is ${result.notBefore} to ${result.notAfter}, which does not include now.`,
      });
      return;
    }
    if (!result.hasServerAuthEku) {
      res.status(400).send({
        error: "pfx_unsuitable_key_usage",
        message: "The uploaded certificate is not suitable for TLS server authentication.",
      });
      return;
    }

    const protectedPassphrase = await dpapiProtect(passphrase);
    fs.mkdirSync(certDir, { recursive: true });
    fs.renameSync(tmpPfxPath, activePfxPath);
    fs.writeFileSync(activePassphrasePath, protectedPassphrase);

    markRestartRequired();

    res.send({
      subject: result.subject,
      dnsNames: result.dnsNames,
      notBefore: result.notBefore,
      notAfter: result.notAfter,
      restartRequired: true,
    });
  } catch (err) {
    // Same reasoning as the GET handler's catch above.
    res.status(500).send({
      error: "tls_cert_replace_failed",
      message: err instanceof Error ? err.message : "Failed to replace the certificate.",
    });
  } finally {
    if (fs.existsSync(tmpPfxPath)) {
      fs.unlinkSync(tmpPfxPath);
    }
  }
});

export default router;
