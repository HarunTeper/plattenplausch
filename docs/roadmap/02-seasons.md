# 02 — Per-year seasons + 2025 test season

**Size:** M · **Depends on:** — (enables #04) · **Status:** 🟡 needs design lock

## Goal
Turn the implicit "one season" into an explicit **per-year season** model, and stand up a
**2025 test season** (separate static Google Sheet, self-made players) to develop #04 against
without touching the live season.

**Decided:** season model = **runtime year switch** — the site offers a year dropdown; ranking
(and archived views) load that season's sheet; past seasons stay browsable.

## Today (baseline)
Everything is single-season and implicit: one `WEBAPP_URL`, one `RANKING_CSV_URL`, one pair of
`Players_*` pools, one set of locks in `src/config.js` + `Code.gs`. No notion of "year".

## Proposed shape
A `seasons` registry (in `src/config.js`, build-time data) keyed by year, each entry holding:
- `label` (e.g. "Saison 2025/26"), `status` (`live` | `archived` | `test`)
- `rankingCsvUrl` (that season's published Ranking_Gesamt CSV)
- per-round config: `{ HIN: {lock, playersUrl/import}, RUECK: {lock, enabled} }`
- which season is the **default/active** one

Frontend:
- A **year dropdown** (in the topbar) → switches the ranking view (and, for the active season,
  the draft). Archived seasons are read-only (ranking only).
- URL reflects the season (e.g. `?season=2025`) so links are shareable and the SW-free static
  site can deep-link.

Backend (Apps Script): drafting only ever targets the **current live season's** sheet, so the
backend likely stays single-sheet (the live one). Archived seasons are read-only CSV on the
frontend — no backend involvement. **Open question below.**

## The 2025 test season
- A **separate** Google Sheet (own players, own Scores, own Ranking tabs), published CSV.
- Self-made players (we can reuse/extend the current seed) so #04's import + scoring can be
  built and verified against known data.
- Marked `status: test` so it's clearly not real.

## Open questions / decisions
- **Backend scope:** does drafting need to be season-aware (multiple live seasons over time), or
  is there always exactly ONE live season and the rest are archived read-only? (Recommend: one
  live season; archives are frontend-only CSV. Keeps the backend simple.)
- **Config vs data:** seasons as a committed config object, or a small `seasons.json`? (Lean
  config object for now.)
- **Sheet-per-season churn:** each season = its own sheet = its own publish/gid. Document the
  per-season config clearly so the gid/publish dance (see CLAUDE.md) is contained.
- **Archival:** when a season ends, how is it "frozen"? (Probably: flip `status: archived`, leave
  its CSV published, stop drafting.)

## Why this is the foundation for #04
The 2025 test season gives #04 a safe, static dataset to scrape-and-score against. Build #02
first (at least the test-season plumbing) before #04 implementation.
