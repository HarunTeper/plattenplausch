# Plattenplausch — Table Tennis Fantasy League (Design)

> Approved design provided by the user. Implemented as-is. This file is the system of record for intent.

## Goal
A serverless PWA fantasy league for the German TTBL, for a podcast community. Users draft a
team within a 100-point budget, submit tied to an email (double opt-in confirmation), and view a
cumulative ranking. No accounts, no passwords, no sessions. Teams locked for the season.

## Architecture & data flow
```
Static PWA (Alpine + Vite + vite-plugin-pwa, GitLab Pages)
  ├─ draft team, enforce budget <=100 live
  ├─ POST team JSON ─▶ Apps Script doPost(): validate, write PENDING row, email opt-in link
  │                     click link ─▶ doGet(): click-through page ─▶ confirm action sets confirmed=TRUE
  ├─ players.json (static, in repo)
  └─ GET ranking (gviz/tq) ◀── Google Sheet "Ranking" tab (organizer's formulas)
```

- UI POSTs `{email, teamName, players:[ids], turnstileToken, honeypot}` — **IDs only, never prices**.
- POST uses `Content-Type: text/plain` to avoid CORS preflight Apps Script can't answer.

## Scoring model
- Per-player weekly points entered by organizer (one value per player per matchday).
- Team weekly score = sum of its players' points; season score = cumulative.
- Sheet `Scores`: one row per player, one column per matchday (`MD1…`), `playerTotal = sum`.
- Each pick stored in its own column in `Submissions` (`p1..pN`, fixed roster size).

## Roster / budget config (constants)
- Budget: 100 points.
- Roster size: 6 players (fixed → columns p1..p6).
- Position limits: configurable constants shared conceptually between front and back end.

## Frontend (repo root = Vite app)
- `src/index.html` draft page, `src/ranking.html` standings page.
- `src/main.js` Alpine init; `src/draft.js`, `src/ranking.js` components.
- `src/players.json` roster `[{id,name,club,position,price}]` (seed sample TTBL players).
- `src/style.css` — sports-broadcast aesthetic: TT orange + ITTF blue, condensed scoreboard
  display font + clean grotesk body, tactile 100-point budget meter hero.
- `public/icons/...` placeholder PWA icons.
- `vite.config.js` with vite-plugin-pwa (manifest + service worker).

### Reactivity
- `x-data` holds `selected[]`; `spent = sum(prices)`, `remaining = 100 - spent`.
- Add buttons `:disabled` when `price > remaining` or roster full / position limit hit.
- Submit blocked while over budget/invalid (server re-validates regardless).

### Form
- Required team name; GDPR consent checkbox + short privacy note; hidden honeypot;
  Cloudflare Turnstile widget; token included in payload; reset widget on submit; handle
  `expired-token` with friendly retry + re-render.

### Ranking page
- Fetch gviz/tq JSON; parse; render `rank/teamName/total` (never email); show "last updated";
  tell users standings update within a few minutes; degrade gracefully with SW-cached last view.

### Offline submit
- PWA caches shell; submit needs network; on fetch failure show clear offline state; never show
  false "confirmed".

### Config injection
- `VITE_WEBAPP_URL`, `VITE_RANKING_CSV_URL` (gviz), `VITE_TURNSTILE_SITE_KEY` via
  `import.meta.env`. `.env.example` provided; nothing secret committed.

## Backend (Google Apps Script, clasp-managed)
- `apps-script/Code.gs`, `appsscript.json`, `.clasp.json.example` (real `.clasp.json` gitignored).
- Deploy as Web App: Execute as me, Anyone can access.

### doPost(e)
1. Parse JSON from `e.postData.contents`.
2. Verify Turnstile token (UrlFetchApp → siteverify, secret from Script Properties).
3. Reject if honeypot non-empty.
4. Normalize email `trim().toLowerCase()`.
5. Validate: email format; teamName present/length-bounded/profanity; player IDs exist in
   `Players`; `sum(prices) <= 100` with prices looked up server-side; roster size & position
   rules; deadline `SEASON_LOCK` not passed (ONLY place deadline enforced).
6. On failure `{ok:false,error}`. Else gen `Utilities.getUuid()` token; append
   `[submittedAt,email,teamName,p1..pN,token,confirmed=FALSE,confirmedAt,superseded=FALSE]`;
   send confirm-link email via MailApp; return `{ok:true}`.

### doGet(e)
- Render click-through page for the token (shows team + "Confirm my team" button).
- Passive GET must NOT confirm — only the button's action confirms.
- doGet must NOT re-check deadline (late click on valid row still confirms).

### Confirm action
- Set `confirmed=TRUE` + `confirmedAt`. Recompute supersession for that normalized email:
  among confirmed rows, latest `submittedAt` is active (`superseded=FALSE`), all others
  `superseded=TRUE`. Friendly HTML if token missing/already confirmed; link back to ranking.

### Concurrency & anti-abuse
- Wrap row writes + supersession recompute in `LockService.getScriptLock()`.
- Turnstile + honeypot; per-email rate limit (reject > N pending/hour); global hourly/daily
  MailApp send ceiling; unconfirmed rows excluded from ranking + auto-pruned via time trigger.

## Google Sheet (system of record; organizer creates manually; documented in README)
- `Submissions`: submittedAt, email(normalized), teamName, p1..pN, token, confirmed,
  confirmedAt, superseded.
- `Players`: roster + prices; single source of truth; exported to players.json.
- `Scores`: one row per player, one column per matchday; playerTotal = sum.
- `Ranking`: join each active (`confirmed=TRUE AND superseded=FALSE`) entry's p1..pN to
  Scores.playerTotal, sum, sort desc → rank/teamName/total. Never emit email. Tie-break by
  earliest submittedAt, then alphabetical teamName.

## CI/CD (GitLab)
- build (node:20-alpine): `npm ci && npm run build`; artifact dist.
- pages: `mv dist public`; artifact public; only on main.
- deploy_script (optional/manual): `npx clasp push`; redeploy SAME deployment id.

## Edge cases
- Email is identity key — normalize everywhere.
- GDPR: consent + privacy note + retention; restrict sheet; purge after season.
- MailApp from organizer Gmail (no SPF/DKIM) → may land in spam; tell users to check spam.
- No post-submit self-service; confirm email is the receipt.
- MailApp quota consumer Gmail ≈ 100/day; documented.
