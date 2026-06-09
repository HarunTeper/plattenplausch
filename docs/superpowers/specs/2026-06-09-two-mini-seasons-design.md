# Two Mini-Seasons — Design Change

Supersedes the single-locked-team model. The season is now **two independent drafts**
(Hinrunde + Rückrunde); the whole-season table is the **sum of the two**.

## Rules (approved)
- **Two drafts.** Each round = a fresh 100-point, 6-player, position-limited team. Picks may
  repeat across rounds. The two teams are independent.
- **Two lock dates.** `HIN_LOCK` (before MD1) and `RUECK_LOCK` (before MD12).
  - now < HIN_LOCK → Hinrunde draft open.
  - HIN_LOCK ≤ now < RUECK_LOCK → Rückrunde draft open.
  - now ≥ RUECK_LOCK → both closed.
  - Deadline enforced ONLY in doPost (unchanged principle). doGet/confirm never re-check it.
- **Identity = email. Team name fixed per email for the whole season.** First confirmed name
  wins. A submission whose email already has a confirmed name and whose teamName differs
  (case-insensitive, normalized) is **rejected**: `{ok:false, error}`. Same name (any case) is
  accepted. Picks may change freely.
- **Supersession: latest-confirmed-wins per email PER ROUND.** Re-confirming a Hin team
  supersedes earlier Hin teams for that email; never affects the Rück team.
- **Gesamt = Hin points + Rück points, paired by normalized email** (missing round counts as 0).
  Display the single consistent team name; never display email.
- **Separate player pool per round.** `players-hin.json` / `players-rueck.json`;
  sheet tabs `Players_Hin` / `Players_Rueck`. Draft page loads the open round's pool; server
  validates against the matching round's players + prices.

## Frontend
- `config.js`: add `ROUNDS` config — `{ HIN: {...}, RUECK: {...} }` each with `lock` (ISO),
  `playersUrl`/static import, label. Add `BUDGET`/`ROSTER_SIZE`/`POSITION_RULES` shared (same per
  round). Add a `currentRound()` helper deriving the open round from `now` vs the two locks.
- `draft.js`: load `players-<round>.json` for the open round; include `round` in the POST payload;
  show which round is open; if both closed, show a closed state (link to ranking).
- Player pool, budget drain meter, club tabs unchanged — they operate on the round's pool.
- `index.html`: round banner ("Hinrunde-Team aufstellen" / "Rückrunde …" / "Anmeldung
  geschlossen").

## Backend (Code.gs)
- `Submissions` columns gain **`round`** (after teamName): `submittedAt, email, teamName, round,
  p1..p6, token, confirmed, confirmedAt, superseded`.
- `doPost`:
  - Determine round server-side from locks (don't trust client) → `HIN` or `RUECK`; if both
    closed → reject.
  - Validate against `Players_<round>` (existence + server-side prices + position/budget).
  - **Name-lock check:** if any confirmed row for this email has a teamName, require the new
    teamName to match it (normalized, case-insensitive); else reject.
  - Per-email-per-round pending rate limit.
  - Append row with the resolved `round`.
- `doGet`/confirm: unchanged click-through; confirm sets confirmed + recomputes supersession
  **scoped to (email, round)** — latest submittedAt within the same round wins.
- `loadPlayers_(round)` reads `Players_Hin` or `Players_Rueck`.

## Sheet (make-sheet.mjs)
- `Players_Hin`, `Players_Rueck` tabs (seeded from the two json files; grouped by club).
- **Distinct ids per round.** Hin pool ids prefixed `h` (`h001`…), Rück pool ids prefixed `r`
  (`r001`…) — because a player may change club between rounds, so each round's listing is its own
  entity (own club, own price). `Scores` has one row per listing: `h001` carries MD1–11 (Hin),
  `r001` carries MD12–22 (Rück); the irrelevant-round columns stay 0. Ids never overlap across
  pools → no cross-round bleed in the joins.
- `Submissions`: header includes `round`.
- `Ranking_Hin`: active rows where `round=HIN`, team total via XLOOKUP into `Scores.hinTotal`.
- `Ranking_Rueck`: active rows where `round=RUECK`, into `Scores.rueckTotal`.
- `Ranking_Gesamt`: per distinct email among active rows, sum (Hin team's hinTotal) +
  (Rück team's rueckTotal); display that email's team name; sort desc, tie-break earliest
  submittedAt then name. Missing round = 0.

## Edge cases
- Player ids are distinct per round (`h*` / `r*`); a player who changes club between rounds is
  two listings with two Scores rows — intended.
- Gesamt pairing is by **email**, which is never shown — the join happens in-sheet; output is
  name+total only.
- A user who drafts only one round still appears in Gesamt (other round = 0) and in that round's
  table.
