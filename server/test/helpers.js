/**
 * Shared test helpers.
 *
 * Spins the mountable router up on an ephemeral port exactly the way the
 * production entrypoint does (`app.use(createClawagentRouter())`), so the
 * integration tests exercise the same wiring — CORS, body parsing, sub-routers,
 * and the JSON error handler — that ships.
 */
import express from "express";
import { createClawagentRouter } from "../router.js";

/**
 * Start an isolated gateway instance on a random free port.
 * Returns `{ url, close }` where `url` has no trailing slash.
 */
export async function startTestServer() {
  const app = express();
  app.disable("x-powered-by");
  app.use(createClawagentRouter());

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

/**
 * Thin fetch wrapper that returns `{ status, headers, body }` with `body`
 * parsed as JSON when possible, otherwise the raw text.
 *
 * `ip` sets X-Forwarded-For so each test can occupy its own rate-limit bucket
 * — the limiter keys on that header, so distinct IPs never bleed into one
 * another across tests.
 */
export async function request(baseUrl, path, { method = "GET", body, headers = {}, ip } = {}) {
  const finalHeaders = { ...headers };
  if (ip) finalHeaders["X-Forwarded-For"] = ip;

  let payload;
  if (body !== undefined) {
    if (typeof body === "string") {
      payload = body;
      finalHeaders["Content-Type"] ??= "application/json";
    } else {
      payload = JSON.stringify(body);
      finalHeaders["Content-Type"] ??= "application/json";
    }
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: finalHeaders,
    body: payload,
  });

  const text = await response.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : "";
  } catch {
    /* leave as raw text (e.g. TwiML/XML) */
  }

  return { status: response.status, headers: response.headers, body: parsed };
}

/** A structurally valid session id (passes validSessionId). */
export const VALID_SESSION_ID = "sess_test_00000001";
