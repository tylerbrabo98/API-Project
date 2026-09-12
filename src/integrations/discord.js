import { createLogger } from "../lib/logger.js";
import { ExternalApiError } from "../lib/errors.js";
import { withRetry } from "../lib/retry.js";

// Discord alert client. Deliberately simple: a fixed map of Incoming
// Webhook URLs, one per routing bucket (see src/services/routingRules.js
// for how a lead gets assigned to a bucket).
//
// --- Auth flow ---
// Incoming Webhooks have no separate auth step at all: the URL itself
// (https://discord.com/api/webhooks/{id}/{token}) *is* the credential --
// the token is embedded directly in the path. Whoever has the URL can post
// to that channel, full stop. Confirmed against Discord's docs: no request
// signing scheme exists for outgoing webhook calls, same trust model as
// AbstractAPI's query-param key (we're always the caller, so there's
// nothing to cryptographically verify on the way out -- trust is TLS plus
// treating the URL as a secret). That's why it's handled the same way:
// env var only, and this module never logs the URL itself, only the
// routing bucket it corresponds to.
//
// Contrast this with the *inbound* side of this pipeline (Airtable's
// webhook ping to us), which does need signature verification -- because
// there, Discord/Airtable is the one initiating contact with us, and we
// have to prove it's genuinely them. Two different directions, two
// different trust problems.
//
// Tradeoff, stated explicitly: this only supports a fixed, small set of
// channels known ahead of time. A real bot (Developer Portal app + bot
// token, POST /channels/{id}/messages) would allow posting to arbitrary
// channels chosen at runtime -- the natural next step if this needed to
// scale past a handful of sales teams.

const REQUEST_TIMEOUT_MS = 8000;
const CONTENT_MAX_LENGTH = 2000; // Discord's documented limit on the `content` field

const logger = createLogger("discord");

/**
 * POST a formatted lead alert to the given Discord Incoming Webhook.
 *
 * `lead` is the raw Airtable record (see integrations/airtable.js#getLeadRecord),
 * `enrichment` is the normalized shape from integrations/enrichment.js,
 * `suggestedNextAction` comes from services/routingRules.js.
 */
export async function postLeadAlert(webhookUrl, lead, enrichment, suggestedNextAction) {
  const leadName = lead.fields?.Name ?? lead.fields?.Email ?? lead.id ?? "Unknown lead";
  const companyName = enrichment.companyName ?? "Unknown company";

  const payload = {
    content: truncate(
      `New lead: ${leadName}${enrichment.found ? ` (${companyName})` : ""}`,
      CONTENT_MAX_LENGTH
    ),
    embeds: [
      {
        title: leadName,
        fields: [
          { name: "Company", value: companyName, inline: true },
          { name: "Industry", value: enrichment.industry ?? "Unknown", inline: true },
          {
            name: "Employees",
            value: enrichment.employeeCount != null ? String(enrichment.employeeCount) : "Unknown",
            inline: true,
          },
          { name: "Suggested next action", value: suggestedNextAction },
        ],
      },
    ],
  };

  await withRetry(() => performRequest(webhookUrl, payload), {
    retries: 3,
    baseDelayMs: 1000,
    shouldRetry: (err) => err instanceof ExternalApiError && err.retryable,
    // Prefer Discord's own retry_after (from the 429 body) over a guessed
    // backoff -- see lib/retry.js for why.
    computeDelay: (err, attempt, baseDelayMs) =>
      err.retryAfterMs ?? baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs,
    onRetry: (err, attempt, delayMs) => {
      logger.warn("Retrying Discord alert after transient failure", {
        attempt: attempt + 1,
        delayMs: Math.round(delayMs),
        reason: err.code,
      });
    },
  });

  logger.info("Posted lead alert to Discord", { leadName, found: enrichment.found });
}

async function performRequest(webhookUrl, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ExternalApiError(`Network error calling Discord: ${err.message}`, {
      service: "discord",
      code: err.name === "AbortError" ? "timeout" : "network_error",
      retryable: true,
      cause: err,
    });
  } finally {
    clearTimeout(timeout);
  }

  // Discord returns 204 No Content by default (wait=false, which we don't
  // override) -- res.ok covers that with nothing to parse, so there's no
  // response body handling needed on the success path at all.
  if (res.ok) return res;

  const responseBody = await res.text().catch(() => "");

  switch (res.status) {
    case 400:
      throw new ExternalApiError(`Discord rejected the message payload (400): ${responseBody}`, {
        service: "discord",
        status: 400,
        code: "bad_request",
        retryable: false,
      });
    case 401:
    case 404:
      // Both mean the webhook URL itself is invalid or was deleted in
      // Discord's UI -- not something a retry fixes.
      throw new ExternalApiError(`Discord webhook URL is invalid or deleted (${res.status})`, {
        service: "discord",
        status: res.status,
        code: "invalid_webhook",
        retryable: false,
      });
    case 429: {
      throw new ExternalApiError("Discord rate limit hit (429)", {
        service: "discord",
        status: 429,
        code: "rate_limited",
        retryable: true,
        retryAfterMs: parseRetryAfterSeconds(responseBody, res.headers.get("retry-after")) * 1000,
      });
    }
    default:
      if (res.status >= 500) {
        throw new ExternalApiError(`Discord server error (${res.status})`, {
          service: "discord",
          status: res.status,
          code: "server_error",
          retryable: true,
        });
      }
      throw new ExternalApiError(`Unexpected Discord response (${res.status}): ${responseBody}`, {
        service: "discord",
        status: res.status,
        code: "unknown_error",
        retryable: false,
      });
  }
}

function parseRetryAfterSeconds(responseBody, headerValue) {
  // Discord's docs specify the JSON body's `retry_after` as the source of
  // truth (a float, in seconds); fall back to the Retry-After header if the
  // body wasn't parseable JSON for some reason. Both are in seconds.
  try {
    const parsed = JSON.parse(responseBody);
    if (typeof parsed.retry_after === "number") return parsed.retry_after;
  } catch {
    // fall through to header
  }
  const headerSeconds = Number(headerValue);
  return Number.isFinite(headerSeconds) ? headerSeconds : 1;
}

function truncate(str, maxLength) {
  return str.length > maxLength ? `${str.slice(0, maxLength - 1)}…` : str;
}
