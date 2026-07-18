/**
 * Idempotency-key replay protection for mutating endpoints.
 *
 * In-memory first line of defense (fast replay of the original response within
 * the TTL). Endpoints with real-world side effects (Twilio sends) additionally
 * persist the key in Supabase with a unique constraint, so protection survives
 * process restarts.
 */
const seen = new Map(); // key -> { status, body, expires } | { pending: true, expires }
const TTL_MS = 15 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of seen) {
    if (entry.expires <= now) seen.delete(key);
  }
}, 60_000).unref();

export function idempotency() {
  return (req, res, next) => {
    const key = req.get("X-Idempotency-Key");
    if (!key || key.length > 200) return next(); // header optional; absence = no protection

    const entry = seen.get(key);
    if (entry) {
      if (entry.pending) {
        return res.status(409).json({ error: "A request with this idempotency key is already in flight." });
      }
      res.setHeader("X-Idempotent-Replay", "true");
      return res.status(entry.status).json(entry.body);
    }

    seen.set(key, { pending: true, expires: Date.now() + TTL_MS });

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      // Only cache JSON terminal responses; streaming endpoints bypass res.json.
      seen.set(key, { status: res.statusCode, body, expires: Date.now() + TTL_MS });
      return originalJson(body);
    };
    res.on("close", () => {
      const current = seen.get(key);
      if (current?.pending) seen.delete(key); // request died before completing — allow retry
    });
    next();
  };
}
