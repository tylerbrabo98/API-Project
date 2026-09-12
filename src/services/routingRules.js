// This is the "custom" business logic layer that turns raw enrichment data
// into a routing decision + a suggested action — the part of the pipeline
// that isn't just "call API A then API B", but actual judgment a sales team
// would want automated.
//
// Kept as pure functions (no API calls, no side effects) so the rules can
// be unit tested and reasoned about independently of Airtable/Discord/
// AbstractAPI being reachable at all.

/**
 * TODO: Decide which Discord bucket a lead should route to.
 *
 * Must return one of the keys configured in config.discord.webhooks:
 * "enterprise" | "smb" | "unknown".
 *
 * Starting rule of thumb (adjust once real enrichment data is flowing):
 *   - enrichment.found === false            -> "unknown"
 *   - enrichment.employeeCount >= 500        -> "enterprise"
 *   - otherwise                              -> "smb"
 */
export function pickRoutingBucket(enrichment) {
  throw new Error("TODO: implement pickRoutingBucket — see comment above");
}

/**
 * TODO: Produce a one-line suggested next action for the sales rep.
 *
 * This is the "sales engineer" flavor of the project — the output should
 * read like something a rep would actually act on, not a raw data dump.
 * Starting rule of thumb:
 *   - enrichment.found === false            -> "Manually qualify — no firmographic data found"
 *   - enterprise bucket                      -> "Route to AE for enterprise demo"
 *   - smb bucket                             -> "Send self-serve trial link"
 */
export function suggestNextAction(enrichment, bucket) {
  throw new Error("TODO: implement suggestNextAction — see comment above");
}
