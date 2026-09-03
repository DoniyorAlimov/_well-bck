import "dotenv/config";
import express, { Router } from "express";
import fs from "fs";
import https from "https";
import { getCertPassphrase, getCertPath } from "./digitCert";
import job from "./jobs/job";
import cors from "cors";
import { authErrorHandler } from "./middlewares/authErrorHandler";
import { sessionMiddleware } from "./middlewares/session";
import { ssoAuthMiddleware } from "./middlewares/sso";
import PHDTags from "./routes/PHDTags";
import adminTlsCert from "./routes/adminTlsCert";
import assets from "./routes/assets";
import assignments from "./routes/assignments";
import attributeTypes from "./routes/attributeTypes";
import attributes from "./routes/attributes";
import constants from "./routes/constants";
import dataSources from "./routes/dataSources";
import frontend from "./routes/frontend";
import health from "./routes/health";
import me from "./routes/me";
import records from "./routes/records";
import targets from "./routes/targets";
import trend from "./routes/trend";
import units from "./routes/units";
import users from "./routes/users";
import utitlityTypes from "./routes/utitlityTypes";

// Route modules mount their endpoints relative to '/' — the '/api' prefix
// lives here so it's defined once for every current and future API router.
const apiRouter = Router();
apiRouter.use("/me", me);
apiRouter.use("/assets", assets);
apiRouter.use("/units", units);
apiRouter.use("/attribute-types", attributeTypes);
apiRouter.use("/utility-types", utitlityTypes);
apiRouter.use("/attributes", attributes);
apiRouter.use("/phd-tags", PHDTags);
apiRouter.use("/assignments", assignments);
apiRouter.use("/targets", targets);
apiRouter.use("/records", records);
apiRouter.use("/trend", trend);
apiRouter.use("/data-sources", dataSources);
apiRouter.use("/constants", constants);
apiRouter.use("/users", users);
apiRouter.use("/admin/tls-cert", adminTlsCert);

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use(health);
app.use(frontend);

// Everything registered below this point requires Windows SSO (Kerberos/NTLM via SSPI).
app.use(sessionMiddleware);
app.use(ssoAuthMiddleware);

app.use("/api", apiRouter);

app.use(authErrorHandler);

job;

const port = process.env.PORT || 3000;

if (app.get("env") === "development") {
  app.listen(port, () => console.log(`Listen on http://localhost:${port}`));
} else {
  // getCertPassphrase() unprotects the DPAPI-encrypted sidecar file, which
  // requires spawning a PowerShell child process (see lib/dpapi.ts) — this
  // module has no top-level await available under CommonJS, so the whole
  // HTTPS startup is wrapped in this async IIFE instead.
  (async () => {
    const options = {
      pfx: fs.readFileSync(getCertPath()),
      passphrase: await getCertPassphrase(),
    };

    const httpsServer = https.createServer(options, app);
    httpsServer.listen({ port, host: "0.0.0.0" }, () =>
      console.log(`Listen on https://localhost:${port}`)
    );
  })();
}
