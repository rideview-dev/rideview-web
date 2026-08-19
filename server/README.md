# RideView — "Partner with us" Backend

A small Node.js + Express server that receives partner-form submissions,
validates them, **stores each lead in PostgreSQL**, and **emails your team**
a notification.

## What it does
- `POST /api/contact` — accepts `{ name, email, company }`, validates, stores it in Postgres, and emails you.
- `GET /api/submissions` — returns stored leads as JSON (protected; only enabled if `ADMIN_TOKEN` is set).
- `GET /api/health` — health check (also reports whether email is configured).
- Serves the marketing site from the project root, so the site and API share one origin.
- Built-in: input validation, a honeypot anti-spam field, and per-IP rate limiting.
  Only **accepted** submissions count against the limit — a visitor who mistypes
  their email is never locked out.

## How a submission flows
1. The form POSTs JSON to `/api/contact` (including the language the visitor was reading in).
2. The lead is inserted into the `submissions` table in PostgreSQL (the system of record).
3. **Two emails go out, both from `MAIL_FROM` (dev@rideview.ca):**
   - a notification to your team at `MAIL_TO` (sales@rideview.ca) — Reply-To is the
     lead, so hitting reply writes straight to them;
   - a confirmation to the visitor — "thanks, we'll be in touch" — written in the
     language they used on the site (en/fr/es/ru/ar, right-to-left for Arabic).
     Reply-To is `MAIL_REPLY_TO`, so their reply lands with sales rather than in a
     technical mailbox.

   The two are sent independently: if one fails the other still goes, and neither
   can block or fail the submission. Set `SEND_CONFIRMATION=false` to send only
   the internal notification.

**Safety net:** if the database is ever unreachable, the lead is appended to
`data/failed-submissions.jsonl` so it is never lost, and the email is still
attempted. Email is only a notification, so an SMTP problem never blocks a
submission.

## Database
On startup the server connects to Postgres and creates this table if it
doesn't already exist (no manual migration needed):

```
submissions(id, received_at, name, email, company, lang, ip, user_agent)
```

Schema changes are applied additively on every startup, so upgrading an existing
database needs no manual migration — the `lang` column is added automatically if
it isn't there.

Configure the connection with **either** a single `DATABASE_URL`
(`postgres://user:pass@host:5432/dbname`) **or** the standard `PGHOST` /
`PGUSER` / `PGPASSWORD` / `PGDATABASE` / `PGPORT` variables. Set `PGSSL=require`
for managed/cloud databases that require SSL.

## Email
Email uses plain SMTP via Nodemailer, so the same config works with your mail
host, Microsoft 365 / Gmail, or a transactional provider (Resend, SendGrid,
Mailgun — all expose SMTP). Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `MAIL_TO`, `MAIL_FROM` and `MAIL_REPLY_TO` in `.env`. Leave
`SMTP_HOST` or `MAIL_TO` blank to turn email off (leads still save to the
database). See `.env.example` for a per-provider quick reference.

The confirmation copy for each language lives in the `CONFIRMATION` object at the
top of `mailer.js` — edit the wording there, not in the send functions.

To test the mail path without submitting the form or writing to the database:

```bash
npm run mail:test -- you@example.com        # confirmation in English
npm run mail:test -- you@example.com ar     # confirmation in Arabic
```

It verifies the SMTP credentials first and sends nothing if they fail, then sends
both messages — the team notification to `MAIL_TO` and the confirmation to the
address you pass. Exit code is 0 only if both were accepted.

**Why not Microsoft 365?** Sending through `smtp.office365.com` requires SMTP AUTH
to be enabled for the mailbox (`Set-CASMailbox -Identity <addr>
-SmtpClientAuthenticationDisabled $false`); it is off by default and the failure
looks like `535 5.7.139 ... SmtpClientAuthentication is disabled`. It also usually
means disabling Security Defaults, and Microsoft is retiring basic auth for SMTP
AUTH at the end of 2026 — so this project sends through Resend instead. Receiving
mail at rideview.ca is untouched and still runs on Microsoft 365.

## Run locally
```bash
# (optional) start a local Postgres with Docker — credentials match the
# DATABASE_URL shown in .env.example:
docker compose up -d           # run from the project root

cd server
npm install
cp .env.example .env      # fill in DATABASE_URL (or PG* vars) and SMTP settings
npm run check             # verify the DB connection + SMTP before you start
npm start                 # http://localhost:8000
```

The project root has a `package.json` that forwards `install` / `check` / `start`
here, so `npm start` from the repo root does the same thing — handy because most
deploy platforms build from the root.
Submit the form and you'll see a new row in the `submissions` table and an
email land in your inbox. Startup logs tell you whether the DB and SMTP
connected successfully.

## Reading your leads
1. Query the `submissions` table directly with any Postgres client.
2. Set `ADMIN_TOKEN` in `.env`, then GET `/api/submissions` with header
   `Authorization: Bearer <token>` (or `?token=<token>`) to get JSON. If
   `ADMIN_TOKEN` is left blank, this endpoint is disabled for safety.

## Connecting the website
**This server serves the marketing site itself** (`SERVE_SITE=true`, the default).
The static files in the project root are served from the same origin as the API,
so the front-end simply POSTs to `/api/contact` on whatever domain you deploy to.
No CORS, no mixed-content, and nothing in `main.js` to edit per environment.

`server/` and dotfiles (`.env`, `.git`) are explicitly excluded from what gets
served, so deploying the repo does not expose your credentials or source.

If you'd rather host the static site separately (a CDN, GoDaddy, Netlify), set
`SERVE_SITE=false`, give this server its own HTTPS hostname, and replace the
`__PORT_8000__` placeholder in `../main.js` with that origin at build time. It
**must** be HTTPS — an HTTPS page cannot POST to an `http://` API; the browser
blocks it as mixed content.

## Deploying
Standard Express app — runs anywhere Node runs (a VPS behind nginx, a container,
or a platform like Render/Railway). Set the environment variables from
`.env.example` in your host's config and point it at your Postgres instance.

Two settings matter on first deploy:

- **`TRUST_PROXY`** — leave blank when the process is exposed directly. Set it to
  `1` behind a single proxy/CDN/PaaS router (Render, Railway, Fly, nginx), or to a
  list of trusted proxy IPs. Too trusting and a client can spoof its IP to bypass
  the rate limit; not trusting enough and every visitor shares one bucket.
- **`ALLOWED_ORIGINS`** — pin to your real domains. Only relevant when
  `SERVE_SITE=false`.

Run `npm run check` on the deployed host before trusting it — it verifies the
database connection and SMTP credentials from where the app actually runs.

## Environment variables
| Variable | Purpose |
| --- | --- |
| `PORT` | Port to listen on (default 8000) |
| `SERVE_SITE` | Serve the marketing site from this process (default `true`) |
| `TRUST_PROXY` | Reverse-proxy hops to trust for the client IP (blank = none) |
| `RATE_LIMIT_MAX` | Accepted submissions per IP per 10 min (default 10) |
| `ALLOWED_ORIGINS` | Comma-separated allowed origins, or `*` (only used when `SERVE_SITE=false`) |
| `DATA_DIR` | Folder for the DB-failure fallback file (default `server/data`) |
| `ADMIN_TOKEN` | Token for the `/api/submissions` endpoint (blank = disabled) |
| `DATABASE_URL` | Postgres connection string (or use the `PG*` vars) |
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | Discrete Postgres settings |
| `PGSSL` | Set to `require` for managed Postgres that needs SSL |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | SMTP server + credentials |
| `MAIL_TO` | Recipient(s) of the internal lead notification (comma-separated) |
| `MAIL_FROM` | From address on both emails |
| `MAIL_REPLY_TO` | Where replies to the visitor's confirmation land (defaults to `MAIL_TO`) |
| `SEND_CONFIRMATION` | Send the visitor a confirmation email (default `true`) |
