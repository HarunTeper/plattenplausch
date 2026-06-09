# 🏓 Plattenplausch — Table Tennis Fantasy League

A serverless **Progressive Web App** fantasy league for the German **TTBL**, built for a podcast
community. Draft a **6-player team within 100 points**, submit it tied to an email (verified by
**double opt-in**), and climb a cumulative weekly-scoring table. **No accounts, no passwords, no
sessions.** Teams are locked for the season once confirmed — set and forget.

- **Frontend:** Alpine.js + Vite + vite-plugin-pwa → static files on GitHub Pages.
- **Backend:** one Google Apps Script Web App (`doPost` / `doGet`).
- **Datastore:** one Google Sheet. No host, no SMTP, no database.

> **Develop on Linux, Node 20** (CI uses `node:20-alpine`) so local and CI stay identical.

---

## Quick start (local dev)

```bash
nvm use 20            # or any Node 20 LTS
npm ci
cp .env.example .env  # fill in the three VITE_* values (see below)
npm run dev           # http://localhost:5173
npm run build         # production build → dist/
```

For local dev the Cloudflare **test site key** `1x00000000000000000000AA` (always passes) is
already in `.env.example`. The draft page works fully offline of the backend until you wire
`VITE_WEBAPP_URL` to a real Apps Script deployment.

---

## Architecture & data flow

```
Static PWA (Alpine + Vite, GitHub Pages)
  ├─ draft team, enforce budget <= 100 live (src/draft.js)
  ├─ POST {email, teamName, players:[ids], turnstileToken, honeypot}  (text/plain — no preflight)
  │     └─▶ Apps Script doPost(): Turnstile → deadline → validate → PENDING row → confirm email
  │            click link ─▶ doGet(): click-through page ─▶ button confirms (confirmed=TRUE)
  ├─ players.json (static, in repo — exported from the Players sheet)
  └─ GET ranking via gviz/tq JSON ◀── Google Sheet "Ranking_Gesamt" tab (organizer's formulas)
```

The client sends **player IDs only, never prices** — the server looks up prices from the
`Players` sheet, so the 100-point budget can't be forged.

---

## The game (scoring) — two mini-seasons

- **Two independent drafts.** Users draft a **Hinrunde** team and, separately, a **Rückrunde**
  team — each a fresh 100-point, 6-player roster. The two teams can be completely different.
- **Two lock dates.** `HIN_LOCK` (before MD1) and `RUECK_LOCK` (before MD12). The site shows
  whichever round is currently open; both closed → a closed state. Locks live in `src/config.js`
  (`ROUNDS`) and `apps-script/Code.gs` (`HIN_LOCK`/`RUECK_LOCK`) — keep them in sync.
- **Identity = email; team name fixed per email.** Once a user confirms a team under a name, the
  other round must reuse that same name (only the roster changes). Mismatched name → rejected.
- **Scoring:** organizer enters one points value per player per matchday in the round's Scores
  sheet — `Scores_Hin` and `Scores_Rueck`, each numbered `MD1…MD11` (no offset).
- **Three standings:** **`Ranking_Hin`** (Hin team over Hin matchdays), **`Ranking_Rueck`**
  (Rück team over Rück matchdays), and **`Ranking_Gesamt`** = a user's **Hin + Rück points,
  paired by email** (missing round = 0) — the website default. Only confirmed, non-superseded
  teams appear.

---

## Google Sheet — the system of record (organizer creates this manually)

This repo ships **`plattenplausch-sheet.xlsx`** — a ready-to-import workbook with all eight tabs,
the two seeded player pools (**grouped by club**), the Hin/Rück matchday grid, and **all the
Ranking formulas already wired**. Regenerate with `npm run make:sheet`.

➡️ **Follow [`docs/SHEET-SETUP.md`](docs/SHEET-SETUP.md)** for click-by-click import, per-tab
usage, the sanity test, and where the real rosters come from (mytischtennis Vor-/Rückrunde
Meldungen — still empty as of season 26/27 prep, so wait for the finals).

The tabs at a glance:

| Tab | What it is |
| --- | --- |
| `Submissions` | Written by the backend. Header-only on import (appends land on row 2): `submittedAt, email, teamName, round, p1..p6, token, confirmed, confirmedAt, superseded`. `round` ∈ `HIN`/`RUECK`; `email` normalized; `confirmed`/`superseded` booleans. |
| `Players_Hin` / `Players_Rueck` | Per-round pools (source of truth for validation + prices): `id, name, club, position, price`. Ids prefixed `h*` / `r*` (distinct — a player may change club per round). Positions `Abwehr`/`Allrounder`/`Offensiv` (match `POSITION_RULES`). Export to `src/players-hin.json` / `src/players-rueck.json` when changed. |
| `Scores_Hin` / `Scores_Rueck` | One Scores sheet per round: `id, name, club, MD1..MD11, total` (`total`=SUM, a formula). Each numbered from MD1 (no offset); lists only that round's players. |
| `Ranking_Hin` / `Ranking_Rueck` | Per-round `rank, teamName, total` over active teams of that round. |
| `Ranking_Gesamt` | Combined `rank, teamName, total` — Hin+Rück summed per email, tie-break earliest `submittedAt` then teamName. **Never emits email.** |

Export a Players pool to its JSON when a roster changes (one per pool):
```bash
PLAYERS_URL='https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?sheet=Players_Hin&tqx=out:json' \
  OUT=players-hin.json npm run export:players
PLAYERS_URL='https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?sheet=Players_Rueck&tqx=out:json' \
  OUT=players-rueck.json npm run export:players
```

**Share/access:** keep the Sheet **restricted** (not public). The PWA reads only a `Ranking_*`
tab via the public gviz endpoint, exposing just `rank/teamName/total` — never put email in any
Ranking tab.

---

## Runbook — bootstrap order (resolves the circular dependency)

The frontend needs the `/exec` URL; the Apps Script needs the Sheet; the deploy needs the
Turnstile secret. Do it in this order:

1. **Create the Sheet** — import `plattenplausch-sheet.xlsx` (tabs `Submissions, Players_Hin,
   Players_Rueck, Scores_Hin, Scores_Rueck, Ranking_Gesamt, Ranking_Hin, Ranking_Rueck`). See
   `docs/SHEET-SETUP.md`.
2. **Fill `Players_Hin` / `Players_Rueck`**, then export → `src/players-hin.json` /
   `src/players-rueck.json` and commit (`npm run export:players` per pool, or edit by hand).
3. **Register a Cloudflare Turnstile site** → note the **site key** (public) + **secret**.
4. **Bind & push the script** (from `apps-script/`):
   ```bash
   npm install -g @google/clasp
   clasp login
   # Either clone an existing bound script, or create one bound to the Sheet:
   #   clasp clone <SCRIPT_ID>         (Extensions → Apps Script → Project Settings → IDs)
   cp .clasp.json.example .clasp.json  # put the bound scriptId in it
   clasp push
   ```
   In the Apps Script editor: **Project Settings → Script Properties** add:
   - `TURNSTILE_SECRET` = your Turnstile secret.
   - `RANKING_PAGE_URL` = your deployed `ranking.html` URL (used for the "→ Tabelle" link).
5. **Deploy the Web App** (Deploy → New deployment → **Web app**, *Execute as: me*,
   *Who has access: Anyone*). **Record the stable deployment id and the `/exec` URL.**
   On every later backend change, redeploy the **same id**:
   ```bash
   clasp push && clasp deploy -i <DEPLOYMENT_ID>
   ```
   > ⚠️ A *new* deployment mints a *new* `/exec` URL, which breaks the baked-in
   > `VITE_WEBAPP_URL` and **404s every confirmation link already emailed.**
6. **Create the prune trigger** (Apps Script editor → Triggers → Add trigger →
   `pruneUnconfirmed_` → time-driven → hour timer) so abandoned pending rows are cleaned up.
7. **Create a GitHub repo** and set the three GitHub Actions repository **Variables**
   (Settings → Secrets and variables → Actions → **Variables** tab), all non-secret:
   - `VITE_WEBAPP_URL` — the `/exec` URL from step 5.
   - `VITE_RANKING_CSV_URL` — `https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?sheet=Ranking_Gesamt`.
   - `VITE_TURNSTILE_SITE_KEY` — the Turnstile **site** key.
   - `VITE_BASE` is **auto-derived from the repo name** by the workflow (repo `plattenplausch`
     → `/plattenplausch/`; repo `<user>.github.io` → `/`), so you generally don't set it manually.
8. **Enable Pages:** Settings → Pages → **Source = "GitHub Actions"**.
9. **Push to `main`** → the `.github/workflows/pages.yml` workflow builds the Vite app and
   deploys to GitHub Pages. Configure a **custom HTTPS domain** (required for the service
   worker / installable PWA). Run the end-to-end verification below.

Thereafter:
- **Backend change:** `clasp push && clasp deploy -i <ID>` (same id).
- **Roster change:** update `Players_Hin`/`Players_Rueck`, re-export the matching
  `players-*.json`, redeploy the frontend (push).
- **Weekly:** organizer enters matchday points in `Scores_Hin` / `Scores_Rueck` (each from MD1);
  the Ranking tabs and the live table update within a few minutes.

---

## Verification (end-to-end)

**Frontend (`npm run dev`):**
- [ ] Budget meter updates live as you add/remove players.
- [ ] "Add" buttons disable at the budget limit, the roster limit (6), and position caps.
- [ ] Submit is blocked while over budget / form invalid.
- [ ] PWA installs and passes a Lighthouse PWA check (needs the production build over HTTPS).

**Apps Script (Web App + editor):**
- [ ] Missing/invalid Turnstile token → `{ok:false}`, **no row written**.
- [ ] Non-empty honeypot → `{ok:false}`, no row.
- [ ] Valid submit → a `PENDING` row appears and a confirm email arrives (check spam).
- [ ] A **passive GET** of the link does **not** confirm; only the button does.
- [ ] Two teams, same email, same round, later `submittedAt`, both confirmed → the **earlier**
      becomes `superseded=TRUE` (supersession is scoped per round).
- [ ] Confirming an **earlier**-submitted team *after* a later one (same round) is already
      confirmed → the earlier one stays `superseded=TRUE` (latest-submitted wins).
- [ ] **Name-lock:** after confirming a team, submitting the other round with a *different* team
      name → `{ok:false}` (same name accepted, any case). Picks may differ.
- [ ] **Round resolution:** before `HIN_LOCK` a submit is stored `round=HIN`; between the locks
      `round=RUECK`; after `RUECK_LOCK` → rejected. A late **confirm** of a valid row still works.
- [ ] `Foo@x.com` and `foo@x.com` are treated as the same identity (and pair in Gesamt).
- [ ] Over-budget / unknown player / wrong-round player / prices-in-payload → `{ok:false}`, no row.

**Ranking:**
- [ ] Sample `Scores`: `Ranking_Hin`/`Ranking_Rueck` show the round teams' partials; a user with
      a Hin **and** a Rück team appears **once** in `Ranking_Gesamt` with the **sum**; a user with
      only one round appears with that round's points (other = 0). `ranking.html` shows
      `rank/teamName/total` (no emails), tie-break by earliest `submittedAt`.

**CI:**
- [ ] Push to `main` → Pages publishes over HTTPS; full flow (draft → submit → email → confirm
      → appears in the table after a result) works against the live Web App.

---

## Privacy & operational notes (German audience)

- **GDPR:** the draft form has a consent checkbox + short privacy note. We store email,
  teamName, and picks only to run the league; the Sheet stays access-restricted; **purge email
  addresses after the season.**
- **Email deliverability:** `MailApp` sends from the organizer's Gmail (no SPF/DKIM) → mails may
  land in spam. The success message and this README tell users to check spam.
- **No post-submit self-service** (the trade-off of no accounts): the confirmation email is the
  user's only receipt.
- **MailApp quota:** consumer Gmail is ≈ **100 emails/day**. The backend enforces hourly/daily
  send ceilings (`MAIL_CEILING_HOUR` / `MAIL_CEILING_DAY`) and a per-email pending rate limit so
  abuse can't exhaust the quota.

---

## Repo layout

```
/                  Vite frontend (src/, public/, vite.config.js)
/apps-script/      clasp backend (Code.gs, appsscript.json, .clasp.json.example)
/scripts/          icon + players export helpers
/docs/superpowers/ design spec
.github/workflows/pages.yml  build Vite app → deploy to GitHub Pages
CLAUDE.md          agent/contributor guidance
```

*Plattenplausch is a fan project of the podcast community and is not affiliated with the TTBL.*
