import Database from "better-sqlite3";
import { config } from "../config/env.js";

// Why this file exists: Airtable's webhook only says "something changed in
// this base" — it doesn't say what. The flow is:
//   1. Airtable pings our endpoint (no payload)
//   2. We call GET /bases/{id}/webhooks/{id}/payloads?cursor=N to fetch the
//      actual changes since our last known cursor
//   3. We must persist that cursor, or every restart would re-process the
//      entire webhook payload history from the beginning
//   4. We also record which Airtable record IDs we've already fully
//      processed (enriched + alerted + written back), because Airtable can
//      redeliver the same ping more than once and payload pages can overlap
//
// SQLite is enough for a single-instance portfolio deployment. Known
// tradeoff: most free hosting tiers (Render/Railway free plans) have an
// ephemeral filesystem, so this resets on redeploy/restart. Fine for a demo;
// called out explicitly in the README rather than silently swept under the rug.

let db;

export function getDb() {
  if (!db) {
    db = new Database(config.database.path);
    db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_cursor (
        webhook_id TEXT PRIMARY KEY,
        cursor INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS processed_records (
        record_id TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL
      );
    `);
  }
  return db;
}

export function getCursor(webhookId) {
  const row = getDb()
    .prepare("SELECT cursor FROM webhook_cursor WHERE webhook_id = ?")
    .get(webhookId);
  return row ? row.cursor : null;
}

export function setCursor(webhookId, cursor) {
  getDb()
    .prepare(
      `INSERT INTO webhook_cursor (webhook_id, cursor) VALUES (?, ?)
       ON CONFLICT(webhook_id) DO UPDATE SET cursor = excluded.cursor`
    )
    .run(webhookId, cursor);
}

export function hasProcessed(recordId) {
  const row = getDb()
    .prepare("SELECT 1 FROM processed_records WHERE record_id = ?")
    .get(recordId);
  return Boolean(row);
}

export function markProcessed(recordId) {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO processed_records (record_id, processed_at) VALUES (?, datetime('now'))"
    )
    .run(recordId);
}
