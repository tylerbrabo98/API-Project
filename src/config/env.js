import "dotenv/config";

// Central place to read env vars so every integration module imports config
// from here instead of touching process.env directly — keeps validation and
// naming in one spot, and makes it obvious what the whole app depends on.

function required(name) {
  const value = process.env[name];
  if (!value) {
    // Fail fast at boot rather than deep inside a request handler when a
    // webhook fires and a downstream API call mysteriously 401s.
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3000),

  airtable: {
    pat: process.env.AIRTABLE_PAT,
    baseId: process.env.AIRTABLE_BASE_ID,
    tableName: process.env.AIRTABLE_TABLE_NAME || "Leads",
    // Webhook subscriptions filter by table ID (e.g. "tblXXXXXXXXXXXXXX"),
    // not table name -- Airtable's webhook spec requires it for
    // recordChangeScope. Grab it from the API docs page for your base, or
    // the URL bar when the table is open.
    tableId: process.env.AIRTABLE_TABLE_ID,
    webhookId: process.env.AIRTABLE_WEBHOOK_ID,
    webhookMacSecret: process.env.AIRTABLE_WEBHOOK_MAC_SECRET,
  },

  // Public HTTPS URL of this deployed server, used to register the
  // notificationUrl Airtable pings on record creation. Only needed once
  // deployed -- see scripts/setupWebhook.js.
  publicBaseUrl: process.env.PUBLIC_BASE_URL,

  abstractApi: {
    apiKey: process.env.ABSTRACT_API_KEY,
  },

  discord: {
    webhooks: {
      enterprise: process.env.DISCORD_WEBHOOK_ENTERPRISE,
      smb: process.env.DISCORD_WEBHOOK_SMB,
      unknown: process.env.DISCORD_WEBHOOK_UNKNOWN,
    },
  },

  database: {
    path: process.env.DATABASE_PATH || "./data/pipeline.db",
  },
};

// Called once at server startup (see src/server.js) — not at import time,
// so scripts like setupWebhook.js can import individual config values
// without needing every var (e.g. Discord webhooks) to already be set.
export function assertRequiredConfig() {
  required("AIRTABLE_PAT");
  required("AIRTABLE_BASE_ID");
  required("AIRTABLE_TABLE_ID");
  required("ABSTRACT_API_KEY");
}
