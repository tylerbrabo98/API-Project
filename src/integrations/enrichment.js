import { config } from "../config/env.js";
import { createLogger } from "../lib/logger.js";
import { ExternalApiError } from "../lib/errors.js";
import { withRetry } from "../lib/retry.js";

// AbstractAPI Company Enrichment client.
//
// --- Auth flow ---
// This is the simplest possible auth model: a static API key sent as a
// query parameter (`?api_key=...`) on every request. No OAuth, no token
// exchange, no expiry, no refresh — the key issued in the AbstractAPI
// dashboard *is* the credential, forever, until manually rotated.
//
// That has a real consequence for how this client is written: there's
// nothing to verify on the response side. Unlike a webhook receiver (see
// verifyWebhookSignature in ../integrations/airtable.js), where we have to
// prove an inbound request genuinely came from Airtable via an HMAC
// signature, here we're the ones initiating the request — we trust the
// response because of TLS + hitting AbstractAPI's own domain, full stop.
// "Signature verification" as a concept doesn't apply to this integration;
// it only applies to the inbound Airtable webhook. Worth being precise
// about that distinction out loud, since the two get lumped together as
// "API security" but are solving different problems (proving a request's
// origin vs. authenticating a request you're sending).
//
// The other practical consequence: if this key leaks (a log line, an error
// message, a committed .env), it's fully compromised with no built-in
// expiry to limit the blast radius — which is why it's read only from
// config (never interpolated into a log message) below.

const ABSTRACT_API_BASE = "https://companyenrichment.abstractapi.com/v2";
const REQUEST_TIMEOUT_MS = 8000;

// Good enough for a portfolio project's input validation: rejects obvious
// garbage (empty string, "not a domain") without trying to be a fully
// RFC-compliant hostname parser.
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const logger = createLogger("enrichment");

/**
 * Look up firmographic data for a company by domain.
 *
 * Returns a normalized shape regardless of outcome — callers (routingRules)
 * never see AbstractAPI's raw response or have to know its field names:
 *   { found, companyName, industry, employeeCount, country }
 *
 * Throws ExternalApiError for anything that isn't a normal "no data found"
 * result — auth failures, exhausted quota, and non-retryable client errors
 * are real problems the caller should know about, not silently swallowed
 * into a false "not found".
 */
export async function enrichCompany(domain) {
  if (!domain || !DOMAIN_PATTERN.test(domain)) {
    // Reject before spending a request: AbstractAPI bills per request, not
    // per successful lookup ("credits are counted per request, not per
    // successful response" per their docs), so a malformed domain we can
    // catch locally is a credit spent for a guaranteed 400.
    logger.warn("Rejected invalid domain before calling AbstractAPI", { domain });
    throw new ExternalApiError(`Invalid domain format: ${domain}`, {
      service: "abstractapi",
      code: "invalid_domain",
      retryable: false,
    });
  }

  const url = new URL(ABSTRACT_API_BASE);
  url.searchParams.set("api_key", config.abstractApi.apiKey);
  url.searchParams.set("domain", domain);

  const startedAt = Date.now();

  const response = await withRetry(() => performRequest(url, domain), {
    retries: 3,
    // AbstractAPI's free plan is rate-limited to 1 request/second, so
    // anything shorter than ~1s as a starting backoff would just draw
    // another 429 immediately.
    baseDelayMs: 1000,
    shouldRetry: (err) => err instanceof ExternalApiError && err.retryable,
    onRetry: (err, attempt, delayMs) => {
      logger.warn("Retrying AbstractAPI request after transient failure", {
        domain,
        attempt: attempt + 1,
        delayMs: Math.round(delayMs),
        reason: err.code,
      });
    },
  });

  const data = await response.json();
  const durationMs = Date.now() - startedAt;

  // AbstractAPI's docs don't specify a "not found" status code — in
  // practice, a domain with no company data comes back as 200 with an
  // effectively empty body. So presence of `company_name` is the real
  // signal here, not the HTTP status.
  //
  // NOTE: AbstractAPI's marketing page shows an example response using
  // `name` / `employees_count`, but the live API actually returns
  // `company_name` / `employee_count` (singular) -- confirmed by calling
  // the real endpoint directly, since the two disagree. First version of
  // this function trusted the marketing page's field names and silently
  // treated every real result as "not found" as a result -- caught only by
  // testing against the live API with a domain (airbnb.com) known to have
  // data, not by reading docs. Worth remembering: a documented example
  // response is a claim about behavior at the time it was written, not a
  // guarantee -- verify against the live endpoint when a field silently
  // never populates instead of assuming the integration is just "working
  // as designed" with empty data.
  const found = Boolean(data && data.company_name);

  logger.info("AbstractAPI lookup complete", { domain, found, durationMs });

  if (!found) {
    return { found: false, companyName: null, industry: null, employeeCount: null, country: null };
  }

  return {
    found: true,
    companyName: data.company_name ?? null,
    industry: data.industry ?? null,
    employeeCount: typeof data.employee_count === "number" ? data.employee_count : null,
    country: data.country ?? null,
  };
}

async function performRequest(url, domain) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    // Covers both a genuine network failure and our own timeout abort
    // (fetch throws an AbortError in that case) — both are worth retrying.
    throw new ExternalApiError(`Network error calling AbstractAPI: ${err.message}`, {
      service: "abstractapi",
      code: err.name === "AbortError" ? "timeout" : "network_error",
      retryable: true,
      cause: err,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (res.ok) return res;

  const body = await res.text().catch(() => "");

  switch (res.status) {
    case 401:
      // Never retryable — a bad key won't fix itself on attempt 2.
      throw new ExternalApiError("AbstractAPI rejected the API key (401)", {
        service: "abstractapi",
        status: 401,
        code: "auth_failed",
        retryable: false,
      });
    case 400:
      throw new ExternalApiError(`AbstractAPI rejected the request (400): ${body}`, {
        service: "abstractapi",
        status: 400,
        code: "bad_request",
        retryable: false,
      });
    case 422:
      // AbstractAPI-specific meaning: this is "quota exhausted" on free
      // plans, not the generic REST "unprocessable entity" — documented
      // that way, so don't treat it as a validation error.
      logger.error("AbstractAPI quota exhausted", { domain });
      throw new ExternalApiError("AbstractAPI quota exhausted (422)", {
        service: "abstractapi",
        status: 422,
        code: "quota_exhausted",
        retryable: false,
      });
    case 429:
      throw new ExternalApiError("AbstractAPI rate limit hit (429)", {
        service: "abstractapi",
        status: 429,
        code: "rate_limited",
        retryable: true,
      });
    default:
      if (res.status >= 500) {
        throw new ExternalApiError(`AbstractAPI server error (${res.status})`, {
          service: "abstractapi",
          status: res.status,
          code: "server_error",
          retryable: true,
        });
      }
      throw new ExternalApiError(`Unexpected AbstractAPI response (${res.status}): ${body}`, {
        service: "abstractapi",
        status: res.status,
        code: "unknown_error",
        retryable: false,
      });
  }
}
