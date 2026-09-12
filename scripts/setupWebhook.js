import { createWebhook } from "../src/integrations/airtable.js";

// One-off script, run manually (`npm run setup-webhook`) after deploying —
// not something the server calls itself. Requires PUBLIC_BASE_URL and
// AIRTABLE_TABLE_ID to already be set in .env, since both are baked into
// the webhook subscription at creation time.
//
// Registering an Airtable webhook returns a MAC secret exactly once, at
// creation time, which must be copied into AIRTABLE_WEBHOOK_ID /
// AIRTABLE_WEBHOOK_MAC_SECRET in .env (and in your host's env var
// dashboard) before the server can verify incoming pings — Airtable will
// not show it again.
//
// TODO: worth adding eventually -- checking whether a webhook already
// exists for this base before creating a duplicate one.

const webhook = await createWebhook();

console.log("\nWebhook created. Save these into .env (and your host's env vars):\n");
console.log(`AIRTABLE_WEBHOOK_ID=${webhook.id}`);
console.log(`AIRTABLE_WEBHOOK_MAC_SECRET=${webhook.macSecretBase64}`);
console.log(`\nExpires: ${webhook.expirationTime} (run "npm run refresh-webhook" before then)`);
