// Roster + budget rules + the two-round (Hinrunde/Rückrunde) model.
// The FRONTEND copy lives here for live UX; the AUTHORITATIVE copy is in
// apps-script/Code.gs — the server re-validates everything and decides the
// round from the lock dates itself (it never trusts the client's round).

export const BUDGET = 100

// Fixed roster size → maps to columns p1..p6 in the Submissions sheet.
export const ROSTER_SIZE = 6

// Max players per position (per round). Absent position = unlimited.
export const POSITION_RULES = {
  Abwehr: { max: 2 },
  Allrounder: { max: 4 },
  Offensiv: { max: 5 },
}

// The season is two independent drafts. Each round has its own lock date, its
// own player pool, and an `enabled` flag. Keep lock dates in sync with Code.gs.
//   now < HIN.lock                 → Hinrunde draft open
//   HIN.lock <= now < RUECK.lock   → Rückrunde draft open
//   now >= RUECK.lock              → both closed
// `enabled: false` hard-locks a round regardless of date (the Rückrunde stays
// closed until we flip this on, even though its tab is shown). The SERVER still
// decides what it actually accepts — this only governs the UI.
export const ROUNDS = {
  HIN: {
    key: 'HIN',
    label: 'Hinrunde',
    enabled: true,
    lock: new Date('2026-09-01T12:00:00+02:00'),
  },
  RUECK: {
    key: 'RUECK',
    label: 'Rückrunde',
    enabled: false, // not open yet — tab shows a "comes later" panel
    lock: new Date('2027-01-15T12:00:00+01:00'),
  },
}

// Round order for the tab strip.
export const ROUND_ORDER = ['HIN', 'RUECK']

// The 12 TTBL clubs, in official table order. Drives the per-club ("Reiter")
// tab grid — every club gets a tab whether or not the pool has a player for it
// yet. `name` is the canonical value: player `club` in players-*.json MUST match
// it exactly, and it's what `clubFilter` filters on. `short` is the compact tab
// label (legal suffixes / sponsor names trimmed); display-only.
export const CLUBS = [
  { name: 'Post SV Mühlhausen', short: 'Post SV Mühlhausen' },
  { name: 'TTC Schwalbe Bergneustadt', short: 'Schwalbe Bergneustadt' },
  { name: 'TTC OE Clarity Telefonie-Systeme Bad Homburg e.V.', short: 'OE Bad Homburg' },
  { name: '1. FC Saarbrücken-TT', short: '1. FC Saarbrücken' },
  { name: 'ASC Grünwettersbach', short: 'ASC Grünwettersbach' },
  { name: 'SV Werder Bremen', short: 'Werder Bremen' },
  { name: 'TSV Bad Königshofen', short: 'TSV Bad Königshofen' },
  { name: 'TTF Liebherr Ochsenhausen', short: 'TTF Ochsenhausen' },
  { name: 'BV Borussia Dortmund', short: 'Borussia Dortmund' },
  { name: 'Borussia Düsseldorf', short: 'Borussia Düsseldorf' },
  { name: 'TTC RhönSprudel Fulda-Maberzell', short: 'TTC Fulda-Maberzell' },
  { name: 'TTC Zugbrücke Grenzau', short: 'TTC Grenzau' },
]

// Which round (if any) is open for drafting right now — respects BOTH the
// `enabled` flag and the lock window. Returns 'HIN' | 'RUECK' | null.
export function currentRoundKey(now = new Date()) {
  if (ROUNDS.HIN.enabled && now < ROUNDS.HIN.lock) return 'HIN'
  if (ROUNDS.RUECK.enabled && now >= ROUNDS.HIN.lock && now < ROUNDS.RUECK.lock) return 'RUECK'
  return null
}

// Can THIS specific round be drafted right now? (flag + lock window)
export function isRoundOpen(key, now = new Date()) {
  const r = ROUNDS[key]
  if (!r || !r.enabled) return false
  if (key === 'HIN') return now < r.lock
  if (key === 'RUECK') return now >= ROUNDS.HIN.lock && now < r.lock
  return false
}

// Read at build time from CI/CD vars (see .env.example). Never secret.
export const WEBAPP_URL = import.meta.env.VITE_WEBAPP_URL || ''
export const RANKING_URL = import.meta.env.VITE_RANKING_CSV_URL || ''
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
