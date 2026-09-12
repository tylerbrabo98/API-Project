import express from "express";
import { config, assertRequiredConfig } from "./config/env.js";
import { airtableWebhookRouter } from "./routes/airtableWebhook.js";

assertRequiredConfig();

const app = express();

// Capture the raw body alongside the parsed JSON — Airtable's webhook
// signature (X-Airtable-Content-MAC) is computed over the raw bytes, so the
// parsed object alone isn't enough to verify it in
// integrations/airtable.js#verifyWebhookSignature.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use(airtableWebhookRouter);

app.listen(config.port, () => {
  console.log(`Lead enrichment pipeline listening on port ${config.port}`);
});
