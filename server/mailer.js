/**
 * RideView — outbound email (SMTP via Nodemailer)
 * ------------------------------------------------------------
 * Two messages go out for every partner-form submission:
 *
 *   1. sendLeadNotification()   -> your team (MAIL_TO, e.g. sales@rideview.ca)
 *      "here's a new lead, go contact them". Reply-To is the lead, so hitting
 *      reply in the notification writes straight to them.
 *
 *   2. sendLeadConfirmation()   -> the person who filled in the form
 *      "thanks, we'll be in touch". Written in the language they were reading
 *      the site in. Reply-To is MAIL_REPLY_TO (your sales inbox) so a reply
 *      lands where someone will act on it, not in a technical mailbox.
 *
 * Both are sent FROM MAIL_FROM (dev@rideview.ca).
 *
 * Vendor-neutral: this uses plain SMTP, so the SAME config works with your
 * email host, Microsoft 365 / Gmail, or a transactional provider (Resend,
 * SendGrid, Mailgun all offer SMTP endpoints). To switch providers you only
 * change the environment variables — never this code.
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

// Internal notification recipient(s) — comma-separated for multiple.
const MAIL_TO = process.env.MAIL_TO || '';
// Envelope sender for both messages.
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;
// Where a lead's reply to the confirmation should land. Defaults to MAIL_TO.
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || MAIL_TO;
// Set to false to send only the internal notification and skip the confirmation.
const SEND_CONFIRMATION = !/^(0|false|no)$/i.test(process.env.SEND_CONFIRMATION || 'true');

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

function confirmationEnabled() {
  return enabled && SEND_CONFIRMATION;
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

// Received timestamps come back from pg as a Date. Render them readably rather
// than dumping a raw toString() into the email.
function formatReceived(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value || '');
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

// ---------------------------------------------------------------------------
// Confirmation copy, one entry per language the site supports. `lang` arrives
// from the front-end and is validated by the caller; anything unknown falls
// back to English.
// ---------------------------------------------------------------------------
const SUPPORTED_LANGS = ['en', 'fr', 'es', 'ru', 'ar'];
const RTL_LANGS = ['ar'];

const CONFIRMATION = {
  en: {
    subject: 'Thanks for reaching out to RideView',
    greeting: (name) => `Hi ${name},`,
    body: [
      "Thanks for getting in touch. We've received your details and someone from our team will contact you shortly.",
      'RideView turns ride-hailing vehicles into measurable digital media channels — captive attention, precise geo-targeting, and real movement-based data.',
    ],
    signoff: 'Talk soon,',
    team: 'The RideView team',
    tagline: 'Where movement meets meaning.',
  },
  fr: {
    subject: 'Merci d’avoir contacté RideView',
    greeting: (name) => `Bonjour ${name},`,
    body: [
      'Merci de nous avoir contactés. Nous avons bien reçu vos coordonnées et un membre de notre équipe vous recontactera très prochainement.',
      'RideView transforme les véhicules de VTC en canaux médias numériques mesurables — une attention captive, un ciblage géographique précis et des données réelles fondées sur le mouvement.',
    ],
    signoff: 'À très bientôt,',
    team: 'L’équipe RideView',
    tagline: 'Là où le mouvement prend du sens.',
  },
  es: {
    subject: 'Gracias por contactar con RideView',
    greeting: (name) => `Hola ${name}:`,
    body: [
      'Gracias por ponerte en contacto. Hemos recibido tus datos y alguien de nuestro equipo se comunicará contigo en breve.',
      'RideView convierte los vehículos de transporte con conductor en canales de medios digitales medibles: atención cautiva, segmentación geográfica precisa y datos reales basados en el movimiento.',
    ],
    signoff: 'Hasta pronto,',
    team: 'El equipo de RideView',
    tagline: 'Donde el movimiento cobra sentido.',
  },
  ru: {
    subject: 'Спасибо за обращение в RideView',
    greeting: (name) => `Здравствуйте, ${name}!`,
    body: [
      'Спасибо, что написали нам. Мы получили ваши данные, и в ближайшее время с вами свяжется наш сотрудник.',
      'RideView превращает автомобили такси в измеримые каналы цифровой рекламы: вовлечённая аудитория, точный геотаргетинг и реальные данные, основанные на движении.',
    ],
    signoff: 'До скорой связи,',
    team: 'Команда RideView',
    tagline: 'Где движение обретает смысл.',
  },
  ar: {
    subject: 'شكرًا لتواصلك مع RideView',
    greeting: (name) => `مرحبًا ${name}،`,
    body: [
      'شكرًا لتواصلك معنا. لقد استلمنا بياناتك وسيتواصل معك أحد أعضاء فريقنا قريبًا.',
      'تحوّل RideView سيارات النقل الذكي إلى قنوات إعلامية رقمية قابلة للقياس — انتباه أسير، واستهداف جغرافي دقيق، وبيانات حقيقية قائمة على الحركة.',
    ],
    signoff: 'إلى اللقاء قريبًا،',
    team: 'فريق RideView',
    tagline: 'حيث تلتقي الحركة بالمعنى.',
  },
};

function normaliseLang(lang) {
  const l = String(lang || '').toLowerCase().slice(0, 2);
  return SUPPORTED_LANGS.includes(l) ? l : 'en';
}

const BRAND = '#2f6bff';

function confirmationHtml(t, name, lang) {
  const dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
  const align = dir === 'rtl' ? 'right' : 'left';
  const paragraphs = t.body
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#3a4258">${escapeHtml(p)}</p>`)
    .join('\n      ');

  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<body style="margin:0;padding:0;background:#f4f6fd">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-align:${align}">
    <div style="font-size:20px;font-weight:700;letter-spacing:-.02em;color:#111a33;margin-bottom:24px" dir="ltr">
      ride <span style="color:${BRAND}">view</span>
    </div>
    <div style="background:#ffffff;border-radius:14px;padding:28px 26px;border:1px solid #e4e9f7">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#111a33;font-weight:600">${escapeHtml(t.greeting(name))}</p>
      ${paragraphs}
      <p style="margin:24px 0 0;font-size:15px;line-height:1.65;color:#3a4258">
        ${escapeHtml(t.signoff)}<br /><strong style="color:#111a33">${escapeHtml(t.team)}</strong>
      </p>
    </div>
    <p style="margin:20px 0 0;font-size:13px;color:${BRAND};font-weight:600">${escapeHtml(t.tagline)}</p>
  </div>
</body>
</html>`;
}

function confirmationText(t, name) {
  return [t.greeting(name), '', ...t.body, '', t.signoff, t.team, '', t.tagline].join('\n');
}

// Send the "thanks, we'll be in touch" email to the person who submitted.
async function sendLeadConfirmation(entry) {
  if (!transporter) return { sent: false, skipped: true, reason: 'smtp-disabled' };
  if (!SEND_CONFIRMATION) return { sent: false, skipped: true, reason: 'disabled' };
  if (!entry || !entry.email) return { sent: false, skipped: true, reason: 'no-address' };

  const lang = normaliseLang(entry.lang);
  const t = CONFIRMATION[lang];
  // Use only the first word of the name in the greeting; people put all sorts
  // of things in that field and "Hi Firstname" reads better than the lot.
  const firstName = String(entry.name || '').trim().split(/\s+/)[0] || '';

  const info = await transporter.sendMail({
    from: MAIL_FROM,
    to: entry.email,
    replyTo: MAIL_REPLY_TO || undefined,
    subject: t.subject,
    text: confirmationText(t, firstName),
    html: confirmationHtml(t, firstName, lang),
  });

  return { sent: true, messageId: info.messageId, lang };
}

// Send the "new partner lead" notification to the team.
async function sendLeadNotification(entry) {
  if (!transporter) return { sent: false, skipped: true, reason: 'smtp-disabled' };

  const subject = `New partner lead: ${entry.name}${entry.company ? ' — ' + entry.company : ''}`;
  const received = formatReceived(entry.received_at);
  const lang = normaliseLang(entry.lang);

  const text = [
    'A new "Partner with us" submission just came in.',
    '',
    `Name:     ${entry.name}`,
    `Email:    ${entry.email}`,
    `Company:  ${entry.company || '—'}`,
    `Language: ${lang}`,
    `Received: ${received}`,
    `IP:       ${entry.ip || '—'}`,
    entry.id != null ? `DB id:    ${entry.id}` : '',
    '',
    'They have already been sent an automatic acknowledgement — follow up personally.',
  ].filter(Boolean).join('\n');

  const row = (label, value) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#666">${label}</td><td>${value}</td></tr>`;

  const html = `
    <h2 style="margin:0 0 12px;font-family:system-ui,sans-serif">New partner lead</h2>
    <table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">
      ${row('Name', `<strong>${escapeHtml(entry.name)}</strong>`)}
      ${row('Email', `<a href="mailto:${escapeHtml(entry.email)}">${escapeHtml(entry.email)}</a>`)}
      ${row('Company', escapeHtml(entry.company) || '&mdash;')}
      ${row('Language', escapeHtml(lang))}
      ${row('Received', escapeHtml(received))}
      ${row('IP', escapeHtml(entry.ip) || '&mdash;')}
      ${entry.id != null ? row('DB id', escapeHtml(entry.id)) : ''}
    </table>
    <p style="margin:16px 0 0;font-family:system-ui,sans-serif;font-size:13px;color:#666">
      They have already been sent an automatic acknowledgement — follow up personally.
    </p>
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

module.exports = {
  isEnabled,
  confirmationEnabled,
  verify,
  sendLeadNotification,
  sendLeadConfirmation,
  SUPPORTED_LANGS,
  normaliseLang,
};
