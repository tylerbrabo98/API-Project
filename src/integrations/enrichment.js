import { config } from "../config/env.js";

// AbstractAPI Company Enrichment client. Simple API-key auth, no OAuth.
//
// Known limitation to design around (see README "Known tradeoffs"): the
// free tier has a small monthly quota, and lookups for personal/generic
// email domains (gmail.com, outlook.com, etc.) will legitimately return no
// company data. Callers must treat "no data" as an expected outcome, not
// an error — the routing logic (src/services/routingRules.js) has an
// explicit fallback bucket for this.

const ABSTRACT_API_BASE = "https://companyenrichment.abstractapi.com/v2";

/**
 * TODO: Call AbstractAPI with a company domain and return normalized fields.
 *
 * Input: domain string, e.g. "acme.com" (extracted from the lead's email in
 * src/services/leadProcessor.js — strip the address down to everything
 * after the @).
 *
 * Expected shape to normalize the response into (keep this stable so
 * routingRules.js doesn't need to know about AbstractAPI's raw response
 * shape):
 *   {
 *     found: boolean,
 *     companyName: string | null,
 *     industry: string | null,
 *     employeeCount: number | null,
 *     country: string | null,
 *   }
 *
 * On a 404 / empty result, return { found: false, ...nulls } rather than
 * throwing — this is a normal, expected case, not a failure.
 */
export async function enrichCompany(domain) {
  throw new Error("TODO: implement enrichCompany — see comment above");
}
