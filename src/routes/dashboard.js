import { Router } from "express";
import { listRecentLeads } from "../integrations/airtable.js";
import { createLogger } from "../lib/logger.js";

export const dashboardRouter = Router();

const logger = createLogger("dashboard-route");

// This endpoint is public and uncached-by-the-browser, so without a
// server-side cache, every viewer's poll (every 8s, per dashboard.html)
// hits Airtable directly -- and that quota (5 req/sec per base on the free
// plan) is shared with the actual webhook pipeline. A short cache means any
// number of simultaneous dashboard viewers cost at most one real Airtable
// call per TTL window, instead of one each.
const CACHE_TTL_MS = 5000;
let cache = { data: null, expiresAt: 0 };

// This endpoint is intentionally public and unauthenticated -- the whole
// point is being able to hand someone a URL and let them watch the pipeline
// work. That's also why it never returns a full email address, only the
// domain: there's no reason a public demo view needs to expose a lead's
// full contact info, even when the "lead" is just test data.
dashboardRouter.get("/api/leads", async (_req, res) => {
  if (Date.now() < cache.expiresAt) {
    res.json(cache.data);
    return;
  }

  try {
    const records = await listRecentLeads(20);
    // Skip completely empty records -- Airtable seeds a few blank rows on
    // table creation, and they're not real leads, just noise that would
    // otherwise sit at "Processing..." forever since nothing ever fills them in.
    const realLeads = records.filter((r) => r.fields?.Name || r.fields?.Email);
    const shaped = realLeads.map(toPublicShape);

    cache = { data: shaped, expiresAt: Date.now() + CACHE_TTL_MS };
    res.json(shaped);
  } catch (err) {
    logger.error("Failed to fetch leads for dashboard", { error: err.message, code: err.code });

    // A stale-but-real list beats an error screen for a demo view -- serve
    // the last good result if we have one, rather than making a transient
    // Airtable hiccup visible to whoever's looking at the dashboard.
    if (cache.data) {
      res.json(cache.data);
      return;
    }
    res.status(502).json({ error: "Could not fetch leads right now." });
  }
});

function toPublicShape(record) {
  const fields = record.fields ?? {};
  const enriched = Boolean(fields["Enrichment Source"]);

  return {
    id: record.id,
    createdTime: record.createdTime,
    name: fields.Name ?? null,
    emailDomain: extractDomain(fields.Email),
    company: fields.Company ?? null,
    industry: fields.Industry ?? null,
    companySize: fields["Company Size"] ?? null,
    suggestedNextAction: fields["Suggested Next Action"] ?? null,
    enrichmentSource: fields["Enrichment Source"] ?? null,
    enrichedAt: fields["Enriched At"] ?? null,
    bucket: enriched ? bucketFromAction(fields["Suggested Next Action"]) : "pending",
  };
}

function extractDomain(email) {
  if (!email || typeof email !== "string" || !email.includes("@")) return null;
  return email.split("@")[1] ?? null;
}

function bucketFromAction(action) {
  if (!action) return "pending";
  if (action.includes("enterprise")) return "enterprise";
  if (action.includes("self-serve")) return "smb";
  return "unknown";
}
