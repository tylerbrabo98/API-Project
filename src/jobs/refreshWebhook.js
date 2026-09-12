import { refreshWebhook } from "../integrations/airtable.js";

// Airtable webhooks expire ~7 days after creation, or ~7 days after the
// last time payloads were fetched or this refresh call was made -- whichever
// is more recent. A pipeline that's actively receiving leads refreshes
// itself as a side effect of fetchWebhookPayloads, but a quiet base (no
// leads for a week) would let the subscription lapse silently otherwise.
// Run this on a schedule (daily is comfortably safe) via cron on whatever
// host runs the server, or a scheduled job on Render/Railway.

refreshWebhook().catch((err) => {
  console.error("Failed to refresh Airtable webhook:", err.message);
  process.exit(1);
});
