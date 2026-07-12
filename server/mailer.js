/**
 * Ride View — email notifications (SMTP via Nodemailer)
 * ------------------------------------------------------------
 * Sends your team an email whenever a new partner lead arrives.
 *
 * Vendor-neutral: this uses plain SMTP, so the SAME config works with your
 * email host, Gmail / Outlook, or a transactional provider (Resend, SendGrid,
 * Mailgun all offer SMTP endpoints). To switch providers you only change the
 * environment variables — never this code.
 *
 * If SMTP isn't configured, email is simply skipped (the lead is still saved
 * to the database). Email is a notification, not the system of record, so a
 * mail hiccup never blocks or loses a submission.
 */

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

// Who the notification is sent to / from. MAIL_TO can be a comma-separated list.
const MAIL_TO = process.env.MAIL_TO || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;

// Email is "enabled" only when we have enough to actually send.
const enabled = Boolean(SMTP_HOST && MAIL_TO);

let transporter = null;
if (enabled) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    // Port 465 = implicit TLS (SMTPS). 587/25 = STARTTLS, handled automatically.
    secure: SMTP_PORT === 465,
    // auth is optional — some self-hosted/relay setups don't need it.
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
}

function isEnabled() {
  return enabled;
}

// Verify the SMTP connection/credentials at startup so misconfiguration shows
// up in the logs immediately rather than on the first real submission.
async function verify() {
  if (!transporter) return false;
  await transporter.verify();
  return true;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Send the "new partner lead" notification for one submission.
async function sendLeadNotification(entry) {
  if (!transporter) return { sent: false, skipped: true };

  const subject = `New partner lead: ${entry.name}${entry.company ? ' — ' + entry.company : ''}`;

  const text = [
    'A new "Partner with us" submission just came in.',
    '',
    `Name:     ${entry.name}`,
    `Email:    ${entry.email}`,
    `Company:  ${entry.company || '—'}`,
    `Received: ${entry.received_at}`,
    `IP:       ${entry.ip || '—'}`,
    entry.id != null ? `DB id:    ${entry.id}` : '',
  ].filter(Boolean).join('\n');

  const html = `
    <h2 style="margin:0 0 12px;font-family:system-ui,sans-serif">New partner lead</h2>
    <table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">
      <tr><td style="padding:4px 12px 4px 0;color:#666">Name</td><td><strong>${escapeHtml(entry.name)}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td><a href="mailto:${escapeHtml(entry.email)}">${escapeHtml(entry.email)}</a></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Company</td><td>${escapeHtml(entry.company) || '&mdash;'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Received</td><td>${escapeHtml(entry.received_at)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">IP</td><td>${escapeHtml(entry.ip) || '&mdash;'}</td></tr>
      ${entry.id != null ? `<tr><td style="padding:4px 12px 4px 0;color:#666">DB id</td><td>${escapeHtml(entry.id)}</td></tr>` : ''}
    </table>
  `;

  const info = await transporter.sendMail({
    from: MAIL_FROM,
    to: MAIL_TO,
    // Replying to the notification replies straight to the lead.
    replyTo: entry.email,
    subject,
    text,
    html,
  });

  return { sent: true, messageId: info.messageId };
}

module.exports = { isEnabled, verify, sendLeadNotification };
