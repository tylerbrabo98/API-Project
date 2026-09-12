import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, assertRequiredConfig } from "./config/env.js";
import { airtableWebhookRouter } from "./routes/airtableWebhook.js";
import { dashboardRouter } from "./routes/dashboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
app.use(dashboardRouter);

// Serves public/dashboard.html at both / and /dashboard -- a static file
// rather than a template since the page has no server-rendered state of
// its own, it just fetches /api/leads client-side.
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "dashboard.html")));
app.get("/dashboard", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "dashboard.html")));

app.listen(config.port, () => {
  console.log(`Lead enrichment pipeline listening on port ${config.port}`);
});
