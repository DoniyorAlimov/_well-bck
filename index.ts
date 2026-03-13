import express from "express";
import fs from "fs";
import https from "https";
import path from "path";
import { getCertPassword, getCertPath } from "./digitCert";
import job from "./jobs/job";
import cors from "cors";
import PHDTags from "./routes/PHDTags";
import assets from "./routes/assets";
import assignments from "./routes/assignments";
import attributeTypes from "./routes/attributeTypes";
import attributes from "./routes/attributes";
import auth from "./routes/auth";
import constants from "./routes/constants";
import dataSources from "./routes/dataSources";
import records from "./routes/records";
import targets from "./routes/targets";
import units from "./routes/units";
import users from "./routes/users";
import utitlityTypes from "./routes/utitlityTypes";
import getKey from "./utils/getKey";

const app = express();

if (!getKey()) {
  console.error("FATAL ERROR: secret key is not defined.");
  process.exit(1);
}

app.use(express.json());
app.use(cors({ origin: "http://localhost:5173" }));
app.use("/api/assets", assets);
app.use("/api/units", units);
app.use("/api/attribute-types", attributeTypes);
app.use("/api/utility-types", utitlityTypes);
app.use("/api/attributes", attributes);
app.use("/api/phd-tags", PHDTags);
app.use("/api/assignments", assignments);
app.use("/api/targets", targets);
app.use("/api/records", records);
app.use("/api/data-sources", dataSources);
app.use("/api/constants", constants);
app.use("/api/users", users);
app.use("/api/auth", auth);

job;

const port = process.env.PORT || 3000;

if (app.get("env") === "development") {
  app.listen(port, () => console.log(`Listen on http://localhost:${port}`));
} else {
  const options = {
    pfx: fs.readFileSync(getCertPath()),
    passphrase: getCertPassword(),
  };

  const httpsServer = https.createServer(options, app);
  httpsServer.listen({ port, host: "0.0.0.0" }, () =>
    console.log(`Listen on https://localhost:${port}`)
  );
}
