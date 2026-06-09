# CLAUDE.md — Plattenplausch

Guidance for AI agents (and humans) working in this repo.

## What this is
A serverless **Progressive Web App** fantasy league for the German TTBL, for a podcast
community. The season is **two independent drafts** (Hinrunde + Rückrunde); each is a fresh
6-player team within a **100-point budget**, submitted tied to an email (**double opt-in**).
The whole-season table is the **sum of both rounds, paired by email**. **No accounts, no
passwords, no sessions.** Each round's team is locked once confirmed.

## Stack
- **Frontend:** Alpine.js + Vite (plain static site — **no service worker / PWA**; it was
  removed because it served stale builds). App root is `src/`; build → `dist/`. Pages: `index.html`
  (draft), `ranking.html` (table), `confirm.html` (branded double-opt-in page).
- **Backend:** Google Apps Script Web App (`apps-script/Code.gs`), clasp-managed.
- **Datastore:** one Google Sheet (tabs `Submissions`, `Players_Hin`, `Players_Rueck`,
  `Scores_Hin`, `Scores_Rueck`, `Ranking_Gesamt`, `Ranking_Hin`, `Ranking_Rueck`). Each Scores
  sheet is numbered from `MD1` (no offset between rounds).
- **Deploy:** GitHub Pages via `.github/workflows/pages.yml` (Node 20); base path auto-derived
  from the repo name. Live: harunteper.github.io/plattenplausch/.

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
- **A passive GET/load must never confirm.** Confirmation happens only on an explicit user
  action: the `doGet` button's `action=confirm`, or the `confirm.html` button's `action:'confirm'`
  POST. Never auto-confirm on page load (email scanners prefetch links).
- **Confirm flow is the branded `confirm.html`** on Pages (so users never see Google's
  "unverified app" warning). It POSTs `{action:'lookup'}` then `{action:'confirm'}` (text/plain)
  to `doPost`. The email link → `CONFIRM_PAGE_URL` Script Property. The old `doGet` page is a
  fallback. Keep double-opt-in intact.
- **NO service worker / PWA.** It was removed (it served stale builds → blank confirm page).
  `src/main.js` carries a kill-switch that unregisters any old SW. Do **not** re-add vite-plugin-pwa.
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
npm run smoke    # e2e smoke test against the LIVE site (pages, ranking CSV, backend)
npm run make:sheet  # regenerate plattenplausch-sheet.xlsx from players-*.json
```
Note: inline HTTP from the agent's Bash is hook-blocked — run `smoke`'s fetch logic in the
context-mode sandbox (`ctx_execute`) when verifying as the agent.

## Layout
```
src/            Vite app (index.html draft, ranking.html table, confirm.html opt-in, *.js, players-hin/rueck.json, style.css)
public/         static assets (favicon, icons)
apps-script/    Apps Script backend (Code.gs, appsscript.json, .clasp.json.example)
scripts/        make-sheet, make-icons, export-players, smoke helpers
docs/superpowers/  design spec + plans
.github/workflows/pages.yml  build Vite app → deploy to GitHub Pages
README.md       full bootstrap runbook (Sheet, Turnstile, clasp, repo Variables)
```

## Bootstrap order (resolves the circular dependency)
See README.md "Runbook" + `docs/SHEET-SETUP.md`. Short version: import sheet →
Players_Hin/Rueck + players-*.json → Turnstile → clasp push → clasp deploy (record stable id +
/exec URL) → create GitHub repo + set the 3 VITE_* repo Variables → Settings → Pages → Source =
"GitHub Actions" → push to main (Actions builds & deploys). clasp push/deploy stays a local/manual
step — CI does not run clasp.
