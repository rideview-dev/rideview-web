/**
 * RideView — "Partner with us" backend
 * ------------------------------------------------------------
 * Receives partner-form submissions, validates them, stores each lead in
 * PostgreSQL, and emails your team a notification. Built on Express.
 *
 *   POST /api/contact      accept { name, email, company } -> save + email
 *   GET  /api/submissions  list stored leads as JSON (protected by ADMIN_TOKEN)
 *   GET  /api/health       liveness + DB/email status
 *
 * Resilience: the database is the system of record. If a DB write ever fails,
 * the lead is appended to a local fallback file (data/failed-submissions.jsonl)
 * so it is never lost, and we still try to email you. Email is only a
 * notification, so an SMTP hiccup never blocks a submission.
 *
 * Run:   npm install && npm start
 * Config: copy .env.example -> .env and fill in your values.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const db = require('./db');
const mailer = require('./mailer');

const app = express();
const PORT = process.env.PORT || 8000;

// --- config (from environment) ---
const CONFIG = {
  // Local folder used ONLY as a safety net if the database is unreachable.
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  // Optional token to protect the GET /api/submissions endpoint.
  // If unset, that endpoint is disabled (returns 404) for safety.
  adminToken: process.env.ADMIN_TOKEN || '',
  // comma-separated list of allowed origins, or "*" for any
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()),
  // Serve the marketing site from this same process so the front-end and the API
  // share one origin (no CORS, no mixed-content). Set SERVE_SITE=false to run
  // API-only behind a separate static host.
  serveSite: !/^(0|false|no)$/i.test(process.env.SERVE_SITE || 'true'),
  // How many ACCEPTED submissions one client may make per 10-minute window.
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '10', 10),
};

// How many reverse proxies sit in front of us. This decides whether
// X-Forwarded-For is believed. Default is FALSE (ignore the header and use the
// real socket address) because a client can send that header itself — trusting
// it blindly makes the rate limit bypassable and poisons the stored `ip`.
// Behind a proxy/CDN/PaaS router, set TRUST_PROXY to the hop count (usually 1),
// or to a comma-separated list of trusted proxy IPs/CIDRs.
const TRUST_PROXY_RAW = (process.env.TRUST_PROXY || '').trim();
let trustProxy = false;
if (TRUST_PROXY_RAW) {
  if (/^\d+$/.test(TRUST_PROXY_RAW)) trustProxy = parseInt(TRUST_PROXY_RAW, 10);
  else if (/^(true|yes)$/i.test(TRUST_PROXY_RAW)) trustProxy = 1;
  else if (/^(false|no)$/i.test(TRUST_PROXY_RAW)) trustProxy = false;
  else trustProxy = TRUST_PROXY_RAW.split(',').map((s) => s.trim());
}
app.set('trust proxy', trustProxy);

fs.mkdirSync(CONFIG.dataDir, { recursive: true });
const FALLBACK_PATH = path.join(CONFIG.dataDir, 'failed-submissions.jsonl');

// --- middleware ---
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(
  cors({
    origin: CONFIG.allowedOrigins.includes('*') ? true : CONFIG.allowedOrigins,
    methods: ['POST', 'GET'],
  })
);

// --- very light in-memory rate limit (per-IP, N accepted submissions / 10 min) ---
//
// Two deliberate choices here:
//  1. The client IP comes from req.ip, which respects the `trust proxy` setting
//     above instead of reading X-Forwarded-For straight off the request.
//  2. Only ACCEPTED submissions consume quota. Validation failures and honeypot
//     hits must not count, or a visitor who mistypes their email a few times is
//     locked out for ten minutes and can never get through.
const hits = new Map();
const RL_WINDOW_MS = 10 * 60 * 1000;

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// Returns this IP's in-window timestamps, dropping expired ones. Also deletes
// the key entirely once it is empty, so the Map can't grow without bound.
function recentHits(ip, now) {
  const arr = (hits.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  if (arr.length) hits.set(ip, arr);
  else hits.delete(ip);
  return arr;
}

// Checks the limit WITHOUT consuming quota.
function rateLimit(req, res, next) {
  if (recentHits(clientIp(req), Date.now()).length >= CONFIG.rateLimitMax) {
    return res.status(429).json({ ok: false, error: 'Too many submissions. Please try again later.' });
  }
  next();
}

// Called only once a submission has passed validation.
function recordSubmission(req) {
  const now = Date.now();
  const ip = clientIp(req);
  const arr = recentHits(ip, now);
  arr.push(now);
  hits.set(ip, arr);
}

// Periodic sweep so idle IPs don't linger for the life of the process.
setInterval(() => {
  const now = Date.now();
  for (const ip of Array.from(hits.keys())) recentHits(ip, now);
}, RL_WINDOW_MS).unref();

// --- helpers ---
function isValidEmail(email) {
  // Trim first: a pasted address often carries a leading/trailing space, and
  // rejecting that as "invalid" is a needless dead end for the visitor.
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// Last-resort store so a lead is never lost if the database is down.
function saveFallback(entry, reason) {
  try {
    fs.appendFileSync(FALLBACK_PATH, JSON.stringify({ ...entry, _db_error: reason }) + '\n');
  } catch (e) {
    console.error('[contact] FALLBACK WRITE FAILED:', e.message);
  }
}

// --- routes ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, email: mailer.isEnabled() });
});

app.post('/api/contact', rateLimit, async (req, res) => {
  try {
    const { name, email, company, lang, _gotcha } = req.body || {};

    // honeypot: bots fill hidden fields; humans don't
    if (_gotcha) return res.json({ ok: true });

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ ok: false, error: 'Please enter your name.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    }

    const lead = {
      name: String(name).trim().slice(0, 120),
      email: String(email).trim().slice(0, 254),
      company: String(company || '').trim().slice(0, 200),
      // Whatever the browser sent is untrusted; normalise to a supported code.
      lang: mailer.normaliseLang(lang),
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
    };

    // Passed validation — now it counts against the rate limit.
    recordSubmission(req);

    // 1) Store in PostgreSQL (system of record). On failure, fall back to a
    //    local file so the lead survives, then keep going so we still email.
    let stored = null;
    try {
      stored = await db.insertSubmission(lead);
      console.log('[contact] stored lead id=%s <%s>', stored.id, stored.email);
    } catch (dbErr) {
      console.error('[contact] DB insert failed, writing fallback file:', dbErr.message);
      saveFallback(
        { received_at: new Date().toISOString(), ...lead },
        dbErr.message
      );
    }

    // 2) Send both emails: the internal notification and the visitor's
    //    confirmation. Neither blocks the response, and a failure in one must
    //    not prevent the other — so they are settled independently and any
    //    error is logged rather than thrown.
    const entry = stored || { received_at: new Date().toISOString(), ...lead };
    // `stored` comes back from Postgres without the language, so put it back.
    entry.lang = lead.lang;

    const [notification, confirmation] = await Promise.allSettled([
      mailer.sendLeadNotification(entry),
      mailer.sendLeadConfirmation(entry),
    ]);

    if (notification.status === 'fulfilled') {
      if (notification.value.sent) console.log('[contact] team notified:', notification.value.messageId);
    } else {
      console.error('[contact] team notification failed (lead is still saved):', notification.reason.message);
    }

    if (confirmation.status === 'fulfilled') {
      if (confirmation.value.sent) {
        console.log('[contact] confirmation sent to <%s> in %s:', entry.email, confirmation.value.lang, confirmation.value.messageId);
      }
    } else {
      console.error('[contact] confirmation to the lead failed:', confirmation.reason.message);
    }

    return res.json({ ok: true, stored: Boolean(stored) });
  } catch (err) {
    console.error('[contact] error:', err.message);
    return res.status(500).json({ ok: false, error: 'Could not save right now. Please email dev@rideview.ca.' });
  }
});

// Protected: list stored submissions as JSON. Disabled unless ADMIN_TOKEN is set.
// Call with header  Authorization: Bearer <ADMIN_TOKEN>  or  ?token=<ADMIN_TOKEN>
app.get('/api/submissions', async (req, res) => {
  if (!CONFIG.adminToken) return res.status(404).json({ ok: false, error: 'Not found.' });
  // String() guards against ?token=a&token=b, which makes req.query.token an array.
  const provided = String((req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token || '');
  const same = provided.length === CONFIG.adminToken.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(CONFIG.adminToken));
  if (!same) {
    return res.status(401).json({ ok: false, error: 'Unauthorized.' });
  }
  try {
    const submissions = await db.listSubmissions();
    return res.json({ ok: true, count: submissions.length, submissions });
  } catch (err) {
    console.error('[submissions] query failed:', err.message);
    return res.status(500).json({ ok: false, error: 'Could not read submissions.' });
  }
});

// --- serve the marketing site from this same process ---
// One origin for the site and the API: no CORS, no mixed-content, and the
// front-end can just POST to /api/contact regardless of the domain it runs on.
if (CONFIG.serveSite) {
  const SITE_DIR = path.join(__dirname, '..');

  // The site lives in the repo root, which also contains this server folder and
  // its .env. Block both before the static handler so credentials and source can
  // never be fetched over HTTP.
  app.use('/server', (req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));

  app.use(
    express.static(SITE_DIR, {
      index: 'index.html',
      dotfiles: 'deny', // blocks /.env, /.git/..., /.gitignore
      extensions: ['html'],
    })
  );

  // Anything else that isn't an API route falls back to the single page — but
  // only for path-like URLs. A request that names a file (anything with an
  // extension) and wasn't found above is a genuine 404, not the home page;
  // returning index.html for those would produce soft-404s for search engines
  // and echo the page back for probes like /.env.
  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    const last = req.path.split('/').pop() || '';
    if (last.includes('.')) return next();
    res.sendFile(path.join(SITE_DIR, 'index.html'));
  });
}

// Bootstrap: ensure DB schema, check SMTP, then start listening.
(async function start() {
  try {
    await db.initDb();
    console.log('[startup] database ready (submissions table ensured)');
  } catch (err) {
    console.error('[startup] DATABASE CONNECTION FAILED:', err.message);
    console.error('[startup] Check DATABASE_URL / PG* env vars. Leads will use the fallback file until the DB is reachable.');
  }

  if (mailer.isEnabled()) {
    try {
      await mailer.verify();
      console.log('[startup] SMTP ready — team notifications to %s enabled', process.env.MAIL_TO);
      if (mailer.confirmationEnabled()) {
        console.log('[startup] visitor confirmation emails enabled (replies go to %s)',
          process.env.MAIL_REPLY_TO || process.env.MAIL_TO);
      } else {
        console.warn('[startup] visitor confirmation emails are OFF (SEND_CONFIRMATION=false)');
      }
    } catch (err) {
      console.error('[startup] SMTP verify failed (emails may not send):', err.message);
    }
  } else {
    console.warn('[startup] SMTP not configured — email notifications are OFF (set SMTP_HOST + MAIL_TO to enable)');
  }

  if (trustProxy === false) {
    console.warn('[startup] TRUST_PROXY is off — using the direct socket address for rate limiting.');
    console.warn('[startup] If this runs behind a proxy, CDN or PaaS router, set TRUST_PROXY=1 (or the');
    console.warn('[startup] proxy IP list) or every visitor will share one rate-limit bucket.');
  } else {
    console.log('[startup] trust proxy =', JSON.stringify(trustProxy));
  }
  if (CONFIG.allowedOrigins.includes('*')) {
    console.warn('[startup] ALLOWED_ORIGINS is "*" — pin it to your real domain(s) in production.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RideView API listening on :${PORT}`);
    if (CONFIG.serveSite) console.log(`[startup] serving the marketing site from ${path.join(__dirname, '..')}`);
  });
})();
