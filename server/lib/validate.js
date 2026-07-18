/** Server-side input validation. Every write endpoint validates before touching storage. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const E164_RE = /^\+[1-9]\d{7,14}$/;

export function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && EMAIL_RE.test(value);
}

export function validHttpUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname;
  if (!host || !host.includes(".")) return false;
  // Reject obvious SSRF targets — audits fetch these URLs later.
  if (
    host === "localhost" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return false;
  }
  return true;
}

export function validName(value) {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 120;
}

export function validE164(value) {
  return typeof value === "string" && E164_RE.test(value);
}

export function validSessionId(value) {
  return typeof value === "string" && value.length >= 8 && value.length <= 128 &&
    /^[A-Za-z0-9._-]+$/.test(value);
}

/** Chat history: array of {role, content} with sane bounds. */
export function validMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) return false;
  return value.every(
    (message) =>
      message &&
      typeof message === "object" &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.length > 0 &&
      message.content.length <= 8000
  );
}

/** Voice transcript entries: [{role, content, at?}]. Empty array allowed (call with no speech). */
export function validTranscript(value) {
  if (!Array.isArray(value) || value.length > 2000) return false;
  return value.every(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      (entry.role === "user" || entry.role === "assistant") &&
      typeof entry.content === "string" &&
      entry.content.length <= 8000 &&
      (entry.at === undefined || typeof entry.at === "string")
  );
}

export function badRequest(res, error) {
  return res.status(400).json({ error });
}
