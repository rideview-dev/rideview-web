/**
 * RideView — send a test of both lead emails
 * ------------------------------------------------------------
 * Verifies the whole mail path end to end without touching the database or
 * submitting the form. Sends:
 *
 *   1. the internal "new partner lead" notification -> MAIL_TO
 *   2. the visitor confirmation                     -> the address you pass in
 *
 * Usage:
 *   npm run mail:test -- you@example.com
 *   npm run mail:test -- you@example.com fr        # confirmation in French
 *
 * Exit code is 0 only if both messages were accepted by the SMTP server.
 */

require('dotenv').config();

const mailer = require('../mailer');

async function main() {
  const [, , address, langArg] = process.argv;

  if (!address) {
    console.error('Usage: npm run mail:test -- <address> [lang]');
    console.error('  lang is one of: ' + mailer.SUPPORTED_LANGS.join(', ') + ' (default en)');
    process.exit(1);
  }

  if (!mailer.isEnabled()) {
    console.error('SMTP is not configured — set SMTP_HOST and MAIL_TO in server/.env.');
    process.exit(1);
  }

  const lang = mailer.normaliseLang(langArg);
  if (langArg && lang !== String(langArg).toLowerCase()) {
    console.warn(`Unknown language "${langArg}" — falling back to "${lang}".`);
  }

  process.stdout.write('Verifying SMTP credentials... ');
  try {
    await mailer.verify();
    console.log('OK');
  } catch (err) {
    console.log('FAILED');
    console.error('  ' + err.message);
    console.error('  Nothing was sent. Fix the credentials in server/.env and try again.');
    process.exit(1);
  }

  // A stand-in lead. Nothing is written to the database.
  const entry = {
    id: 'TEST',
    received_at: new Date(),
    name: 'Test Lead',
    email: address,
    company: 'Test Company',
    lang,
    ip: '127.0.0.1',
  };

  let failures = 0;

  process.stdout.write(`Sending team notification to ${process.env.MAIL_TO}... `);
  try {
    const r = await mailer.sendLeadNotification(entry);
    console.log(r.sent ? 'SENT (' + r.messageId + ')' : 'SKIPPED (' + r.reason + ')');
  } catch (err) {
    console.log('FAILED');
    console.error('  ' + err.message);
    failures++;
  }

  process.stdout.write(`Sending ${lang} confirmation to ${address}... `);
  try {
    const r = await mailer.sendLeadConfirmation(entry);
    if (r.sent) console.log('SENT (' + r.messageId + ')');
    else console.log('SKIPPED (' + r.reason + ')');
  } catch (err) {
    console.log('FAILED');
    console.error('  ' + err.message);
    failures++;
  }

  console.log('');
  if (failures) {
    console.log('Some messages failed to send.');
    process.exit(1);
  }
  console.log('Both messages were accepted by the SMTP server.');
  console.log('If they do not arrive, check the spam folder and your provider\'s delivery log.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
