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

// The season is two independent drafts. Each round has its own lock date and its
// own player pool. Keep these lock dates in sync with SEASON locks in Code.gs.
//   now < HIN.lock                 → Hinrunde draft open
//   HIN.lock <= now < RUECK.lock   → Rückrunde draft open
//   now >= RUECK.lock              → both closed
export const ROUNDS = {
  HIN: {
    key: 'HIN',
    label: 'Hinrunde',
    lock: new Date('2026-09-01T12:00:00+02:00'),
  },
  RUECK: {
    key: 'RUECK',
    label: 'Rückrunde',
    lock: new Date('2027-01-15T12:00:00+01:00'),
  },
}

// Which round (if any) is open right now. Returns 'HIN' | 'RUECK' | null.
export function currentRoundKey(now = new Date()) {
  if (now < ROUNDS.HIN.lock) return 'HIN'
  if (now < ROUNDS.RUECK.lock) return 'RUECK'
  return null
}

// Read at build time from CI/CD vars (see .env.example). Never secret.
export const WEBAPP_URL = import.meta.env.VITE_WEBAPP_URL || ''
export const RANKING_URL = import.meta.env.VITE_RANKING_CSV_URL || ''
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
