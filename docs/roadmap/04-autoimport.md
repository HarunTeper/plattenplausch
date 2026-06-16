# 04 — Auto-import rosters + results (mytischtennis / click-TT)

**Size:** L · **Depends on:** #02 (2025 test season) · **Status:** 🔴 research-first

## Goal
Reduce manual data entry by pulling, from mytischtennis.de / click-TT:
- **(a) Rosters** — the clubs' Mannschaftsmeldungen → build `Players_Hin` / `Players_Rueck`.
- **(b) Results** — the Ergebnis tabs → each player's match W/L per matchday → **computed
  fantasy points** written to `Scores`.

**Decided:** results import produces **raw W/L per player per matchday**, then a **scoring rule**
(to be defined) converts them to fantasy points. So this workstream owns: the scraper, the
scoring rule, and the write-back into the season's Scores sheet.

## Why this is research-first (the unknowns)
The whole design depends on **what those pages actually expose**, which we have NOT verified:
- Is there a structured endpoint (JSON/XML/CSV) behind click-TT, or only rendered HTML to scrape?
- Are Meldungen and Ergebnisse stable, parseable, and consistent across clubs/rounds?
- Auth/rate-limits/robots — is automated fetching acceptable and reliable?
- Player identity: how to match a scraped player to a stable `id` across rounds (a player may
  change club between Hin/Rück — our model already uses distinct `h*`/`r*` ids per round).

**First step is a SPIKE, not implementation:** fetch the known example URLs (TTBL group
`gruppe/518219`; a club's `…/meldungen` and `…/meldungendetails/E/rr`; an Ergebnis tab), see the
real structure, and write up what's feasible. Only then design the importer.

Known starting URLs (from earlier):
- League table: `mytischtennis.de/click-tt/DTTB/26--27/ligen/TTBL/gruppe/518219/tabelle/gesamt`
- Club Meldung (Vorrunde): `…/verein/109017/<club>/meldungen`
- Club Meldung (Rückrunde): `…/verein/109017/<club>/meldungendetails/E/rr`
- (As of 26/27 prep these were still empty — wait for final Meldungen, or use 2025 archived data.)

## Where the importer runs (architecture options)
- **Apps Script (UrlFetchApp) on a trigger** — fetches + parses + writes Scores server-side,
  inside the existing backend. No new infra; fits "serverless, one backend". But Apps Script HTML
  parsing is clunky and UrlFetchApp has quotas.
- **A local Node script** (in `scripts/`) the organizer runs — fetches, parses, writes the sheet
  via the Sheets API or emits CSV to paste. More flexible parsing; manual to run.
- Decide during/after the spike based on what parsing the pages demands.

## The scoring rule (must be defined)
Converting W/L → fantasy points is a game-design decision, e.g.:
- flat points per win; bonus for beating a higher-ranked player; points for playing at all;
  doubles handling; etc.
- Needs to be explicit, documented, and ideally configurable per season.
This is the part that makes the fantasy game *interesting* — worth deciding deliberately, maybe
in the #05 brainstorm.

## The pricing problem (also lives here)
Auto-imported players have **no point values** (the 100-budget prices). Options:
- Derive from Q-TTR / ranking if the import exposes it; role/position heuristic; or manual pass.
- Whatever we choose feeds `Players_*` and must be stable per season.

## Build order within #04
1. **Spike:** fetch the real pages (use the 2025 archived season — data actually exists there),
   document structure + feasibility. ← do this FIRST, it may change everything below.
2. Decide importer architecture + scoring rule + pricing.
3. Roster importer → `Players_*` (+ `players-*.json`).
4. Results importer → W/L → scoring rule → `Scores`.
5. Verify end-to-end against the 2025 test season with known expected standings.

## Dependencies
- Needs **#02** (the 2025 test season sheet) as the safe testbed.
- Interacts with **#05** (scoring-rule + pricing are game-design questions).
