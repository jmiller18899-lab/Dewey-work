/**
 * ntfy alerting with the publish-then-readback "Attestor" pattern.
 *
 * publish() POSTs the alert, captures the server-assigned message id, then
 * reads the topic back (poll API) and confirms the id actually landed. The
 * attestation result — not our own claim — is what gets recorded next to the
 * business row in Supabase, so "alert emitted" is third-party verifiable.
 */
import { config } from "./config.js";
import { insertRows } from "./supabase.js";

export async function publishAlert({ title, message, tags = [], context = {} }) {
  const result = {
    configured: Boolean(config.ntfyTopic),
    published: false,
    attested: false,
    message_id: null,
    error: null,
  };

  if (!config.ntfyTopic) {
    result.error = "NTFY_TOPIC not configured";
    await recordAttestation(result, title, context);
    return result;
  }

  const topicUrl = `${config.ntfyServer.replace(/\/$/, "")}/${encodeURIComponent(config.ntfyTopic)}`;

  try {
    const response = await fetch(topicUrl, {
      method: "POST",
      headers: {
        Title: sanitizeHeader(title),
        Tags: tags.join(","),
        "Content-Type": "text/plain",
      },
      body: message,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`ntfy publish returned ${response.status}`);
    const body = await response.json();
    result.published = true;
    result.message_id = body.id || null;

    // Readback: poll the topic and confirm our message id is present.
    if (result.message_id) {
      const readback = await fetch(`${topicUrl}/json?poll=1&since=2m`, {
        signal: AbortSignal.timeout(8000),
      });
      if (readback.ok) {
        const text = await readback.text();
        result.attested = text
          .split("\n")
          .filter(Boolean)
          .some((line) => {
            try {
              return JSON.parse(line).id === result.message_id;
            } catch {
              return false;
            }
          });
      }
    }
  } catch (error) {
    result.error = error.message;
  }

  await recordAttestation(result, title, context);
  return result;
}

function sanitizeHeader(value) {
  return String(value || "").replace(/[\r\n]/g, " ").slice(0, 250);
}

async function recordAttestation(result, title, context) {
  try {
    await insertRows("alert_log", [{
      title: String(title || "").slice(0, 250),
      topic: config.ntfyTopic || null,
      message_id: result.message_id,
      published: result.published,
      attested: result.attested,
      error: result.error,
      context,
    }]);
  } catch (error) {
    // Attestation logging must never break the business request.
    console.error("[ntfy] failed to record attestation:", error.message);
  }
}
