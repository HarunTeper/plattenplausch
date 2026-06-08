// Roster + budget rules. The FRONTEND copy lives here for live UX feedback.
// The AUTHORITATIVE copy lives in apps-script/Code.gs — the server re-validates
// everything regardless of what the client sends. Keep the two in sync by hand
// (they are tiny constants); the server is the source of truth on disagreement.

export const BUDGET = 100

// Fixed roster size → maps to columns p1..p6 in the Submissions sheet.
export const ROSTER_SIZE = 6

// Max players allowed per position. A position absent here is unlimited.
// `min` (if set) is enforced only at submit time, not on every add.
export const POSITION_RULES = {
  Abwehr: { max: 2 },
  Allrounder: { max: 4 },
  Offensiv: { max: 5 },
}

// Read at build time from CI/CD vars (see .env.example). Never secret.
export const WEBAPP_URL = import.meta.env.VITE_WEBAPP_URL || ''
export const RANKING_URL = import.meta.env.VITE_RANKING_CSV_URL || ''
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
