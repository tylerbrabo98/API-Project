// Generic retry-with-backoff for transient external API failures (429,
// 5xx, network/timeout). This only owns the retry loop and backoff timing —
// the caller decides what's retryable at all via `shouldRetry`, so a
// permanent failure (bad auth, malformed request) never gets retried just
// because it happened to come from the same fetch call.
//
// Exponential backoff + jitter is the default: doubling the delay each
// attempt avoids hammering a struggling service, and the random jitter
// avoids every concurrent caller retrying in lockstep (irrelevant at this
// project's scale, but it's the correct default and costs nothing to
// include).
//
// `computeDelay` lets a caller override that default when the API itself
// tells you how long to wait -- e.g. Discord's 429 response includes a
// `retry_after` seconds value. Respecting that directly is more correct
// than guessing a backoff, and friendlier to the service than retrying
// sooner than it asked.
export async function withRetry(fn, { retries = 3, baseDelayMs = 500, shouldRetry, onRetry, computeDelay } = {}) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      const canRetry = attempt < retries && Boolean(shouldRetry?.(err));
      if (!canRetry) throw err;

      const delayMs = computeDelay
        ? computeDelay(err, attempt, baseDelayMs)
        : baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs;

      onRetry?.(err, attempt, delayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt += 1;
    }
  }
}
