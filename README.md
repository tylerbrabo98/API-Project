# Lead Enrichment Pipeline

Portfolio project demonstrating custom API integration work: when a new lead
lands in Airtable, the pipeline enriches it with company data, alerts the
right sales channel in Discord with a suggested next action, and writes the
enrichment data back onto the lead record.

Built as a standalone project on personal/free-tier accounts.

## Why this stack

| Role | Platform | Notes |
|---|---|---|
| Lead source + writeback | Airtable (personal free account) | Real Webhooks API — ping-then-pull, not direct payload delivery |
| Company enrichment | AbstractAPI Company Enrichment | Simple API-key auth, generous-enough free tier |
| Sales alert | Discord Incoming Webhooks | One webhook URL per routing bucket, no OAuth needed |

See the "Known tradeoffs" section below for what each choice costs.

## Architecture

```
                     ┌────────────────────┐
                     │      Airtable       │
                     │   "Leads" table      │
                     └─────────┬───────────┘
                               │ (1) record created
                               ▼
                     ┌────────────────────┐
                     │  Webhook: ping only  │  <- no payload, just "something changed"
                     └─────────┬───────────┘
                               │ (2) POST /webhooks/airtable
                               ▼
              ┌───────────────────────────────────┐
              │         Express server              │
              │   (Render/Railway, this repo)        │
              │                                       │
              │  responds 200 immediately             │
              │  then, async:                         │
              │                                       │
              │  (3) GET webhook payloads (cursor)  ──┼──▶ Airtable API
              │  (4) GET full lead record            ──┼──▶ Airtable API
              │  (5) enrich company by domain        ──┼──▶ AbstractAPI
              │  (6) pick routing bucket +             │
              │      suggested next action             │
              │      (local business logic, no API)    │
              │  (7) POST alert                       ──┼──▶ Discord webhook
              │  (8) PATCH lead with enrichment       ──┼──▶ Airtable API
              │                                       │
              │  SQLite: webhook cursor +              │
              │  processed-record dedupe               │
              └───────────────────────────────────┘
```

Key design choices this diagram is meant to highlight:

- **Ack-then-process**: the webhook handler responds `200` before doing any
  real work, because Airtable (like most webhook senders) treats a slow
  response as a failure and retries — and free-tier hosts can have cold-start
  latency after idling.
- **Ping-then-pull**: Airtable's webhook only signals "something changed."
  The actual diff is fetched via a separate authenticated call, tracked with
  a cursor persisted in SQLite so a server restart doesn't replay the entire
  webhook history.
- **Pure business logic, isolated**: routing/next-action rules
  (`src/services/routingRules.js`) have zero API calls in them, so they can
  be reasoned about and tested independently of whether Airtable/AbstractAPI/
  Discord are even reachable.

## Project structure

```
src/
  config/env.js              Loads + validates env vars, single source of truth
  integrations/
    airtable.js               Airtable API client (read payloads, read/write lead records, webhook mgmt)
    enrichment.js              AbstractAPI client
    discord.js                 Discord webhook poster
  routes/
    airtableWebhook.js         POST /webhooks/airtable — receives pings, acks fast, hands off
  services/
    leadProcessor.js           Orchestrates the end-to-end sequence per webhook ping
    routingRules.js            Pure business logic: which channel, what next action
  lib/
    dedupe.js                  SQLite-backed cursor + processed-record tracking
  jobs/
    refreshWebhook.js          Keeps the Airtable webhook subscription from expiring
  server.js                    Express app entry point
scripts/
  setupWebhook.js               One-off: registers the Airtable webhook, prints the MAC secret to save
```

Every integration point currently has a `TODO` and a comment explaining what
goes there and why — this is a scaffold, not a working pipeline yet.

## Setup

1. `cp .env.example .env` and fill in the Airtable PAT, base ID, and
   AbstractAPI key (Discord webhook URLs and the Airtable webhook ID/secret
   come later, once those are created).
2. `npm install`
3. Create the Airtable base with a `Leads` table (fields: Name, Email,
   Company, plus the enrichment writeback fields listed in
   `src/integrations/airtable.js`).
4. Create a Discord server with a few channels (e.g. `#enterprise-leads`,
   `#smb-leads`, `#unknown-leads`) and an Incoming Webhook for each; put the
   URLs in `.env`.
5. Deploy the server (Render/Railway) so it has a public HTTPS URL, then run
   `npm run setup-webhook` to register the Airtable webhook against that
   deployed URL — save the returned webhook ID + MAC secret into `.env` (and
   into the host's env var dashboard).
6. Schedule `npm run refresh-webhook` to run periodically (see
   `src/jobs/refreshWebhook.js`) so the webhook subscription doesn't expire.

## Known tradeoffs

- **SQLite on ephemeral disk**: most free hosting tiers wipe local disk on
  restart/redeploy, which resets the dedupe log and webhook cursor. Acceptable
  for a demo; would move to a hosted Postgres (e.g. Supabase free tier) for
  anything longer-lived.
- **Airtable webhook expiry**: subscriptions expire after ~7 days without a
  refresh call — handled by `src/jobs/refreshWebhook.js`, but it has to
  actually be scheduled somewhere or the pipeline goes silently quiet.
- **AbstractAPI free tier quota is small**: fine for demoing, not for real
  traffic. Personal/generic email domains will also legitimately return no
  company data — the routing logic treats that as an expected outcome
  (`unknown` bucket), not an error.
- **Discord alerts use static per-channel webhook URLs**, not a bot — this
  means the set of routing buckets is fixed at deploy time. A real bot
  (Developer Portal app + bot token, posting via the REST API to any channel
  ID) would allow choosing channels dynamically, at the cost of more setup.
- **No OAuth anywhere in this version** — Airtable and AbstractAPI both use
  simple token/API-key auth, and Discord's webhook URL is itself the
  credential. A deliberate scope choice for a single-account portfolio
  project; worth being able to speak to how a multi-tenant OAuth version
  would differ.
