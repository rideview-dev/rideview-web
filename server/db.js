/**
 * Ride View — PostgreSQL data layer
 * ------------------------------------------------------------
 * One place that talks to the database. Exposes:
 *   - initDb()            : connect + create the table if it doesn't exist
 *   - insertSubmission()  : store one lead, returns the new row
 *   - listSubmissions()   : read recent leads (for the admin endpoint)
 *   - pool                : the underlying pg Pool (for health checks / shutdown)
 *
 * Connection is configured entirely via environment variables. You can use
 * either a single DATABASE_URL (common on hosted Postgres — Render, Railway,
 * Supabase, Heroku, Neon, etc.) or the standard discrete PG* variables
 * (PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT), which node-postgres reads
 * automatically. See .env.example.
 */

const { Pool } = require('pg');

// Build the pool. If DATABASE_URL is present it wins; otherwise node-postgres
// falls back to the PG* environment variables on its own.
const poolConfig = {};
if (process.env.DATABASE_URL) {
  poolConfig.connectionString = process.env.DATABASE_URL;
}
// Many hosted Postgres providers require SSL. Set PGSSL=require (or "true") to
// enable it. rejectUnauthorized:false accepts the provider's managed cert,
// which is the norm for those hosts.
if (/^(require|true|1)$/i.test(process.env.PGSSL || '')) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

// Surface unexpected idle-client errors instead of crashing the process.
pool.on('error', (err) => {
  console.error('[db] unexpected idle client error:', err.message);
});

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS submissions (
    id          BIGSERIAL PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    name        TEXT        NOT NULL,
    email       TEXT        NOT NULL,
    company     TEXT,
    ip          TEXT,
    user_agent  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_submissions_received_at
    ON submissions (received_at DESC);
  CREATE INDEX IF NOT EXISTS idx_submissions_email
    ON submissions (email);
`;

// Connect and make sure the schema exists. Call once at startup.
async function initDb() {
  // A quick query both verifies connectivity and creates the table/indexes.
  await pool.query(CREATE_TABLE_SQL);
}

// Store one lead. Parameterized query — no string interpolation, so this is
// safe from SQL injection. Returns the inserted row (incl. id + received_at).
async function insertSubmission({ name, email, company, ip, userAgent }) {
  const sql = `
    INSERT INTO submissions (name, email, company, ip, user_agent)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, received_at, name, email, company, ip, user_agent
  `;
  const params = [name, email, company || null, ip || null, userAgent || null];
  const { rows } = await pool.query(sql, params);
  return rows[0];
}

// Read recent leads, newest first (used by the protected admin endpoint).
async function listSubmissions(limit = 500) {
  const { rows } = await pool.query(
    `SELECT id, received_at, name, email, company, ip, user_agent
       FROM submissions
       ORDER BY received_at DESC
       LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = { pool, initDb, insertSubmission, listSubmissions };
