# Ride View — Marketing Site

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
- **Contact form ("Partner with us"):** powered by our own backend in `server/` (Node.js + Express). The form POSTs to `/api/contact`, which validates the submission, stores it in **PostgreSQL**, and **emails your team** a notification (via SMTP). See `server/README.md` for how to run, configure the database and email, and deploy it. A `docker-compose.yml` in this folder spins up a local Postgres for development, and `npm run check` (in `server/`) verifies your DB + email config. In `main.js`, point the `API` base URL at wherever the backend runs in production.

## Notes
- Default theme is dark (the brand look); a light mode toggle is in the header.
- Stats in the Vision section come from the pitch deck — update them in `index.html` as needed.
