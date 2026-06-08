# CLAUDE.md — Plattenplausch

Guidance for AI agents (and humans) working in this repo.

## What this is
A serverless **Progressive Web App** fantasy league for the German TTBL, for a podcast
community. Users draft a 6-player team within a **100-point budget**, submit it tied to an
email (**double opt-in** confirmation), and watch a cumulative ranking. **No accounts, no
passwords, no sessions.** Teams are locked for the season once confirmed.

## Stack
- **Frontend:** Alpine.js + Vite + vite-plugin-pwa. App root is `src/`; build → `dist/`.
- **Backend:** Google Apps Script Web App (`apps-script/Code.gs`), clasp-managed.
- **Datastore:** a single Google Sheet (tabs `Submissions`, `Players`, `Scores`, `Ranking`).
- **Deploy:** GitLab Pages (`node:20-alpine` CI). Custom HTTPS domain required for the SW.

## Golden rules (do not violate)
- **Develop on Linux**, Node 20, to match CI exactly.
- **IDs only over the wire.** The client POSTs player IDs, never prices. Prices are looked up
  server-side from the `Players` sheet — the budget cannot be forged.
- **POST uses `Content-Type: text/plain`** to dodge the CORS preflight Apps Script can't answer.
- **The deadline (`SEASON_LOCK`) is enforced ONLY in `doPost`.** `doGet`/confirm must NOT
  re-check it — a late click on an already-valid row still confirms.
- **A passive GET must never confirm.** Only the button's `action=confirm` request confirms.
- **Supersession = latest-submitted confirmed team wins**, recomputed per email on every confirm.
- **Never expose email** anywhere public (ranking, HTML pages).
- **Redeploy the SAME Apps Script deployment id** (`clasp deploy -i <ID>`). A new deployment
  mints a new `/exec` URL and 404s every confirmation link already emailed.
- **Nothing secret in the repo.** Turnstile *secret* lives only in Apps Script Script
  Properties. Config comes from `VITE_*` build-time vars (see `.env.example`).
- Keep `src/config.js` roster/budget constants in sync with `apps-script/Code.gs` — the server
  is authoritative on disagreement.

## Common commands
```bash
npm run dev      # local dev server (needs .env — copy from .env.example)
npm run build    # production build → dist/
npm run preview  # serve the built dist/
node scripts/make-icons.mjs   # regenerate placeholder PWA icons
```

## Layout
```
src/            Vite app (index.html draft, ranking.html standings, *.js, players.json, style.css)
public/         static assets (PWA icons, favicon)
apps-script/    Apps Script backend (Code.gs, appsscript.json, .clasp.json.example)
scripts/        icon + players export helpers
docs/superpowers/  design spec + plans
.gitlab-ci.yml  build → pages (+ optional manual clasp deploy)
README.md       full bootstrap runbook (Sheet, Turnstile, clasp, CI vars)
```

## Bootstrap order (resolves the circular dependency)
See README.md "Runbook". Short version: Sheet → Players/players.json → Turnstile → clasp
push → clasp deploy (record stable id + /exec URL) → set CI vars → push to main.
