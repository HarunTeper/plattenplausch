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
Columns: `id | name | club | position | price`. Pre-filled with the 24 seeded players.
- Edit names/clubs/prices to match the real season. **Keep `position` to one of**
  `Abwehr`, `Allrounder`, `Offensiv` (these match the position caps in the code).
- If you change players here, **also update `src/players.json`** so the website shows the same
  roster — either edit it by hand, or run the export (see README) and commit it.
- `id` values must be unique and stable (the submissions reference them).

### `Scores` — weekly points you enter (the game engine)
Columns: `id | name | MD1 | MD2 | … | MD22 | playerTotal`.
- One row per player (already seeded, all matchdays = `0`).
- **After each matchday, type each player's points into that matchday's column** (e.g. fill
  `MD1` for everyone, then `MD2` next week …).
- `playerTotal` is a formula (`=SUM(MD1:MD22)`) — **don't edit it**, it updates automatically.
- More/fewer matchdays? Add/remove `MD*` columns and extend the `playerTotal` SUM range.

### `Submissions` — written by the backend (you don't type here)
Columns: `submittedAt | email | teamName | p1..p6 | token | confirmed | confirmedAt | superseded`
(13 columns, A–M). **Header row only** — the Apps Script `appendRow()`s each submission onto the
first empty row (row 2 onward) and flips `confirmed`/`superseded`.
- **Don't pre-fill or leave stray data in any cell below the header**, or appends would skip past
  it. There are no helper columns here — all computation lives in the `Ranking` tab.

### `Ranking` — auto-computed standings (read by the website)
Visible columns: `rank | teamName | total` (A–C). Helper columns `active | teamTotal |
submittedAt | teamNameSrc` (E–H) hold whole-column **array formulas** that read the raw
`Submissions` columns:
- `active` (E) = `TRUE` only for confirmed + non-superseded, non-blank rows.
- `teamTotal` (F) = sum of that row's 6 picks' `playerTotal` via `XLOOKUP` into `Scores`.
- `submittedAt` (G) / `teamNameSrc` (H) mirror those columns for the sort/output.
- `B2`/`C2` then `FILTER` to active rows and `SORT` by total desc → submittedAt asc → teamName
  asc; `A2` numbers the ranks.
- **Don't type anything in this tab** — it all fills itself. You may hide columns E–H for
  tidiness (right-click the column → Hide column); hiding does not affect the formulas.

---

## 3. Get the gviz URLs you'll need

After importing, grab the spreadsheet ID from the URL:
`https://docs.google.com/spreadsheets/d/`**`<SHEET_ID>`**`/edit`

- **Ranking endpoint** (for `VITE_RANKING_CSV_URL`):
  `https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?sheet=Ranking`
- **Players export endpoint** (for `npm run export:players`, optional):
  `https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?sheet=Players&tqx=out:json`

> The gviz endpoint works without "Publish to web", but the spreadsheet must be readable by the
> request. For a private sheet the gviz read still works for the **owner's** deployed Apps Script
> and for "anyone with the link can view" if you choose that. Simplest reliable setup for the
> public ranking: set the sheet to **"Anyone with the link – Viewer"** *(it only ever exposes the
> Ranking tab's rank/teamName/total via gviz — no email anywhere)*. If you prefer fully private,
> publish **only the Ranking tab** via File → Share → Publish to web → Ranking.

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
   - On the `Ranking` tab, helper col `E2` should show `TRUE`, `F2` should equal the sum of those
     players' `playerTotal`, and `A2:C2` should list `Test` with that total.
   - **Delete the fake row afterwards** so the backend's first real append lands on row 2.

If that works, the formulas are wired correctly and the only remaining piece is the Apps Script
backend writing real rows.
