# CLAUDE.md — Plattenplausch

Guidance for AI agents (and humans) working in this repo.

## What this is
A serverless **Progressive Web App** fantasy league for the German TTBL, for a podcast
community. The season is **two independent drafts** (Hinrunde + Rückrunde); each is a fresh
6-player team within a **100-point budget**, submitted tied to an email (**double opt-in**).
The whole-season table is the **sum of both rounds, paired by email**. **No accounts, no
passwords, no sessions.** Each round's team is locked once confirmed.

## Stack
- **Frontend:** Alpine.js + Vite + vite-plugin-pwa. App root is `src/`; build → `dist/`.
- **Backend:** Google Apps Script Web App (`apps-script/Code.gs`), clasp-managed.
- **Datastore:** one Google Sheet (tabs `Submissions`, `Players_Hin`, `Players_Rueck`, `Scores`,
  `Ranking_Gesamt`, `Ranking_Hin`, `Ranking_Rueck`).
- **Deploy:** GitLab Pages (`node:20-alpine` CI). Custom HTTPS domain required for the SW.

## Golden rules (do not violate)
- **Develop on Linux**, Node 20, to match CI exactly.
- **Two rounds.** Round is resolved SERVER-SIDE from `HIN_LOCK`/`RUECK_LOCK` in `Code.gs` (the
  client's `round` is a hint). Per-round pools `Players_Hin`/`Players_Rueck` with distinct
  `h*`/`r*` ids (a player may change club per round). Keep locks/rules in sync with
  `src/config.js` (`ROUNDS`, `currentRoundKey`); the server is authoritative.
- **IDs only over the wire.** The client POSTs player IDs, never prices. Prices are looked up
  server-side from the round's `Players_*` sheet — the budget cannot be forged.
- **POST uses `Content-Type: text/plain`** to dodge the CORS preflight Apps Script can't answer.
- **The deadline is enforced ONLY in `doPost`** (via round resolution). `doGet`/confirm must NOT
  re-check it — a late click on an already-valid row still confirms.
- **A passive GET must never confirm.** Only the button's `action=confirm` request confirms.
- **Team name is fixed per email** across the whole season (first confirmed name wins; mismatch
  rejected). Only the roster changes per round.
- **Supersession = latest-submitted confirmed team wins, scoped per (email, round)**, recomputed
  on every confirm. Gesamt pairs the two rounds by email.
- **Never expose email** anywhere public (ranking, HTML pages); it's a join key only.
- **Redeploy the SAME Apps Script deployment id** (`clasp deploy -i <ID>`). A new deployment
  mints a new `/exec` URL and 404s every confirmation link already emailed.
- **Nothing secret in the repo.** Turnstile *secret* lives only in Apps Script Script
  Properties. Config comes from `VITE_*` build-time vars (see `.env.example`).

## Common commands
```bash
npm run dev      # local dev server (needs .env — copy from .env.example)
npm run build    # production build → dist/
npm run preview  # serve the built dist/
node scripts/make-icons.mjs   # regenerate placeholder PWA icons
```

## Layout
```
src/            Vite app (index.html draft, ranking.html standings, *.js, players-hin/rueck.json, style.css)
public/         static assets (PWA icons, favicon)
apps-script/    Apps Script backend (Code.gs, appsscript.json, .clasp.json.example)
scripts/        icon + players export helpers
docs/superpowers/  design spec + plans
.gitlab-ci.yml  build → pages (+ optional manual clasp deploy)
README.md       full bootstrap runbook (Sheet, Turnstile, clasp, CI vars)
```

## Bootstrap order (resolves the circular dependency)
See README.md "Runbook" + `docs/SHEET-SETUP.md`. Short version: import sheet →
Players_Hin/Rueck + players-*.json → Turnstile → clasp push → clasp deploy (record stable id +
/exec URL) → set CI vars → push to main.
