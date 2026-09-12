// Shared error type for failures talking to any external API. The point is
// to carry structured detail (which service, what status, whether retrying
// is even sane) so callers can branch on `err.code` / `err.retryable`
// instead of parsing an error message string — string-matching errors is a
// classic source of silent breakage when a vendor tweaks wording.
export class ExternalApiError extends Error {
  constructor(message, { service, status, code, retryable = false, retryAfterMs, cause } = {}) {
    super(message);
    this.name = "ExternalApiError";
    this.service = service;
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    // Set when the API told us exactly how long to wait (e.g. Discord's
    // 429 retry_after) -- lets withRetry's computeDelay honor that instead
    // of guessing a backoff. Undefined for services that don't provide this.
    this.retryAfterMs = retryAfterMs;
    if (cause) this.cause = cause;
  }
}
