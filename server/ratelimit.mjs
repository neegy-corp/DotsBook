// Tiny in-memory rate limiter. Fine for a single-process Node server; resets on restart.
export function makeLimiter({ max, windowMs }) {
  const hits = new Map(); // key -> array of timestamps
  return function check(key) {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      const retryAfterMs = windowMs - (now - arr[0]);
      return { allowed: false, retryAfterMs };
    }
    arr.push(now);
    hits.set(key, arr);
    return { allowed: true };
  };
}
