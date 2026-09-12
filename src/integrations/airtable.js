import { config } from "../config/env.js";

// Airtable client: handles both directions of the flow —
//   (a) reading the webhook payload feed to find newly-created leads
//   (b) writing enrichment data back onto the lead record
//
// Auth: personal access token as a Bearer header (see .env.example for the
// exact scopes needed: data.records:read/write + webhook:manage).

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

/**
 * TODO: Register a webhook subscription on this base, watching for new
 * records in config.airtable.tableName.
 *
 * Why a one-off script instead of doing this at server boot: webhook
 * registration is a one-time setup step per base (not something you want
 * re-running on every deploy), and Airtable returns a MAC secret at
 * creation time that must be saved (AIRTABLE_WEBHOOK_MAC_SECRET) to verify
 * future notification payloads. See scripts/setupWebhook.js for where this
 * actually gets called.
 *
 * Endpoint: POST /bases/{baseId}/webhooks
 */
export async function createWebhook() {
  throw new Error("TODO: implement createWebhook — see comment above");
}

/**
 * TODO: Fetch the actual changes since our last cursor.
 *
 * Why this exists: Airtable's webhook ping to our server carries no payload
 * — just "something changed on webhook X". This function is what turns that
 * ping into real data: it calls the payloads endpoint, returns the new
 * records plus the next cursor to persist (see src/lib/dedupe.js).
 *
 * Endpoint: GET /bases/{baseId}/webhooks/{webhookId}/payloads?cursor={cursor}
 * Note: response is paginated (mightHaveMore) — loop until it's false.
 */
export async function fetchWebhookPayloads(cursor) {
  throw new Error("TODO: implement fetchWebhookPayloads — see comment above");
}

/**
 * TODO: Verify the X-Airtable-Content-MAC header on incoming webhook pings
 * using AIRTABLE_WEBHOOK_MAC_SECRET (HMAC-SHA256 over the raw request body).
 *
 * Why this matters: without this, anything that knows our endpoint URL
 * could POST a fake "something changed" ping and trigger a wasted (or
 * abusive) enrichment + Discord alert cycle.
 */
export function verifyWebhookSignature(rawBody, macHeader) {
  throw new Error("TODO: implement verifyWebhookSignature — see comment above");
}

/**
 * TODO: Fetch full field data for a single lead record by ID.
 *
 * Why this is separate from the payload fetch: the webhook payload only
 * includes the fields that *changed*, which is enough for a create event
 * but is the more correct call to make explicit and reusable if this
 * pipeline later reacts to updates too.
 *
 * Endpoint: GET /{baseId}/{tableName}/{recordId}
 */
export async function getLeadRecord(recordId) {
  throw new Error("TODO: implement getLeadRecord — see comment above");
}

/**
 * TODO: PATCH the lead record with enrichment results.
 *
 * Fields to write back (create these on the Airtable table first — Airtable
 * will not auto-create fields on PATCH):
 *   - Company Size
 *   - Industry
 *   - Suggested Next Action
 *   - Enriched At
 *   - Enrichment Source ("AbstractAPI" or "none" if enrichment came back empty)
 *
 * Endpoint: PATCH /{baseId}/{tableName}/{recordId}
 */
export async function writeEnrichmentToLead(recordId, enrichment) {
  throw new Error("TODO: implement writeEnrichmentToLead — see comment above");
}
