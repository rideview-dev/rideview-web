/**
 * Ride View — "Partner with us" backend
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
};

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

// very light in-memory rate limit (per-IP, 5 requests / 10 min)
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 5;
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    return res.status(429).json({ ok: false, error: 'Too many submissions. Please try again later.' });
  }
  arr.push(now);
  hits.set(ip, arr);
  next();
}

// --- helpers ---
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
    const { name, email, company, _gotcha } = req.body || {};

    // honeypot: bots fill hidden fields; humans don't
    if (_gotcha) return res.json({ ok: true });

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ ok: false, error: 'Please enter your name.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    }

    const lead = {
      name: String(name).trim(),
      email: String(email).trim(),
      company: String(company || '').trim(),
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      userAgent: req.headers['user-agent'] || '',
    };

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

    // 2) Email the team a notification. Never block the response on this.
    const entry = stored || { received_at: new Date().toISOString(), ...lead };
    try {
      const result = await mailer.sendLeadNotification(entry);
      if (result.sent) console.log('[contact] notification emailed:', result.messageId);
    } catch (mailErr) {
      console.error('[contact] email failed (lead is still saved):', mailErr.message);
    }

    return res.json({ ok: true, stored: Boolean(stored) });
  } catch (err) {
    console.error('[contact] error:', err.message);
    return res.status(500).json({ ok: false, error: 'Could not save right now. Please email support@rideview.ca.' });
  }
});

// Protected: list stored submissions as JSON. Disabled unless ADMIN_TOKEN is set.
// Call with header  Authorization: Bearer <ADMIN_TOKEN>  or  ?token=<ADMIN_TOKEN>
app.get('/api/submissions', async (req, res) => {
  if (!CONFIG.adminToken) return res.status(404).json({ ok: false, error: 'Not found.' });
  const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token || '';
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

// Optionally serve the static site from this same server (so front-end and
// API share one origin). Place the site files in ../ and uncomment:
// app.use(express.static(path.join(__dirname, '..')));

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
      console.log('[startup] SMTP ready — lead notifications enabled');
    } catch (err) {
      console.error('[startup] SMTP verify failed (emails may not send):', err.message);
    }
  } else {
    console.warn('[startup] SMTP not configured — email notifications are OFF (set SMTP_HOST + MAIL_TO to enable)');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ride View API listening on :${PORT}`);
  });
})();
