import crypto from "node:crypto";
import { config } from "../config/env.js";
import { createLogger } from "../lib/logger.js";
import { ExternalApiError } from "../lib/errors.js";
import { withRetry } from "../lib/retry.js";

// Airtable client: handles both directions of the flow —
//   (a) reading the webhook payload feed to find newly-created leads
//   (b) writing enrichment data back onto the lead record
//
// --- Auth flow ---
// Personal access token, sent as `Authorization: Bearer <token>` on every
// request. Like AbstractAPI, this is a long-lived static credential with no
// refresh cycle — but scoped: the PAT is restricted to specific scopes
// (webhook:manage, data.records:read, data.records:write) and can be
// limited to specific bases, so a leak is bounded by whatever scopes/bases
// you granted it, unlike an unscoped API key.
//
// --- Why this file also verifies signatures, unlike enrichment.js ---
// AbstractAPI has nothing to verify because we're always the caller. Here,
// Airtable calls *us* (the webhook ping to notificationUrl), so we have to
// prove that ping actually came from Airtable and not something else that
// discovered our endpoint URL. That's what verifyWebhookSignature is for —
// a fundamentally different trust problem than the outbound-only
// enrichment client.

const RECORDS_API_BASE = "https://api.airtable.com/v0";
const WEBHOOKS_API_BASE = "https://api.airtable.com/v0/bases";
const REQUEST_TIMEOUT_MS = 10000;

const logger = createLogger("airtable");

/**
 * Register a webhook subscription on this base, watching for newly created
 * records in the configured table.
 *
 * Why this is a one-off script (see scripts/setupWebhook.js) rather than
 * something the server calls at boot: registration is a one-time setup
 * step per base, and Airtable returns `macSecretBase64` exactly once, at
 * creation time — it must be saved (AIRTABLE_WEBHOOK_MAC_SECRET) to verify
 * future pings, since there's no way to retrieve it again later.
 */
export async function createWebhook() {
  const body = {
    notificationUrl: `${config.publicBaseUrl}/webhooks/airtable`,
    specification: {
      options: {
        filters: {
          dataTypes: ["tableData"],
          changeTypes: ["add"],
          recordChangeScope: config.airtable.tableId,
        },
      },
    },
  };

  const res = await airtableRequest("POST", `${WEBHOOKS_API_BASE}/${config.airtable.baseId}/webhooks`, { body });
  const data = await res.json();

  logger.info("Created Airtable webhook", {
    webhookId: data.id,
    expirationTime: data.expirationTime,
  });

  // macSecretBase64 is deliberately not logged — it's the signing secret,
  // equivalent in sensitivity to a password.
  return data;
}

/**
 * Verify that an incoming webhook ping genuinely came from Airtable.
 *
 * Scheme (HMAC-SHA256, per Airtable's docs): base64-decode the mac secret
 * saved from webhook creation, use it as the HMAC key over the raw request
 * body bytes, hex-encode the digest, and compare against the
 * `X-Airtable-Content-MAC` header value with a "hmac-sha256=" prefix.
 *
 * `rawBody` must be the exact bytes Airtable sent — not a re-serialized
 * JSON.stringify of the parsed object, which can differ in whitespace/key
 * order and would make the signature never match. See server.js, where
 * express.json's `verify` option captures this into req.rawBody before
 * parsing.
 *
 * Uses timingSafeEqual rather than `===` so a malicious caller can't use
 * response-time differences to guess the correct signature byte-by-byte.
 */
export function verifyWebhookSignature(rawBody, macHeader) {
  if (!macHeader) return false;

  const key = Buffer.from(config.airtable.webhookMacSecret, "base64");
  const expectedDigest = crypto.createHmac("sha256", key).update(rawBody).digest("hex");
  const expected = `hmac-sha256=${expectedDigest}`;

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(macHeader);

  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, so guard that first -- a length mismatch is definitely not a
  // match, and it's fine (not a timing leak risk) to short-circuit on it.
  if (expectedBuf.length !== actualBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Fetch new changes since `cursor` (null on first call), following
 * Airtable's pagination (`mightHaveMore`) until exhausted.
 *
 * Why this exists: Airtable's webhook ping carries no payload — just
 * "something changed on webhook X". This turns that ping into real data,
 * and also refreshes the webhook's 7-day expiration as a side effect
 * (calling this endpoint at all extends it, per Airtable's docs) — worth
 * knowing so a server that processes pings regularly doesn't need a
 * separate refresh job as urgently as one that goes quiet.
 *
 * Returns { payloads, nextCursor } — caller persists nextCursor (see
 * src/lib/dedupe.js) so a restart doesn't replay the whole history.
 */
export async function fetchWebhookPayloads(cursor) {
  const allPayloads = [];
  let nextCursor = cursor;
  let mightHaveMore = true;

  while (mightHaveMore) {
    const url = new URL(
      `${WEBHOOKS_API_BASE}/${config.airtable.baseId}/webhooks/${config.airtable.webhookId}/payloads`
    );
    if (nextCursor) url.searchParams.set("cursor", String(nextCursor));

    const res = await airtableRequest("GET", url);
    const data = await res.json();

    allPayloads.push(...data.payloads);
    nextCursor = data.cursor;
    mightHaveMore = data.mightHaveMore;
  }

  logger.info("Fetched Airtable webhook payloads", { count: allPayloads.length, nextCursor });

  return { payloads: allPayloads, nextCursor };
}

/**
 * Pull newly-created record IDs out of a batch of webhook payloads.
 *
 * NOTE ON CONFIDENCE: this reads `payload.changedTablesById[tableId]
 * .createdRecordsById`, which is Airtable's documented webhook payload
 * schema for record-creation events. I wasn't able to pull a fully
 * rendered example payload from their docs site to double check the exact
 * nesting before writing this — worth confirming against a real payload
 * the first time a live webhook actually fires, and adjusting this
 * function if the shape differs.
 */
export function extractCreatedRecordIds(payloads) {
  const ids = new Set();

  for (const payload of payloads) {
    const table = payload.changedTablesById?.[config.airtable.tableId];
    const created = table?.createdRecordsById;
    if (created) {
      for (const recordId of Object.keys(created)) ids.add(recordId);
    }
  }

  return [...ids];
}

/**
 * Fetch full field data for a single lead record by ID.
 *
 * Why this is always called, rather than trusting cell values embedded in
 * the webhook payload: keeps this function as the one place that knows the
 * lead record's field shape, regardless of what the payload does or
 * doesn't include -- simpler to reason about than two divergent code paths
 * for "fields from the payload" vs "fields from a direct fetch".
 */
export async function getLeadRecord(recordId) {
  const url = `${RECORDS_API_BASE}/${config.airtable.baseId}/${encodeURIComponent(config.airtable.tableName)}/${recordId}`;
  const res = await airtableRequest("GET", url);
  return res.json();
}

/**
 * Fetch the most recent leads for the dashboard, newest first.
 *
 * Airtable's list-records endpoint doesn't support sorting by internal
 * creation metadata through a query param -- but every record it returns
 * always carries a top-level `createdTime`, regardless of table fields, so
 * sorting client-side after the fetch is simpler than fighting the API for
 * server-side sort on something that isn't a real field.
 */
export async function listRecentLeads(limit = 20) {
  const url = new URL(`${RECORDS_API_BASE}/${config.airtable.baseId}/${encodeURIComponent(config.airtable.tableName)}`);
  url.searchParams.set("maxRecords", "100");

  const res = await airtableRequest("GET", url);
  const data = await res.json();

  return data.records
    .slice()
    .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime))
    .slice(0, limit);
}

/**
 * PATCH the lead record with enrichment results and the suggested next
 * action. Only sets the fields that have data -- when enrichment found
 * nothing, industry/company size are left alone rather than overwritten
 * with nulls, while Enrichment Source/Enriched At are always stamped so
 * it's visible in Airtable that the lead *was* processed, just came up empty.
 *
 * These fields must already exist on the table -- Airtable's API returns a
 * 422 for an unrecognized field name rather than silently creating one.
 */
export async function writeEnrichmentToLead(recordId, enrichment, suggestedNextAction) {
  const fields = {
    "Enrichment Source": enrichment.found ? "AbstractAPI" : "none",
    "Enriched At": new Date().toISOString(),
    "Suggested Next Action": suggestedNextAction,
  };
  if (enrichment.found) {
    fields["Industry"] = enrichment.industry;
    fields["Company Size"] = enrichment.employeeCount;
  }

  const url = `${RECORDS_API_BASE}/${config.airtable.baseId}/${encodeURIComponent(config.airtable.tableName)}/${recordId}`;
  const res = await airtableRequest("PATCH", url, { body: { fields } });
  return res.json();
}

/**
 * Extend the webhook's 7-day expiration. Run on a schedule (see
 * src/jobs/refreshWebhook.js) -- without it, a quiet base (no leads coming
 * in) will let the webhook expire and the pipeline goes silently dark.
 */
export async function refreshWebhook() {
  const url = `${WEBHOOKS_API_BASE}/${config.airtable.baseId}/webhooks/${config.airtable.webhookId}/refresh`;
  const res = await airtableRequest("POST", url);
  const data = await res.json();
  logger.info("Refreshed Airtable webhook", { expirationTime: data.expirationTime });
  return data;
}

// --- shared request plumbing ---
//
// One retry/timeout/error-mapping helper for every Airtable call, mirroring
// the pattern in integrations/enrichment.js -- kept separate rather than
// factored into a fully shared module because the two APIs' status code
// meanings genuinely differ (see the 422 comment below) and forcing them
// through one generic client would hide that rather than surface it.
async function airtableRequest(method, url, { body } = {}) {
  return withRetry(() => performRequest(method, url, body), {
    retries: 3,
    baseDelayMs: 500,
    shouldRetry: (err) => err instanceof ExternalApiError && err.retryable,
    onRetry: (err, attempt, delayMs) => {
      logger.warn("Retrying Airtable request after transient failure", {
        method,
        url: String(url),
        attempt: attempt + 1,
        delayMs: Math.round(delayMs),
        reason: err.code,
      });
    },
  });
}

async function performRequest(method, url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.airtable.pat}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new ExternalApiError(`Network error calling Airtable: ${err.message}`, {
      service: "airtable",
      code: err.name === "AbortError" ? "timeout" : "network_error",
      retryable: true,
      cause: err,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (res.ok) return res;

  const responseBody = await res.text().catch(() => "");

  switch (res.status) {
    case 401:
      throw new ExternalApiError("Airtable rejected the personal access token (401)", {
        service: "airtable",
        status: 401,
        code: "auth_failed",
        retryable: false,
      });
    case 403:
      throw new ExternalApiError("Airtable PAT lacks a required scope/base access (403)", {
        service: "airtable",
        status: 403,
        code: "forbidden",
        retryable: false,
      });
    case 404:
      throw new ExternalApiError(`Airtable resource not found (404): ${method} ${url}`, {
        service: "airtable",
        status: 404,
        code: "not_found",
        retryable: false,
      });
    case 422:
      // Standard REST meaning here, unlike AbstractAPI's 422 -- typically
      // an unrecognized field name (e.g. a writeback field not yet created
      // on the table) or a malformed webhook specification.
      throw new ExternalApiError(`Airtable rejected the request as unprocessable (422): ${responseBody}`, {
        service: "airtable",
        status: 422,
        code: "unprocessable",
        retryable: false,
      });
    case 429:
      throw new ExternalApiError("Airtable rate limit hit (429)", {
        service: "airtable",
        status: 429,
        code: "rate_limited",
        retryable: true,
      });
    default:
      if (res.status >= 500) {
        throw new ExternalApiError(`Airtable server error (${res.status})`, {
          service: "airtable",
          status: res.status,
          code: "server_error",
          retryable: true,
        });
      }
      throw new ExternalApiError(`Unexpected Airtable response (${res.status}): ${responseBody}`, {
        service: "airtable",
        status: res.status,
        code: "unknown_error",
        retryable: false,
      });
  }
}
