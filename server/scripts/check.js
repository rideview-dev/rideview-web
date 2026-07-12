/**
 * Ride View — preflight check
 * ------------------------------------------------------------
 * Verifies your environment is wired up correctly BEFORE you deploy or rely on
 * the form: it connects to PostgreSQL (and ensures the table exists) and, if
 * SMTP is configured, verifies the mail credentials.
 *
 *   npm run check
 *
 * Exit code is 0 only if the database check passes. Email is treated as
 * optional — a warning, not a failure — since leads still save without it.
 */

require('dotenv').config();

const db = require('../db');
const mailer = require('../mailer');

async function main() {
  let dbOk = false;

  // --- Database ---
  process.stdout.write('Checking PostgreSQL... ');
  try {
    await db.initDb();
    const rows = await db.listSubmissions(1);
    console.log('OK');
    console.log(`  - "submissions" table is present (${rows.length ? 'has rows' : 'empty'})`);
    dbOk = true;
  } catch (err) {
    console.log('FAILED');
    console.error('  - ' + err.message);
    console.error('  - Check DATABASE_URL (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE) and PGSSL in server/.env');
  }

  // --- Email (optional) ---
  process.stdout.write('Checking SMTP... ');
  if (!mailer.isEnabled()) {
    console.log('SKIPPED');
    console.log('  - Email is off (set SMTP_HOST + MAIL_TO to enable). Leads will still save to the DB.');
  } else {
    try {
      await mailer.verify();
      console.log('OK');
      console.log('  - SMTP credentials accepted; lead notifications will send.');
    } catch (err) {
      console.log('WARNING');
      console.error('  - ' + err.message);
      console.error('  - Email will not send. Leads still save to the DB. Check SMTP_* in server/.env.');
    }
  }

  await db.pool.end().catch(() => {});

  console.log('');
  console.log(dbOk ? 'Preflight passed.' : 'Preflight FAILED (database is required).');
  process.exit(dbOk ? 0 : 1);
}

main().catch((err) => {
  console.error('Unexpected error during preflight:', err);
  process.exit(1);
});
