import { config } from "../config/env.js";
import { getCursor, setCursor, hasProcessed, markProcessed } from "../lib/dedupe.js";
import {
  fetchWebhookPayloads,
  extractCreatedRecordIds,
  getLeadRecord,
  writeEnrichmentToLead,
} from "../integrations/airtable.js";
import { enrichCompany } from "../integrations/enrichment.js";
import { postLeadAlert } from "../integrations/discord.js";
import { pickRoutingBucket, suggestNextAction } from "./routingRules.js";
import { createLogger } from "../lib/logger.js";

const logger = createLogger("lead-processor");

// This is the orchestrator the webhook route hands off to. It owns the
// end-to-end sequence and the error handling between each step — each
// integration module stays a thin, single-purpose API client with no
// knowledge of the others.
//
// Deliberately sequential rather than parallelized per lead: enrichment
// must finish before routing, and routing must finish before the Discord
// message and the Airtable writeback (both depend on the suggested next
// action). There's no independent work to parallelize within one lead.
// Multiple leads in the same payload batch *are* independent of each
// other, but are still processed one at a time here rather than via
// Promise.all — deliberately, so one bad lead's error handling doesn't
// interleave confusingly with another's in the logs, and so we don't burn
// through AbstractAPI's 1 req/sec free-tier limit in a burst.
export async function processWebhookPing() {
  const cursor = getCursor(config.airtable.webhookId);
  const { payloads, nextCursor } = await fetchWebhookPayloads(cursor);

  // Persist the cursor immediately, before processing any lead — if a
  // later step throws, we still don't want to re-fetch and re-process the
  // same payload page on the next ping.
  setCursor(config.airtable.webhookId, nextCursor);

  const recordIds = extractCreatedRecordIds(payloads).filter((id) => !hasProcessed(id));

  if (recordIds.length === 0) {
    logger.info("No new lead records to process", { payloadCount: payloads.length });
    return;
  }

  logger.info("Processing new lead records", { count: recordIds.length });

  for (const recordId of recordIds) {
    try {
      await processLead(recordId);
      markProcessed(recordId);
    } catch (err) {
      // One bad record shouldn't block alerts for the others in the same
      // batch — log and move on rather than letting the whole ping fail.
      logger.error("Failed to process lead record", {
        recordId,
        error: err.message,
        code: err.code,
      });
    }
  }
}

async function processLead(recordId) {
  const lead = await getLeadRecord(recordId);
  const email = lead.fields?.Email;
  const domain = extractDomain(email);

  logger.info("Processing lead", { recordId, domain });

  // No domain to look up (missing/malformed email) is a normal case, not
  // an error — route it through the same "unknown" path enrichment misses
  // take, rather than special-casing it here.
  const enrichment = domain
    ? await enrichCompany(domain)
    : { found: false, companyName: null, industry: null, employeeCount: null, country: null };

  const bucket = pickRoutingBucket(enrichment);
  const nextAction = suggestNextAction(enrichment, bucket);

  const webhookUrl = config.discord.webhooks[bucket];
  if (!webhookUrl) {
    throw new Error(`No Discord webhook URL configured for routing bucket "${bucket}"`);
  }

  await postLeadAlert(webhookUrl, lead, enrichment, nextAction);
  await writeEnrichmentToLead(recordId, enrichment, nextAction);

  logger.info("Finished processing lead", { recordId, bucket, nextAction });
}

function extractDomain(email) {
  if (!email || typeof email !== "string" || !email.includes("@")) return null;
  return email.split("@")[1]?.toLowerCase() ?? null;
}
