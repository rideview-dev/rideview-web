# Ride View — "Partner with us" Backend

A small Node.js + Express server that receives partner-form submissions,
validates them, **stores each lead in PostgreSQL**, and **emails your team**
a notification.

## What it does
- `POST /api/contact` — accepts `{ name, email, company }`, validates, stores it in Postgres, and emails you.
- `GET /api/submissions` — returns stored leads as JSON (protected; only enabled if `ADMIN_TOKEN` is set).
- `GET /api/health` — health check (also reports whether email is configured).
- Built-in: input validation, a honeypot anti-spam field, and basic per-IP rate limiting.

## How a submission flows
1. The form POSTs JSON to `/api/contact`.
2. The lead is inserted into the `submissions` table in PostgreSQL (the system of record).
3. Your team is emailed a notification (reply goes straight to the lead's address).

**Safety net:** if the database is ever unreachable, the lead is appended to
`data/failed-submissions.jsonl` so it is never lost, and the email is still
attempted. Email is only a notification, so an SMTP problem never blocks a
submission.

## Database
On startup the server connects to Postgres and creates this table if it
doesn't already exist (no manual migration needed):

```
submissions(id, received_at, name, email, company, ip, user_agent)
```

Configure the connection with **either** a single `DATABASE_URL`
(`postgres://user:pass@host:5432/dbname`) **or** the standard `PGHOST` /
`PGUSER` / `PGPASSWORD` / `PGDATABASE` / `PGPORT` variables. Set `PGSSL=require`
for managed/cloud databases that require SSL.

## Email
Email uses plain SMTP via Nodemailer, so the same config works with your mail
host, Gmail/Outlook, or a transactional provider (Resend, SendGrid, Mailgun —
all expose SMTP). Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`MAIL_TO`, and `MAIL_FROM` in `.env`. Leave `SMTP_HOST` or `MAIL_TO` blank to
turn email off (leads still save to the database). See `.env.example` for a
per-provider quick reference.

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
Submit the form and you'll see a new row in the `submissions` table and an
email land in your inbox. Startup logs tell you whether the DB and SMTP
connected successfully.

## Reading your leads
1. Query the `submissions` table directly with any Postgres client.
2. Set `ADMIN_TOKEN` in `.env`, then GET `/api/submissions` with header
   `Authorization: Bearer <token>` (or `?token=<token>`) to get JSON. If
   `ADMIN_TOKEN` is left blank, this endpoint is disabled for safety.

## Connecting the website
The front-end form (`../index.html` + `../main.js`) POSTs JSON to `/api/contact`.
In `../main.js`, set the `API` base URL to wherever this server runs in
production, e.g. `https://api.rideview.ca`. During local dev it defaults to
`http://localhost:8000`.

## Deploying
Standard Express app — runs anywhere Node runs (a VPS behind nginx, a container,
or a platform like Render/Railway). Set the environment variables from
`.env.example` in your host's config, point it at your Postgres instance, and
restrict `ALLOWED_ORIGINS` to your real domain in production.

## Environment variables
| Variable | Purpose |
| --- | --- |
| `PORT` | Port to listen on (default 8000) |
| `ALLOWED_ORIGINS` | Comma-separated allowed origins, or `*` |
| `DATA_DIR` | Folder for the DB-failure fallback file (default `server/data`) |
| `ADMIN_TOKEN` | Token for the `/api/submissions` endpoint (blank = disabled) |
| `DATABASE_URL` | Postgres connection string (or use the `PG*` vars) |
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | Discrete Postgres settings |
| `PGSSL` | Set to `require` for managed Postgres that needs SSL |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | SMTP server + credentials |
| `MAIL_TO` | Recipient(s) of lead notifications (comma-separated) |
| `MAIL_FROM` | From address on the notification |
