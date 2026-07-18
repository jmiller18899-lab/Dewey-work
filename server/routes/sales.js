/**
 * Sales associate routes:
 *   POST /api/sales/chat            — streamed LLM reply via OpenRouter; turns persisted to sales_messages
 *   POST /api/sales/voice/session   — mint a Grok Voice realtime session (or {} => browser fallback)
 *   POST /api/sales/transcripts     — persist completed call transcript + ntfy attestation
 */
import { Router } from "express";
import { config } from "../lib/config.js";
import {
  badRequest,
  validMessages,
  validSessionId,
  validTranscript,
} from "../lib/validate.js";
import { insertRow, insertRows } from "../lib/supabase.js";
import { streamSalesReply } from "../lib/openrouter.js";
import { publishAlert } from "../lib/ntfy.js";
import { rateLimit } from "../lib/ratelimit.js";
import { idempotency } from "../lib/idempotency.js";

export const salesRouter = Router();

salesRouter.post(
  "/api/sales/chat",
  rateLimit({ bucket: "chat", max: 20 }),
  async (req, res) => {
    const { session_id: sessionId, messages } = req.body || {};
    if (!validSessionId(sessionId)) return badRequest(res, "Invalid session_id.");
    if (!validMessages(messages)) return badRequest(res, "Invalid message history.");

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return badRequest(res, "The history must contain a user message.");

    if (!config.openrouterApiKey) {
      return res.status(503).json({ error: "Chat is not configured (OPENROUTER_API_KEY missing)." });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    let fullText = "";
    try {
      fullText = await streamSalesReply(messages, (delta) => {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      });
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      console.error("[chat] stream failed:", error.message);
      if (!res.headersSent || fullText === "") {
        // Nothing (or headers only) sent — emit an SSE error the client surfaces.
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      }
      res.end();
      return;
    }

    // Persist the exchanged turn (user + assistant) keyed by session_id.
    try {
      await insertRows("sales_messages", [
        { session_id: sessionId, role: "user", content: lastUser.content },
        { session_id: sessionId, role: "assistant", content: fullText },
      ]);
    } catch (error) {
      console.error("[chat] persistence failed:", error.message);
    }
  }
);

salesRouter.post(
  "/api/sales/voice/session",
  rateLimit({ bucket: "voice", max: 10 }),
  async (req, res) => {
    const { session_id: sessionId } = req.body || {};
    if (!validSessionId(sessionId)) return badRequest(res, "Invalid session_id.");

    // No key => empty object; the frontend falls back to browser speech + text chat.
    if (!config.xaiApiKey) return res.json({});

    try {
      // Mint an ephemeral realtime session so the browser never sees XAI_API_KEY.
      const response = await fetch(config.xaiSessionUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.xaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: config.xaiVoiceModel }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`xAI session mint returned ${response.status}`);
      const session = await response.json();
      const token =
        session.client_secret?.value || session.client_secret || session.token || null;
      if (!token) throw new Error("xAI session response carried no ephemeral token");

      return res.json({
        websocket_url:
          session.websocket_url ||
          session.url ||
          `${config.xaiRealtimeUrl}?model=${encodeURIComponent(config.xaiVoiceModel)}`,
        token,
      });
    } catch (error) {
      console.error("[voice] realtime session unavailable:", error.message);
      return res.json({}); // graceful fallback — never a hard failure for the caller
    }
  }
);

salesRouter.post(
  "/api/sales/transcripts",
  rateLimit({ bucket: "transcripts", max: 10 }),
  idempotency(),
  async (req, res) => {
    const { session_id: sessionId, transcript, channel, completed_at: completedAt } =
      req.body || {};
    if (!validSessionId(sessionId)) return badRequest(res, "Invalid session_id.");
    if (!validTranscript(transcript)) return badRequest(res, "Invalid transcript payload.");
    const cleanChannel = channel === "voice" || channel === "text" ? channel : "voice";

    try {
      const row = await insertRow("sales_transcripts", {
        session_id: sessionId,
        channel: cleanChannel,
        transcript,
        turn_count: transcript.length,
        completed_at: typeof completedAt === "string" ? completedAt : new Date().toISOString(),
      });

      const alert = await publishAlert({
        title: "ClawAgent call completed",
        message: `Session ${sessionId}\nChannel: ${cleanChannel}\nTurns: ${transcript.length}\nTranscript row: ${row.id}`,
        tags: ["telephone_receiver", "white_check_mark"],
        context: { kind: "call_completed", session_id: sessionId, transcript_id: row.id },
      });

      return res.status(201).json({
        ok: true,
        transcript_id: row.id,
        alert: { published: alert.published, attested: alert.attested, message_id: alert.message_id },
      });
    } catch (error) {
      console.error("[transcripts] persistence failed:", error.message);
      return res.status(502).json({ error: "The transcript could not be persisted." });
    }
  }
);
