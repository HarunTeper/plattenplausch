# Google Sheet setup — step by step

This repo ships a ready-to-import workbook: **`plattenplausch-sheet.xlsx`** (regenerate any time
with `npm run make:sheet`). It contains all four tabs with the right headers, your seeded
players, the `Scores` matchday grid, and **the Ranking formulas already written**. You mostly
just import it and fill in points.

> Regenerate after editing `src/players.json`: `npm run make:sheet` re-seeds Players + Scores.

---

## 1. Import the workbook into Google Sheets

1. Go to <https://sheets.google.com> → **Blank spreadsheet** (or use an existing one).
2. **File → Import → Upload** → drop `plattenplausch-sheet.xlsx`.
3. In the import dialog choose **"Replace spreadsheet"** (cleanest — gives you exactly the four
   tabs). Click **Import data**.
4. You now have four tabs: **Submissions, Players, Scores, Ranking**.
5. Rename the spreadsheet to e.g. *"Plattenplausch — Liga 2026"*.

> ⚠️ Keep the spreadsheet **private / access-restricted**. The PWA only reads the `Ranking` tab
> through the public gviz endpoint, which exposes just `rank/teamName/total`. Never put email in
> the `Ranking` tab.

---

## 2. What each tab is and what you do with it

### `Players` — your roster + prices (single source of truth)
Columns: `id | name | club | position | price`. Pre-filled with the 24 seeded players,
**grouped by club** (sorted by club, then name) so data entry is easy.
- Edit names/clubs/prices to match the real season. **Keep `position` to one of**
  `Abwehr`, `Allrounder`, `Offensiv` (these match the position caps in the code).
- If you change players here, **also update `src/players.json`** so the website shows the same
  roster — either edit it by hand, or run the export (see README) and commit it.
- `id` values must be unique and stable (the submissions reference them).

### `Scores` — weekly points you enter (the game engine)
Columns: `id | name | club | MD1 … MD11 | MD12 … MD22 | hinTotal | rueckTotal | playerTotal`.
The season is split into two rounds: **Hinrunde = MD1–MD11**, **Rückrunde = MD12–MD22**.
- One row per player (already seeded, grouped by club, all matchdays = `0`).
- **After each matchday, type each player's points into that matchday's column** (fill `MD1` for
  everyone, then `MD2` next week …).
- `hinTotal` (`=SUM(MD1:MD11)`), `rueckTotal` (`=SUM(MD12:MD22)`), and `playerTotal`
  (`=hinTotal+rueckTotal`) are formulas — **don't edit them.**
- Different round split or matchday count? Change `HIN_MATCHDAYS` / `MATCHDAYS` in
  `scripts/make-sheet.mjs` and regenerate (`npm run make:sheet`), or adjust the SUM ranges by hand.

### `Submissions` — written by the backend (you don't type here)
Columns: `submittedAt | email | teamName | p1..p6 | token | confirmed | confirmedAt | superseded`
(13 columns, A–M). **Header row only** — the Apps Script `appendRow()`s each submission onto the
first empty row (row 2 onward) and flips `confirmed`/`superseded`.
- **Don't pre-fill or leave stray data in any cell below the header**, or appends would skip past
  it. There are no helper columns here — all computation lives in the `Ranking` tab.

### `Ranking_Gesamt` / `Ranking_Hin` / `Ranking_Rueck` — auto-computed standings
Three standings tabs, identical shape, differing only in which Scores total they sum:
- **`Ranking_Gesamt`** sums `playerTotal` (whole season) — **this is what the website shows.**
- **`Ranking_Hin`** sums `hinTotal` (Hinrunde only).
- **`Ranking_Rueck`** sums `rueckTotal` (Rückrunde only).

Each tab: visible columns `rank | teamName | total` (A–C); helper columns `active | teamTotal |
submittedAt | teamNameSrc` (E–H) hold whole-column **array formulas** reading the raw
`Submissions` columns:
- `active` (E) = `TRUE` only for confirmed + non-superseded, non-blank rows.
- `teamTotal` (F) = sum of that row's 6 picks' round-total via `XLOOKUP` into `Scores`.
- `submittedAt` (G) / `teamNameSrc` (H) mirror those columns for the sort/output.
- `B2`/`C2` then `FILTER` to active rows and `SORT` by total desc → submittedAt asc → teamName
  asc; `A2` numbers the ranks.

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
- **Players export endpoint** (for `npm run export:players`, optional):
  `https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?sheet=Players&tqx=out:json`

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

1. In `Scores`, set a few players' `MD1` to non-zero numbers. Watch `playerTotal` update.
2. In `Submissions` row 2, manually type a fake confirmed row to test the Ranking join:
   - `submittedAt` (A) = any date, `teamName` (C) = `Test`, `p1..p6` (D–I) = six real player
     `id`s from `Players`, `confirmed` (K) = `TRUE`, `superseded` (M) = `FALSE`.
   - On `Ranking_Gesamt`, helper col `E2` should show `TRUE`, `F2` should equal the sum of those
     players' `playerTotal`, and `A2:C2` should list `Test` with that total. `Ranking_Hin` /
     `Ranking_Rueck` should show the same team with its Hin / Rück partial totals.
   - **Delete the fake row afterwards** so the backend's first real append lands on row 2.

---

## 6. Where the real roster comes from (mytischtennis.de) — pending

The seeded `Players` are placeholders. The real roster for season **26/27** comes from the
clubs' **Mannschaftsmeldungen** on mytischtennis.de.

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
