import { Router } from "express";
import { verifyWebhookSignature } from "../integrations/airtable.js";
import { processWebhookPing } from "../services/leadProcessor.js";

export const airtableWebhookRouter = Router();

// Why this responds 200 immediately and processes async: Airtable (like
// most webhook senders) expects a fast ack and will treat a slow response
// as a failure and retry. Free-tier hosting (Render/Railway) can have a
// cold-start delay after idling, which risks that timeout — so we ack
// first, then do the real work (fetch payloads, enrich, alert, writeback)
// after responding.
airtableWebhookRouter.post("/webhooks/airtable", (req, res) => {
  // TODO: verify req.headers["x-airtable-content-mac"] via
  // verifyWebhookSignature(req.rawBody, header) and reject with 401 if it
  // doesn't match, before doing anything else. Requires capturing the raw
  // request body — see the express.json({ verify }) option wired up in
  // src/server.js.

  res.sendStatus(200);

  processWebhookPing().catch((err) => {
    // TODO: replace with real logging/alerting (even a Discord message to a
    // dedicated #pipeline-errors webhook would do) — right now a failure
    // here is silent except for this console line.
    console.error("Failed to process Airtable webhook ping:", err);
  });
});
