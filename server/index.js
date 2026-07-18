/**
 * Standalone entrypoint for Railway.
 *
 * Serves the static ClawAgent frontend from /public and mounts the full API
 * router. Binds 0.0.0.0 and respects $PORT; no volume, ephemeral disk only.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { config } from "./lib/config.js";
import { createClawagentRouter } from "./router.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1); // Railway terminates TLS in front of us

app.use(createClawagentRouter());
app.use(express.static(path.join(here, "..", "public"), { maxAge: "5m", index: "index.html" }));

app.listen(config.port, config.host, () => {
  console.log(`ClawAgent gateway listening on ${config.host}:${config.port}`);
  console.log(`Allowed frontend origins: ${config.frontendOrigins.join(", ") || "(none)"}`);
});
