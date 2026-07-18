/**
 * Twilio REST integration via raw fetch (no SDK dependency) plus inbound
 * webhook signature validation (HMAC-SHA1 per Twilio's spec).
 */
import crypto from "node:crypto";
import { config } from "./config.js";

function assertConfigured() {
  if (!config.twilioSid || !config.twilioAuth || !config.twilioFrom) {
    throw Object.assign(
      new Error("Telephony is not configured (TWILIO_SID / TWILIO_AUTH / TWILIO_FROM)."),
      { status: 503 }
    );
  }
}

function authHeader() {
  return "Basic " + Buffer.from(`${config.twilioSid}:${config.twilioAuth}`).toString("base64");
}

async function twilioPost(resource, params) {
  assertConfigured();
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/${resource}.json`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(body.message || `Twilio request failed (${response.status})`),
      { status: 502 }
    );
  }
  return body;
}

export function sendSms(to, message) {
  return twilioPost("Messages", { To: to, From: config.twilioFrom, Body: message });
}

/** Outbound call that reads a short ClawAgent intro, then records nothing further. */
export function startCall(to, sayText) {
  const twiml =
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Matthew">` +
    escapeXml(sayText) +
    `</Say><Pause length="1"/><Say voice="Polly.Matthew">Goodbye.</Say></Response>`;
  return twilioPost("Calls", { To: to, From: config.twilioFrom, Twiml: twiml });
}

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Validate X-Twilio-Signature on inbound webhooks.
 * Signature = base64(HMAC-SHA1(auth_token, full_url + sorted concatenated POST params)).
 */
export function validTwilioSignature(req, fullUrl) {
  if (!config.twilioAuth) return false;
  const signature = req.get("X-Twilio-Signature");
  if (!signature) return false;

  const params = req.body && typeof req.body === "object" ? req.body : {};
  const data =
    fullUrl +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");

  const expected = crypto
    .createHmac("sha1", config.twilioAuth)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
