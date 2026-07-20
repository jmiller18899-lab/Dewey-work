/**
 * Integration tests for the mountable ClawAgent router.
 *
 * These run with no external service configuration (no Supabase / OpenRouter /
 * xAI / Twilio / ntfy env vars), which is exactly the "missing keys degrade
 * gracefully" contract from the README. So the assertions cover:
 *   - /health liveness and capability reporting
 *   - request validation (400s) on every write route
 *   - graceful 503s when a capability's keys are absent
 *   - the JSON error handler (malformed body) and 404 for unknown routes
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, request, VALID_SESSION_ID } from "./helpers.js";

let server;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server?.close();
});

/* ------------------------------ /health ------------------------------ */

test("GET /health reports liveness and per-capability status", async () => {
  const { status, body } = await request(server.url, "/health", { ip: "10.9.0.1" });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, "clawagent-gateway");
  assert.ok(typeof body.time === "string" && !Number.isNaN(Date.parse(body.time)));
  // With no env keys set, every capability reports false.
  assert.deepEqual(body.capabilities, {
    chat: false,
    voice_realtime: false,
    telephony: false,
    persistence: false,
    alerts: false,
  });
});

/* ------------------------------ /api/leads ------------------------------ */

test("POST /api/leads rejects an invalid name", async () => {
  const { status, body } = await request(server.url, "/api/leads", {
    method: "POST",
    ip: "10.1.0.1",
    body: { name: "A", email: "dev@example.com", url: "https://example.com" },
  });
  assert.equal(status, 400);
  assert.match(body.error, /name/i);
});

test("POST /api/leads rejects an invalid email", async () => {
  const { status, body } = await request(server.url, "/api/leads", {
    method: "POST",
    ip: "10.1.0.2",
    body: { name: "Ada Lovelace", email: "not-an-email", url: "https://example.com" },
  });
  assert.equal(status, 400);
  assert.match(body.error, /email/i);
});

test("POST /api/leads rejects a private/SSRF URL", async () => {
  const { status, body } = await request(server.url, "/api/leads", {
    method: "POST",
    ip: "10.1.0.3",
    body: { name: "Ada Lovelace", email: "dev@example.com", url: "http://169.254.169.254" },
  });
  assert.equal(status, 400);
  assert.match(body.error, /url/i);
});

test("POST /api/leads with a valid body but no Supabase returns a graceful 502", async () => {
  const { status, body } = await request(server.url, "/api/leads", {
    method: "POST",
    ip: "10.1.0.4",
    body: { name: "Ada Lovelace", email: "dev@example.com", url: "https://example.com" },
  });
  // Validation passes; persistence is unconfigured, so the route surfaces a
  // clean 502 (no stack trace) rather than crashing.
  assert.equal(status, 502);
  assert.ok(typeof body.error === "string" && body.error.length > 0);
});

/* --------------------------- /api/sales/chat --------------------------- */

test("POST /api/sales/chat rejects an invalid session_id", async () => {
  const { status, body } = await request(server.url, "/api/sales/chat", {
    method: "POST",
    ip: "10.2.0.1",
    body: { session_id: "bad", messages: [{ role: "user", content: "hi" }] },
  });
  assert.equal(status, 400);
  assert.match(body.error, /session_id/i);
});

test("POST /api/sales/chat rejects invalid message history", async () => {
  const { status, body } = await request(server.url, "/api/sales/chat", {
    method: "POST",
    ip: "10.2.0.2",
    body: { session_id: VALID_SESSION_ID, messages: [] },
  });
  assert.equal(status, 400);
  assert.match(body.error, /message/i);
});

test("POST /api/sales/chat returns 503 when OpenRouter is unconfigured", async () => {
  const { status, body } = await request(server.url, "/api/sales/chat", {
    method: "POST",
    ip: "10.2.0.3",
    body: { session_id: VALID_SESSION_ID, messages: [{ role: "user", content: "hi" }] },
  });
  assert.equal(status, 503);
  assert.match(body.error, /OPENROUTER_API_KEY/);
});

/* ---------------------- /api/sales/voice/session ---------------------- */

test("POST /api/sales/voice/session rejects an invalid session_id", async () => {
  const { status } = await request(server.url, "/api/sales/voice/session", {
    method: "POST",
    ip: "10.3.0.1",
    body: { session_id: "bad" },
  });
  assert.equal(status, 400);
});

test("POST /api/sales/voice/session returns {} (browser fallback) with no XAI key", async () => {
  const { status, body } = await request(server.url, "/api/sales/voice/session", {
    method: "POST",
    ip: "10.3.0.2",
    body: { session_id: VALID_SESSION_ID },
  });
  assert.equal(status, 200);
  assert.deepEqual(body, {});
});

/* ------------------------ /api/sales/transcripts ----------------------- */

test("POST /api/sales/transcripts rejects an invalid transcript payload", async () => {
  const { status, body } = await request(server.url, "/api/sales/transcripts", {
    method: "POST",
    ip: "10.4.0.1",
    body: { session_id: VALID_SESSION_ID, transcript: "nope" },
  });
  assert.equal(status, 400);
  assert.match(body.error, /transcript/i);
});

/* --------------------------- /api/outreach ---------------------------- */

test("POST /api/outreach/sms rejects a non-E.164 number", async () => {
  const { status, body } = await request(server.url, "/api/outreach/sms", {
    method: "POST",
    ip: "10.5.0.1",
    body: { to: "5551234567", message: "hi" },
  });
  assert.equal(status, 400);
  assert.match(body.error, /E\.164/);
});

test("POST /api/outreach/sms rejects an empty message", async () => {
  const { status, body } = await request(server.url, "/api/outreach/sms", {
    method: "POST",
    ip: "10.5.0.2",
    body: { to: "+15551234567", message: "   " },
  });
  assert.equal(status, 400);
  assert.match(body.error, /message/i);
});

test("POST /api/outreach/sms returns 503 when Twilio is unconfigured", async () => {
  const { status, body } = await request(server.url, "/api/outreach/sms", {
    method: "POST",
    ip: "10.5.0.3",
    body: { to: "+15551234567", message: "hi" },
  });
  assert.equal(status, 503);
  assert.match(body.error, /TWILIO/);
});

test("POST /api/outreach/inbound/sms rejects a request with no valid Twilio signature", async () => {
  const { status, body } = await request(server.url, "/api/outreach/inbound/sms", {
    method: "POST",
    ip: "10.5.0.4",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "From=%2B15551234567&Body=hello",
  });
  assert.equal(status, 403);
  assert.match(String(body), /Invalid Twilio signature/);
});

/* ------------------------------ /api/admin ----------------------------- */

test("POST /api/admin/audits/:id/review returns 503 when OPERATOR_TOKEN is unset", async () => {
  const { status, body } = await request(server.url, "/api/admin/audits/abc/review", {
    method: "POST",
    ip: "10.6.0.1",
    body: { decision: "approved" },
  });
  assert.equal(status, 503);
  assert.match(body.error, /OPERATOR_TOKEN/);
});

/* ------------------- error handling & unknown routes ------------------- */

test("malformed JSON body yields a clean 400 from the error handler", async () => {
  const { status, body } = await request(server.url, "/api/leads", {
    method: "POST",
    ip: "10.7.0.1",
    headers: { "Content-Type": "application/json" },
    body: "{ not valid json",
  });
  assert.equal(status, 400);
  assert.match(body.error, /Malformed JSON/);
});

test("unknown route returns 404", async () => {
  const { status } = await request(server.url, "/api/does-not-exist", {
    method: "GET",
    ip: "10.7.0.2",
  });
  assert.equal(status, 404);
});

/* ----------------------------- rate limiting --------------------------- */

test("POST /api/leads enforces the per-IP rate limit (5/min)", async () => {
  const ip = "10.8.0.1";
  const payload = { name: "Ada Lovelace", email: "dev@example.com", url: "https://example.com" };
  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    const { status } = await request(server.url, "/api/leads", { method: "POST", ip, body: payload });
    statuses.push(status);
  }
  // First 5 pass the limiter (then 502 on unconfigured persistence); the 6th is throttled.
  assert.equal(statuses[5], 429);
  assert.ok(statuses.slice(0, 5).every((s) => s !== 429));
});
