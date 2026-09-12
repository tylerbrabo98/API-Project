// Discord alert client. Deliberately simple: a fixed map of Incoming
// Webhook URLs, one per routing bucket (see src/services/routingRules.js
// for how a lead gets assigned to a bucket). No bot token, no OAuth — the
// webhook URL itself is the credential, which is why it's handled like a
// secret (env var only, never logged or committed).
//
// Tradeoff, worth stating explicitly: this only supports a fixed, small set
// of channels known ahead of time. A real bot (Developer Portal app + bot
// token, POST /channels/{id}/messages) would allow posting to arbitrary
// channels chosen at runtime — noted as the natural next step if this
// pipeline needed to scale past a handful of sales teams.

/**
 * TODO: POST a formatted alert to the Discord webhook for the given bucket.
 *
 * Suggested message shape (Discord webhook payload):
 *   {
 *     content: "New enterprise lead: {companyName}",
 *     embeds: [{
 *       title: leadName,
 *       fields: [
 *         { name: "Company", value: companyName },
 *         { name: "Industry", value: industry },
 *         { name: "Employees", value: employeeCount },
 *         { name: "Suggested next action", value: suggestedNextAction },
 *       ],
 *     }],
 *   }
 *
 * webhookUrl comes from config.discord.webhooks[bucket] — caller
 * (leadProcessor.js) is responsible for picking the bucket via
 * routingRules.js and failing loudly if that bucket has no URL configured.
 */
export async function postLeadAlert(webhookUrl, lead, enrichment, suggestedNextAction) {
  throw new Error("TODO: implement postLeadAlert — see comment above");
}
