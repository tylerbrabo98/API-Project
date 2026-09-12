import { Router } from "express";
import { verifyWebhookSignature } from "../integrations/airtable.js";
import { processWebhookPing } from "../services/leadProcessor.js";
import { createLogger } from "../lib/logger.js";

export const airtableWebhookRouter = Router();

const logger = createLogger("airtable-webhook-route");

// Why this responds 200 immediately and processes async: Airtable (like
// most webhook senders) expects a fast ack and will treat a slow response
// as a failure and retry. Free-tier hosting (Render/Railway) can have a
// cold-start delay after idling, which risks that timeout — so we ack
// first, then do the real work (fetch payloads, enrich, alert, writeback)
// after responding.
airtableWebhookRouter.post("/webhooks/airtable", (req, res) => {
  const macHeader = req.headers["x-airtable-content-mac"];

  // Signature check happens before we touch anything else in the request —
  // an unsigned or forged ping shouldn't trigger a payload fetch, let alone
  // burn an enrichment API credit or post a Discord alert. req.rawBody is
  // populated by the express.json `verify` hook in server.js; verification
  // needs the exact raw bytes Airtable signed, not the parsed object.
  if (!verifyWebhookSignature(req.rawBody, macHeader)) {
    logger.warn("Rejected Airtable webhook ping with invalid signature", {
      hasHeader: Boolean(macHeader),
    });
    res.sendStatus(401);
    return;
  }

  res.sendStatus(200);

  processWebhookPing().catch((err) => {
    // TODO: replace with real alerting (even a Discord message to a
    // dedicated #pipeline-errors webhook would do) — right now a failure
    // here is only visible in server logs.
    logger.error("Failed to process Airtable webhook ping", {
      error: err.message,
      code: err.code,
    });
  });
});
