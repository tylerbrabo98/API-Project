// The "custom" business logic layer that turns raw enrichment data into a
// routing decision + a suggested action — the part of the pipeline that
// isn't just "call API A then API B", but actual judgment a sales team
// would want automated.
//
// Kept as pure functions (no API calls, no side effects) so the rules can
// be unit tested and reasoned about independently of Airtable/Discord/
// AbstractAPI being reachable at all.

const ENTERPRISE_EMPLOYEE_THRESHOLD = 500;

/**
 * Decide which Discord bucket a lead should route to.
 * Returns one of the keys configured in config.discord.webhooks:
 * "enterprise" | "smb" | "unknown".
 */
export function pickRoutingBucket(enrichment) {
  if (!enrichment.found) return "unknown";

  // enrichment.found can be true with employeeCount still null -- AbstractAPI
  // found the company but didn't have headcount data for it. Falling
  // through to "smb" here is a deliberate conservative default: better to
  // under-prioritize an unconfirmed large account than silently drop it
  // into the same bucket as a domain we know nothing about.
  if (enrichment.employeeCount != null && enrichment.employeeCount >= ENTERPRISE_EMPLOYEE_THRESHOLD) {
    return "enterprise";
  }

  return "smb";
}

/**
 * Produce a one-line suggested next action for the sales rep. This is the
 * "sales engineer" flavor of the project -- the output should read like
 * something a rep would actually act on, not a raw data dump.
 */
export function suggestNextAction(enrichment, bucket) {
  switch (bucket) {
    case "unknown":
      return "Manually qualify — no firmographic data found for this domain";
    case "enterprise":
      return "Route to AE for enterprise demo";
    case "smb":
      return "Send self-serve trial link";
    default:
      // Should be unreachable given pickRoutingBucket's return type, but
      // fail loud rather than silently emitting a blank suggestion if a
      // new bucket is ever added to one function and not the other.
      throw new Error(`No suggested action defined for routing bucket "${bucket}"`);
  }
}
