# RideView — Marketing Site

A single-page marketing site. Plain HTML/CSS/JS — no build step, no dependencies.

## Files
- `index.html` — all page content and structure
- `styles.css` — design system + all styles (brand colors are CSS variables near the top: `--brand`, `--brand-2`)
- `main.js` — theme toggle, sticky header, scroll reveal animations
- `assets/img/` — hero, tablet, motion, and city background images

## Run it locally (VS Code)
1. Open this folder in VS Code (File → Open Folder).
2. Easiest preview: install the **Live Server** extension, then right-click `index.html` → "Open with Live Server". It auto-refreshes as you edit.
3. Or just double-click `index.html` to open it in your browser.

## Common edits
- **Text/copy:** edit directly in `index.html`.
- **Brand colors:** change `--brand` / `--brand-2` at the top of `styles.css`.
- **Images:** drop replacements into `assets/img/` (keep the same filenames, or update the `src` paths in `index.html`).
- **Logo:** there are two artwork files and CSS picks one per theme — `logo-dark.png` is the light-on-dark version shown on the **dark** theme, `logo-white.png` is the dark-on-light version shown on the **light** theme (the names describe the background they sit on). Both need a transparent background. `favicon.png` / `favicon-32.png` are generated from the mark.
- **Contact form ("Partner with us"):** powered by our own backend in `server/` (Node.js + Express). The form POSTs to `/api/contact`, which validates the submission, stores it in **PostgreSQL**, and **emails your team** a notification (via SMTP). See `server/README.md` for how to run, configure the database and email, and deploy it. A `docker-compose.yml` in this folder spins up a local Postgres for development, and `npm run check` (in `server/`) verifies your DB + email config.

## Run the whole thing (site + form backend)
From the **repo root**:

```bash
npm install     # also installs server/ dependencies
npm run check   # verify the database + email config
npm start       # http://localhost:8000
```

These delegate to `server/`, so a host that builds from the repo root works without
extra configuration. You can still run the same commands inside `server/` directly.

## Deploying (important)
The site and the API ship **together**. `server/server.js` serves these static files
itself, so in production you deploy the whole repo as one Node app and the form posts
to `/api/contact` on the same domain — no CORS, no mixed-content, and no
per-environment URL to edit.

Deploying `index.html` on its own to a static host leaves the form with nowhere to
post to. If you must host the static files separately, see "Connecting the website"
in `server/README.md`.

## Notes
- Default theme is dark (the brand look); a light mode toggle is in the header.
- Stats in the Vision section come from the pitch deck — update them in `index.html` as needed.
