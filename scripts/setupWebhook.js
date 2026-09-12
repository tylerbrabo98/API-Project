import { createWebhook } from "../src/integrations/airtable.js";

// One-off script, run manually (`npm run setup-webhook`) after deploying —
// not something the server calls itself. Registering an Airtable webhook
// returns a MAC secret exactly once, at creation time, which must be copied
// into AIRTABLE_WEBHOOK_ID / AIRTABLE_WEBHOOK_MAC_SECRET in .env (and in
// your host's env var dashboard) before the server can verify incoming pings.
//
// TODO: also worth adding here eventually — checking whether a webhook
// already exists for this base before creating a duplicate one.

const webhook = await createWebhook();
console.log("Webhook created. Save these to your .env:");
console.log(webhook);
