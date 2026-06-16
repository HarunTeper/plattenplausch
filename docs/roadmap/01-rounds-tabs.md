# 01 — Hin/Rück tabs + texts (Rückrunde locked for now)

**Size:** S–M · **Depends on:** — · **Status:** 🟢 ready

## Goal
Make the two-round structure **visible** on the site: explicit tabs/sections for Hinrunde and
Rückrunde. The Rückrunde tab is shown but **locked** (not yet draftable) for now.

## Today (baseline)
`src/draft.js` auto-resolves a single open round from the lock dates (`currentRoundKey()`); the
page shows just that one round, or a "closed" state. There's no way to *see* the other round.

## Scope
- A round switcher (tabs: **Hinrunde | Rückrunde**) on the draft page.
- The **open** round is draftable; the **other** round shows a locked state with a clear reason
  (e.g. "Rückrunde öffnet nach der Hinrunde — voraussichtlich <date>").
- Texts revised to explain the two-round model up front (overlaps with #03 copy work).
- Ranking page: optionally surface the three tables (Gesamt / Hin / Rück) as tabs too — the data
  already exists (three sheets). Decide if in-scope here or a fast follow.

## Open questions / decisions
- **Locked-round content:** does a user need to *see their already-submitted Hinrunde team* on
  the Rückrunde tab, or just a "locked, comes later" message? (Seeing it needs a read endpoint
  by email — more work, and email-as-lookup has privacy implications.)
- **Manual lock vs date-driven:** "Rückrunde locked for now" — is that just because its lock date
  hasn't been configured, or do we want an explicit `enabled:false` flag per round so it's locked
  regardless of date? (Recommend an explicit flag — clearer than juggling dates.)
- **Ranking tabs:** include the Hin/Rück/Gesamt switch on the standings page now, or later?

## Notes
- Pure frontend; no backend/sheet change (the server already resolves the round itself, so a
  visible "Rückrunde" tab that can't submit is safe — the server would reject an off-round POST
  anyway).
- Keep the closed-state and round banner already built; this generalizes them into tabs.
