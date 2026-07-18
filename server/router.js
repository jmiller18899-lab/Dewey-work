/**
 * Mountable ClawAgent router.
 *
 * Designed to be dropped into the existing clawagent gateway:
 *
 *   import { createClawagentRouter } from "./server/router.js";
 *   app.use(createClawagentRouter());
 *
 * It carries its own body parsing, CORS allowlist, and all /api routes plus
 * /health, so the host app needs no additional wiring.
 */
import express, { Router } from "express";
import cors from "cors";
import { config } from "./lib/config.js";
import { leadsRouter } from "./routes/leads.js";
import { salesRouter } from "./routes/sales.js";
import { outreachRouter } from "./routes/outreach.js";
import { adminRouter } from "./routes/admin.js";

export function createClawagentRouter() {
  const router = Router();

  router.use(
    cors({
      origin(origin, callback) {
        // Non-browser callers (no Origin header: curl, Twilio webhooks) pass;
        // browsers are restricted to the configured frontend origins.
        if (!origin || config.frontendOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
      allowedHeaders: ["Content-Type", "Accept", "Authorization", "X-Idempotency-Key"],
      maxAge: 600,
    })
  );

  router.use(express.json({ limit: "1mb" }));
  router.use(express.urlencoded({ extended: false, limit: "256kb" })); // Twilio webhooks

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "clawagent-gateway",
      time: new Date().toISOString(),
      capabilities: {
        chat: Boolean(config.openrouterApiKey),
        voice_realtime: Boolean(config.xaiApiKey),
        telephony: Boolean(config.twilioSid && config.twilioAuth && config.twilioFrom),
        persistence: Boolean(config.supabaseUrl && config.supabaseServiceKey),
        alerts: Boolean(config.ntfyTopic),
      },
    });
  });

  router.use(leadsRouter);
  router.use(salesRouter);
  router.use(outreachRouter);
  router.use(adminRouter);

  // JSON error handler so malformed bodies never leak stack traces.
  router.use((error, _req, res, _next) => {
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Malformed JSON body." });
    }
    console.error("[gateway] unhandled error:", error);
    return res.status(500).json({ error: "Internal gateway error." });
  });

  return router;
}
