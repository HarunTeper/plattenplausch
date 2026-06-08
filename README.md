# 🏓 Plattenplausch — Table Tennis Fantasy League

A serverless **Progressive Web App** fantasy league for the German **TTBL**, built for a podcast
community. Draft a **6-player team within 100 points**, submit it tied to an email (verified by
**double opt-in**), and climb a cumulative weekly-scoring table. **No accounts, no passwords, no
sessions.** Teams are locked for the season once confirmed — set and forget.

- **Frontend:** Alpine.js + Vite + vite-plugin-pwa → static files on GitLab Pages.
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
Static PWA (Alpine + Vite, GitLab Pages)
  ├─ draft team, enforce budget <= 100 live (src/draft.js)
  ├─ POST {email, teamName, players:[ids], turnstileToken, honeypot}  (text/plain — no preflight)
  │     └─▶ Apps Script doPost(): Turnstile → deadline → validate → PENDING row → confirm email
  │            click link ─▶ doGet(): click-through page ─▶ button confirms (confirmed=TRUE)
  ├─ players.json (static, in repo — exported from the Players sheet)
  └─ GET ranking via gviz/tq JSON ◀── Google Sheet "Ranking" tab (organizer's formulas)
```

The client sends **player IDs only, never prices** — the server looks up prices from the
`Players` sheet, so the 100-point budget can't be forged.

---

## The game (scoring)

- The organizer enters **one points value per player per matchday** in the `Scores` tab.
- A team's weekly score = sum of its players' points; the season score is cumulative.
- The `Ranking` tab joins each **active** team's picks to each player's season total, sums, and
  sorts. Only **confirmed, non-superseded** teams appear.

---

## Google Sheet — the system of record (organizer creates this manually)

> **Shortcut:** this repo ships **`plattenplausch-sheet.xlsx`** — a ready-to-import workbook with
> all four tabs, your seeded players, the matchday grid, and the Ranking formulas already wired.
> See **[`docs/SHEET-SETUP.md`](docs/SHEET-SETUP.md)** for click-by-click import + usage. The
> manual spec below documents what that file contains. Regenerate it with `npm run make:sheet`.

Create one Google Sheet with **four tabs**. The Apps Script is **bound** to this Sheet.

### `Submissions`
Header row (the script auto-creates it on first write, but you can pre-create it):

```
submittedAt | email | teamName | p1 | p2 | p3 | p4 | p5 | p6 | token | confirmed | confirmedAt | superseded
```

- `email` is stored **normalized** (`trim().toLowerCase()`).
- Each pick is its **own column** (`p1..p6`), not a CSV string — keeps the Ranking join clean.
- `confirmed` / `superseded` are booleans; `Ranking` only counts `confirmed=TRUE AND superseded=FALSE`.

### `Players` (single source of truth for validation & prices)
```
id | name | club | position | price
p001 | Dang Qiu | Borussia Düsseldorf | Offensiv | 28
...
```
Positions used by the position limits: `Abwehr`, `Allrounder`, `Offensiv` (see
`POSITION_RULES` in both `src/config.js` and `apps-script/Code.gs`).

Export this tab to `src/players.json` and commit it whenever the roster changes:
```bash
PLAYERS_URL='https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?sheet=Players&tqx=out:json' \
  npm run export:players
```
(Or edit `src/players.json` by hand — the seed file ships with sample TTBL players.)

### `Scores`
One row per player, one column per matchday:
```
id | name | MD1 | MD2 | MD3 | ... | playerTotal
p001 | Dang Qiu | 18 | 12 | 0 | ... | =SUM(C2:?2)
```
`playerTotal` = sum of the `MD*` columns.

### `Ranking` (formulas — organizer authors these)
Output exactly three columns: `rank`, `teamName`, `total`. **Never emit email.**

For each **active** entry (`confirmed=TRUE AND superseded=FALSE`), join `p1..p6` to
`Scores.playerTotal`, sum, then sort descending. Tie-break by **earliest `submittedAt`**, then
alphabetical `teamName`.

A `SUMPRODUCT`/`XLOOKUP` sketch for one team's total (row-wise over the active set):
```
=SUMPRODUCT( IFERROR( XLOOKUP(Submissions!D2:I2, Scores!A:A, Scores!playerTotalCol), 0 ) )
```
Filter to active rows with a helper column `=AND(K2=TRUE, M2=FALSE)` (confirmed & not
superseded), compute each active team's total, then use `SORT`/`RANK` to produce
`rank | teamName | total`. Keep the layout so the gviz endpoint returns those labels.

**Share/access:** keep the Sheet **restricted** (not public). The PWA reads `Ranking` via the
public gviz endpoint, which exposes only what that tab outputs (rank/teamName/total) — so never
put email in `Ranking`.

---

## Runbook — bootstrap order (resolves the circular dependency)

The frontend needs the `/exec` URL; the Apps Script needs the Sheet; the deploy needs the
Turnstile secret. Do it in this order:

1. **Create the Sheet** with tabs `Submissions, Players, Scores, Ranking`.
2. **Fill `Players`**, then export → `src/players.json` and commit
   (`npm run export:players`, or edit by hand).
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
7. **Set GitLab CI/CD variables** (Settings → CI/CD → Variables), all non-secret:
   - `VITE_WEBAPP_URL` — the `/exec` URL from step 5.
   - `VITE_RANKING_CSV_URL` — `https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?sheet=Ranking`.
   - `VITE_TURNSTILE_SITE_KEY` — the Turnstile **site** key.
   - (optional) `VITE_BASE` if not using a custom domain (e.g. `/plattenplausch/`).
8. **Push to `main`** → the `pages` job publishes. Configure a **custom HTTPS domain**
   (required for the service worker / installable PWA). Run the end-to-end verification below.

Thereafter:
- **Backend change:** `clasp push && clasp deploy -i <ID>` (same id).
- **Roster change:** update `Players`, re-export `players.json`, redeploy the frontend (push).
- **Weekly:** organizer enters matchday points in `Scores`; the `Ranking` tab and the live
  table update within a few minutes.

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
- [ ] Two teams, same email, later `submittedAt`, both confirmed → the **earlier** becomes
      `superseded=TRUE`.
- [ ] Confirming an **earlier**-submitted team *after* a later one is already confirmed → the
      earlier one stays `superseded=TRUE` (latest-submitted wins).
- [ ] Submit after `SEASON_LOCK` → rejected. A late **confirm** of a valid row still works.
- [ ] `Foo@x.com` and `foo@x.com` are treated as the same identity.
- [ ] Over-budget / unknown player / prices-in-payload → `{ok:false}`, no row
      (payload prices are ignored; server looks them up).

**Ranking:**
- [ ] Sample `Scores` → `Ranking` sums correctly; `ranking.html` shows `rank/teamName/total`
      (no emails), only active confirmed teams, tie-break by earliest `submittedAt`.

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
.gitlab-ci.yml     build → pages (+ optional manual clasp deploy)
CLAUDE.md          agent/contributor guidance
```

*Plattenplausch is a fan project of the podcast community and is not affiliated with the TTBL.*
