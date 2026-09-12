import { config } from "../config/env.js";
import { getCursor, setCursor, hasProcessed, markProcessed } from "../lib/dedupe.js";
import { fetchWebhookPayloads, getLeadRecord, writeEnrichmentToLead } from "../integrations/airtable.js";
import { enrichCompany } from "../integrations/enrichment.js";
import { postLeadAlert } from "../integrations/discord.js";
import { pickRoutingBucket, suggestNextAction } from "./routingRules.js";

// This is the orchestrator the webhook route hands off to. It owns the
// end-to-end sequence and the error handling between each step — each
// integration module above stays a thin, single-purpose API client with no
// knowledge of the others.
//
// Deliberately synchronous/sequential rather than parallelized: enrichment
// must complete before routing, and routing must complete before the
// Discord message and the Airtable writeback (both of which depend on the
// suggested next action). There's no independent work to parallelize here.

/**
 * TODO: Full pipeline for one webhook ping.
 *
 * Sequence:
 *   1. fetchWebhookPayloads(cursor) — get new/changed records since last run
 *   2. setCursor(...) — persist the new cursor immediately, even if a later
 *      step fails, so we don't reprocess the same payload page on retry
 *   3. For each new lead record not already in hasProcessed():
 *      a. getLeadRecord(recordId) — full field data
 *      b. extract domain from the lead's email field
 *      c. enrichCompany(domain)
 *      d. pickRoutingBucket(enrichment) + suggestNextAction(enrichment, bucket)
 *      e. postLeadAlert(webhookUrlForBucket, lead, enrichment, suggestedNextAction)
 *      f. writeEnrichmentToLead(recordId, { ...enrichment, suggestedNextAction })
 *      g. markProcessed(recordId) — only after steps e+f both succeed
 *
 * Error handling note: if step (e) or (f) throws for one lead, log it and
 * continue to the next lead rather than aborting the whole batch — one bad
 * record shouldn't block alerts for the others in the same payload page.
 */
export async function processWebhookPing() {
  const cursor = getCursor(config.airtable.webhookId);
  throw new Error("TODO: implement processWebhookPing — see comment above");
}
