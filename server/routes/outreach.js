/**
 * Twilio outreach routes:
 *   POST /api/outreach/sms            — outbound SMS (E.164 + idempotency + Supabase log)
 *   POST /api/outreach/call           — outbound voice call (same protections)
 *   POST /api/outreach/inbound/sms    — Twilio webhook for texts to the ClawAgent number
 *   POST /api/outreach/inbound/voice  — Twilio webhook for calls to the ClawAgent number
 *
 * Inbound number: (762) 334-0186 — point both webhook URLs at this gateway in
 * the Twilio console.
 */
import { Router } from "express";
import { badRequest, validE164, validSessionId } from "../lib/validate.js";
import { insertRow, supabase } from "../lib/supabase.js";
import { sendSms, startCall, validTwilioSignature, escapeXml } from "../lib/twilio.js";
import { config } from "../lib/config.js";
import { rateLimit } from "../lib/ratelimit.js";
import { idempotency } from "../lib/idempotency.js";

export const outreachRouter = Router();

async function alreadySent(idempotencyKey) {
  if (!idempotencyKey) return false;
  const db = supabase();
  if (!db) return false;
  const { data } = await db
    .from("outreach_log")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .limit(1);
  return Boolean(data?.length);
}

async function handleOutbound(kind, req, res) {
  const { to, message, session_id: sessionId } = req.body || {};
  if (!validE164(to)) return badRequest(res, "Provide an E.164 phone number, e.g. +15551234567.");
  if (sessionId !== undefined && !validSessionId(sessionId)) {
    return badRequest(res, "Invalid session_id.");
  }
  if (kind === "sms" && (typeof message !== "string" || !message.trim() || message.length > 1000)) {
    return badRequest(res, "Provide a message of up to 1,000 characters.");
  }

  const idempotencyKey = req.get("X-Idempotency-Key") || null;

  try {
    // Durable idempotency: refuse a re-send whose key is already logged.
    if (await alreadySent(idempotencyKey)) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    const result =
      kind === "sms"
        ? await sendSms(to, message.trim())
        : await startCall(
            to,
            message?.trim() ||
              "Hello, this is ClawAgent calling about your website's technical S E O and A I search visibility. A human team member will follow up shortly."
          );

    await insertRow("outreach_log", {
      direction: "outbound",
      kind,
      to_number: to,
      from_number: config.twilioFrom,
      body: kind === "sms" ? message.trim() : null,
      twilio_sid: result.sid || null,
      twilio_status: result.status || null,
      session_id: sessionId || null,
      idempotency_key: idempotencyKey,
    });

    return res.status(202).json({ ok: true, sid: result.sid || null, status: result.status || null });
  } catch (error) {
    console.error(`[outreach:${kind}] failed:`, error.message);
    return res
      .status(error.status || 502)
      .json({ error: error.status === 503 ? error.message : `The ${kind === "sms" ? "text" : "call"} could not be placed.` });
  }
}

outreachRouter.post(
  "/api/outreach/sms",
  rateLimit({ bucket: "outreach", max: 5 }),
  idempotency(),
  (req, res) => handleOutbound("sms", req, res)
);

outreachRouter.post(
  "/api/outreach/call",
  rateLimit({ bucket: "outreach", max: 5 }),
  idempotency(),
  (req, res) => handleOutbound("call", req, res)
);

/* ---------------- Inbound webhooks (Twilio -> gateway) ---------------- */

function requireTwilioSignature(req, res, path) {
  const fullUrl = `${config.publicBaseUrl.replace(/\/$/, "")}${path}`;
  if (!validTwilioSignature(req, fullUrl)) {
    res.status(403).type("text/plain").send("Invalid Twilio signature");
    return false;
  }
  return true;
}

async function logInbound(kind, req) {
  try {
    await insertRow("outreach_log", {
      direction: "inbound",
      kind,
      to_number: req.body?.To || null,
      from_number: req.body?.From || null,
      body: kind === "sms" ? (req.body?.Body || "").slice(0, 2000) : null,
      twilio_sid: req.body?.MessageSid || req.body?.CallSid || null,
      twilio_status: req.body?.SmsStatus || req.body?.CallStatus || null,
    });
  } catch (error) {
    console.error(`[inbound:${kind}] logging failed:`, error.message);
  }
}

outreachRouter.post("/api/outreach/inbound/sms", async (req, res) => {
  if (!requireTwilioSignature(req, res, "/api/outreach/inbound/sms")) return;
  await logInbound("sms", req);
  res.type("text/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(
      "Thanks for texting ClawAgent. A team member will reply shortly. For a free technical visibility review, submit your site at our lead form."
    )}</Message></Response>`
  );
});

outreachRouter.post("/api/outreach/inbound/voice", async (req, res) => {
  if (!requireTwilioSignature(req, res, "/api/outreach/inbound/voice")) return;
  await logInbound("call", req);
  res.type("text/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Matthew">${escapeXml(
      "Thank you for calling ClawAgent. Please leave your name, website, and number after the tone, and a team member will call you back."
    )}</Say><Record maxLength="120" playBeep="true"/></Response>`
  );
});
