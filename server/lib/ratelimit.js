/**
 * Minimal in-memory sliding-window rate limiter (per IP + bucket).
 * Single-instance scope is fine for this gateway; swap for a shared store if
 * the service is ever scaled horizontally.
 */
const windows = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows) {
    if (entry.reset <= now) windows.delete(key);
  }
}, 60_000).unref();

export function rateLimit({ bucket, max, windowMs = 60_000 }) {
  return (req, res, next) => {
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "unknown";
    const key = `${bucket}:${ip}`;
    const now = Date.now();
    let entry = windows.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      windows.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }
    next();
  };
}
