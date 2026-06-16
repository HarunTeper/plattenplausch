# Plattenplausch — Roadmap

Planning overview for the next phase of work. **No code yet** — each workstream has its own
sub-file with scope, decisions, open questions, and rough size. Order is not fixed; the
"Suggested sequence" below is a recommendation, gated where noted.

Status legend: 🟢 ready to start · 🟡 needs a decision first · 🔴 research-first (unknowns)

| # | Workstream | Size | Depends on | Status | File |
|---|-----------|------|-----------|--------|------|
| 1 | Hin/Rück tabs + locked Rückrunde | S–M | — | 🟢 | [01-rounds-tabs.md](01-rounds-tabs.md) |
| 2 | Per-year seasons + 2025 test season | M | — (enables 4) | 🟡 | [02-seasons.md](02-seasons.md) |
| 3 | De-AI the copy (German voice) | S | — | 🟢 | [03-copy.md](03-copy.md) |
| 4 | Auto-import rosters + results (mytischtennis / click-TT) | L | 2 | 🔴 | [04-autoimport.md](04-autoimport.md) |
| 5 | General idea brainstorm | — | — | 🟢 | [05-ideas.md](05-ideas.md) |

## Locked decisions (from planning discussion)
- **Season model = runtime year switch.** The site offers a year dropdown; ranking (and archived
  views) load that season's sheet. Past seasons stay browsable. (Detail in 02.)
- **Results import = raw W/L → computed fantasy points.** The scraper pulls each player's match
  results per matchday; a defined scoring rule converts them to points written to `Scores`.
  (Detail in 04. The scoring rule itself is an open decision.)
- **2025 test season is the testbed for auto-import** — a separate static Google Sheet with
  self-made players, so #4 is developed without touching the live season.

## Suggested sequence (gates, not commitments)
1. **#3 (copy)** — quick, independent, zero risk. Good warm-up; ships a visible improvement.
2. **#1 (round tabs)** — frontend-only; makes the two-round structure visible (Rück locked).
3. **#2 (seasons)** — architectural foundation. **Gate:** lock the runtime-switch design before
   building, since it touches config, both pages, and the sheet wiring.
4. **#4 (auto-import)** — largest + most uncertain. **Gate:** a research spike (what do the pages
   actually expose?) and a scoring-rule decision **before** any implementation. Needs #2's 2025
   test season in place.
5. **#5 (brainstorm)** — anytime; may reshuffle the above. Worth doing early-ish so big ideas
   land before #2's architecture sets.

## Cross-cutting things to keep in mind
- **Pricing problem (recurring):** auto-imported players have no point values. Whatever assigns
  prices (manual, Q-TTR-derived, role-based) is needed for #4 and affects #2's per-season config.
- **Golden rules still hold** (see CLAUDE.md): IDs-only POST, server-side prices, double opt-in,
  email never public, no PWA, same Apps Script deployment id.
- **Sheet re-import churn** (gid changes, publish lapses) gets worse with multiple seasons —
  #2 should reduce manual sheet juggling, not add to it.
