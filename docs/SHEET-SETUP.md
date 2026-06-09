# Google Sheet setup — step by step

This repo ships a ready-to-import workbook: **`plattenplausch-sheet.xlsx`** (regenerate any time
with `npm run make:sheet`). It contains all eight tabs with the right headers, your seeded
players (two pools), the per-round Scores grids, and **all the Ranking formulas already written**.
You mostly just import it and fill in points.

**The season is two independent drafts** (Hinrunde + Rückrunde), each a fresh 100-point team.
The whole-season table (`Ranking_Gesamt`) is the **sum of a user's Hin and Rück points, paired by
their email**.

> Regenerate after editing `src/players-hin.json` / `src/players-rueck.json`:
> `npm run make:sheet` re-seeds both Players tabs + Scores.

---

## 1. Import the workbook into Google Sheets

1. Go to <https://sheets.google.com> → **Blank spreadsheet** (or use an existing one).
2. **File → Import → Upload** → drop `plattenplausch-sheet.xlsx`.
3. In the import dialog choose **"Replace spreadsheet"** (cleanest — gives you exactly these
   tabs). Click **Import data**.
4. You now have eight tabs: **Submissions, Players_Hin, Players_Rueck, Scores_Hin, Scores_Rueck, Ranking_Gesamt,
   Ranking_Hin, Ranking_Rueck**.
5. Rename the spreadsheet to e.g. *"Plattenplausch — Liga 26/27"*.

> ⚠️ Keep the spreadsheet **private / access-restricted**. The PWA only reads a `Ranking_*` tab
> through the public gviz endpoint, which exposes just `rank/teamName/total`. Never put email in
> any Ranking tab.

---

## 2. What each tab is and what you do with it

### `Players_Hin` / `Players_Rueck` — the two roster pools (source of truth + prices)
Columns: `id | name | club | position | price`. Two tabs because the season is two drafts and a
player may change club between rounds. **Ids are prefixed per round: `h001…` in Players_Hin,
`r001…` in Players_Rueck** — distinct on purpose, so a transferred player is two listings.
- Edit names/clubs/prices per round to match the real Meldungen. **Keep `position` to one of**
  `Abwehr`, `Allrounder`, `Offensiv` (these match the position caps in the code).
- If you change players here, **also update `src/players-hin.json` / `src/players-rueck.json`** so
  the website shows the same pools — edit by hand or run the export (see README) and commit.
- `id` values must be unique across BOTH pools and stable (submissions + Scores reference them).

### `Scores_Hin` / `Scores_Rueck` — weekly points you enter (the game engine)
**One Scores sheet per round, each numbered from `MD1`** (no MD12 offset). Columns:
`id | name | club | MD1 … MD11 | total`. `Scores_Hin` lists only the `h*` players, `Scores_Rueck`
only the `r*` players (grouped by club).
- **Each matchday, open that round's sheet and type the points into `MD1`, `MD2`, …** — Hinrunde
  matchday 1 goes in `Scores_Hin!MD1`, Rückrunde matchday 1 in `Scores_Rueck!MD1`. No mental
  offset.
- `total` (`=SUM(MD1:MD11)`) is a formula — **don't edit it.**
- Different matchday count? Change `HIN_MATCHDAYS` / `RUECK_MATCHDAYS` in
  `scripts/make-sheet.mjs` and regenerate (`npm run make:sheet`). The two rounds can differ.

### `Submissions` — written by the backend (you don't type here)
Columns: `submittedAt | email | teamName | round | p1..p6 | token | confirmed | confirmedAt |
superseded` (14 columns, A–N; `round` ∈ `HIN`/`RUECK`). **Header row only** — the Apps Script
`appendRow()`s each submission onto the first empty row and flips `confirmed`/`superseded`.
- **Don't pre-fill or leave stray data below the header**, or appends would skip past it. No
  helper columns here — all computation lives in the Ranking tabs.

### `Ranking_Hin` / `Ranking_Rueck` — per-round standings
Visible `rank | teamName | total` (A–C); helper cols `active | teamTotal | submittedAt |
teamNameSrc` (E–H) are whole-column array formulas over `Submissions`:
- `active` (E) = confirmed + non-superseded + non-blank **AND `round` matches this tab**.
- `teamTotal` (F) = sum of that row's 6 picks' `total` via `XLOOKUP` into the round's Scores sheet
  (`Ranking_Hin` → `Scores_Hin`; `Ranking_Rueck` → `Scores_Rueck`).
- `B2`/`C2` `FILTER` active rows and `SORT` by total desc → submittedAt asc → teamName asc.

### `Ranking_Gesamt` — combined standings (read by the website)
Gesamt = a user's **Hin points + Rück points, paired by their email** (a missing round counts 0).
Visible `rank | teamName | total` (A–C). Helper cols (hide them):
- E–I (per Submissions row): `active`, `email`, `rowTotal` (Hin row→Scores_Hin, Rück row→Scores_Rueck),
  `teamNameSrc`, `submittedAt`.
- K–N (per distinct email): `uEmail` (`UNIQUE`), `uTotal` (`SUMIF` of rowTotal), `uName`
  (the email's fixed team name), `uEarliest` (`MINIFS` submittedAt — the tie-break).
- `B2`/`C2` `SORT` the per-email aggregate by total desc → earliest asc → name asc. Email lives
  only in the helper columns for the join and is **never** emitted to A:C.

**Teams are two independent drafts, name fixed per email.** Don't type in any Ranking tab — they
fill themselves. Hide helper columns (E onward) for tidiness; it doesn't affect the formulas.

Teams are drafted **once** and locked all season — Hin/Rück are two scoring views of the *same*
team, not two separate drafts. **Don't type anything in these tabs** — they fill themselves. Hide
columns E–H for tidiness if you like (right-click → Hide column); it doesn't affect the formulas.

---

## 3. Get the gviz URLs you'll need

After importing, grab the spreadsheet ID from the URL:
`https://docs.google.com/spreadsheets/d/`**`<SHEET_ID>`**`/edit`

- **Ranking endpoint** (for `VITE_RANKING_CSV_URL`):
  `https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?sheet=Ranking_Gesamt`
  *(swap `Ranking_Gesamt` → `Ranking_Hin` or `Ranking_Rueck` to show a single round instead).*
- **Players export endpoints** (for `npm run export:players`, optional — one per pool):
  `https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?sheet=Players_Hin&tqx=out:json`
  `https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?sheet=Players_Rueck&tqx=out:json`

> The gviz endpoint works without "Publish to web", but the spreadsheet must be readable by the
> request. For a private sheet the gviz read still works for the **owner's** deployed Apps Script
> and for "anyone with the link can view" if you choose that. Simplest reliable setup for the
> public ranking: set the sheet to **"Anyone with the link – Viewer"** *(it only ever exposes the
> Ranking tabs' rank/teamName/total via gviz — no email anywhere)*. If you prefer fully private,
> publish **only the Ranking_Gesamt tab** via File → Share → Publish to web.

---

## 4. Bind the Apps Script to this sheet

In the spreadsheet: **Extensions → Apps Script**. This opens a script **bound** to the sheet
(`SpreadsheetApp.getActiveSpreadsheet()` in `Code.gs` then targets exactly this workbook).
Then follow the README "Runbook" from step 4 (paste/clasp-push `Code.gs`, set Script Properties,
deploy the Web App, record the deployment id + `/exec` URL).

---

## 5. Quick sanity test (no website needed)

1. In `Scores_Hin`, set the `h020` row's `MD1` = `10`; in `Scores_Rueck`, set the `r020` row's
   `MD1` = `7`. Watch each sheet's `total` update (find the row via the `id` column — both are
   grouped by club, so use Ctrl+F for `h020` / `r020`).
2. In `Submissions` row 2 + row 3, type two fake confirmed rows for the SAME email to test the
   Gesamt email-join (columns: A submittedAt, B email, C teamName, **D round**, E–J p1–p6,
   L confirmed, N superseded):
   - Row 2: `email` = `t@x.com`, `teamName` = `Test`, `round` (D) = `HIN`, `p1..p6` (E–J) = six
     `h*` ids from `Players_Hin`, `confirmed` (L) = `TRUE`, `superseded` (N) = `FALSE`.
   - Row 3: same `email` = `t@x.com`, `teamName` = `Test`, `round` (D) = `RUECK`, `p1..p6` = six
     `r*` ids from `Players_Rueck`, `confirmed` (L) = `TRUE`, `superseded` (N) = `FALSE`.
   - `Ranking_Hin` should list `Test` with the Hin total; `Ranking_Rueck` with the Rück total;
     `Ranking_Gesamt` should list `Test` **once** with the *sum* of both (email-paired).
   - A different team name on row 3 would be rejected by the backend in real use (name is fixed
     per email); for this in-sheet test just keep them the same.
   - **Delete the fake rows afterwards** so the backend's first real append lands on row 2.

---

## 6. Where the real roster comes from (mytischtennis.de) — pending

The seeded `Players_Hin` / `Players_Rueck` are placeholders (the Rück pool simulates a couple of
transfers so the model is exercised). The real rosters for season **26/27** come from the clubs'
**Mannschaftsmeldungen** on mytischtennis.de — note the **Vorrunde** and **Rückrunde** Meldungen
differ, which is exactly why there are two pools with distinct ids.

- **All TTBL clubs (the league table):**
  <https://www.mytischtennis.de/click-tt/DTTB/26--27/ligen/TTBL/gruppe/518219/tabelle/gesamt>
- **A club's Meldung** (example: Post SV Mühlhausen) — Vorrunde:
  <https://www.mytischtennis.de/click-tt/TTTV/26--27/verein/109017/Post_SV_M%C3%BChlhausen_1951_e.V./meldungen>
- **Rückrunde Meldung** (example):
  <https://www.mytischtennis.de/click-tt/TTTV/26--27/verein/109017/Post_SV_M%C3%BChlhausen_1951_e.V./meldungendetails/E/rr>

> ⏳ **As of now these Meldungen are empty** — the clubs haven't posted their final lineups yet.
> **Wait for the final Meldungen**, then for each club pull the roster, assign a `price` per
> player (your call — based on ranking/role), and fill `Players` (+ regenerate `players.json`
> with `npm run make:sheet` after editing `src/players.json`, or export from the sheet).
> The position column should map each player to `Abwehr` / `Allrounder` / `Offensiv`.

When the final Meldungen are up, I can scrape those pages and draft the real `Players` list for
you — just say the word and I'll fetch them.

If that works, the formulas are wired correctly and the only remaining piece is the Apps Script
backend writing real rows.
