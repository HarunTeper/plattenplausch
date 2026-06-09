import playersHin from './players-hin.json'
import playersRueck from './players-rueck.json'
import {
  BUDGET,
  ROSTER_SIZE,
  POSITION_RULES,
  ROUNDS,
  currentRoundKey,
  WEBAPP_URL,
  TURNSTILE_SITE_KEY,
} from './config.js'

// Alpine component for the draft page. Picks the player pool for whichever round
// is currently open (Hin/Rück), holds `selected` (player ids), derives
// spent/remaining live, enforces budget + roster + position limits, and submits
// IDs-only to the Apps Script Web App. If both rounds are closed, shows a closed
// state. The server independently decides the round from its own lock dates.
export function draft() {
  const roundKey = currentRoundKey()
  const round = roundKey ? ROUNDS[roundKey] : null
  const pool = roundKey === 'HIN' ? playersHin : roundKey === 'RUECK' ? playersRueck : []

  return {
    players: pool,
    BUDGET,
    ROSTER_SIZE,
    siteKey: TURNSTILE_SITE_KEY,

    roundKey, // 'HIN' | 'RUECK' | null
    roundLabel: round ? round.label : '',
    roundOpen: !!roundKey,

    selected: [],
    query: '',
    posFilter: '',
    clubFilter: '', // '' = Alle; otherwise a club name ("Reiter" tab)

    teamName: '',
    email: '',
    consent: false,
    website: '', // honeypot — must stay empty

    turnstileToken: '',
    turnstileWidgetId: null,

    submitting: false,
    status: null, // {type:'ok'|'bad'|'warn', msg}

    init() {
      // No draft to render when both rounds are closed.
      if (this.roundOpen) this._renderTurnstile()
    },

    // ---- derived ----
    get picked() {
      return this.selected
        .map((id) => this.players.find((p) => p.id === id))
        .filter(Boolean)
    },
    get spent() {
      return this.picked.reduce((s, p) => s + p.price, 0)
    },
    get remaining() {
      return BUDGET - this.spent
    },
    get full() {
      return this.selected.length >= ROSTER_SIZE
    },
    get overBudget() {
      return this.spent > BUDGET
    },
    // Meter shows REMAINING budget: starts full (100%) and drains as picks are
    // made. Clamped to [0,100]; over-budget is surfaced via the `over` class.
    get remainingPct() {
      return Math.max(0, Math.min(100, Math.round((this.remaining / BUDGET) * 100)))
    },
    get visiblePlayers() {
      const q = this.query.trim().toLowerCase()
      return this.players.filter((p) => {
        if (this.clubFilter && p.club !== this.clubFilter) return false
        if (this.posFilter && p.position !== this.posFilter) return false
        if (!q) return true
        return (
          p.name.toLowerCase().includes(q) || p.club.toLowerCase().includes(q)
        )
      })
    },
    get positions() {
      return [...new Set(this.players.map((p) => p.position))].sort()
    },
    // Distinct clubs, for the "Reiter" (per-Mannschaft) tab row.
    get clubs() {
      return [...new Set(this.players.map((p) => p.club))].sort((a, b) =>
        a.localeCompare(b, 'de')
      )
    },
    // How many of MY picks belong to a club — shown as a badge on the tab.
    pickedInClub(club) {
      return this.picked.filter((p) => p.club === club).length
    },

    isPicked(id) {
      return this.selected.includes(id)
    },

    // How many of a position are already selected.
    countPos(position) {
      return this.picked.filter((p) => p.position === position).length
    },

    // A player can be added if: not already picked, roster not full, price fits
    // remaining budget, and its position cap is not reached.
    canAdd(p) {
      if (this.isPicked(p.id)) return false
      if (this.full) return false
      if (p.price > this.remaining) return false
      const rule = POSITION_RULES[p.position]
      if (rule && rule.max != null && this.countPos(p.position) >= rule.max) return false
      return true
    },

    // Human reason an add button is disabled (used for title/tooltips).
    addReason(p) {
      if (this.isPicked(p.id)) return 'Bereits im Team'
      if (this.full) return 'Kader voll'
      if (p.price > this.remaining) return 'Budget zu niedrig'
      const rule = POSITION_RULES[p.position]
      if (rule && rule.max != null && this.countPos(p.position) >= rule.max)
        return `Max. ${rule.max} × ${p.position}`
      return ''
    },

    add(p) {
      if (!this.canAdd(p)) return
      this.selected.push(p.id)
    },
    remove(id) {
      this.selected = this.selected.filter((x) => x !== id)
    },

    // ---- validation (client-side gate; server re-validates regardless) ----
    get emailValid() {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())
    },
    get formValid() {
      return (
        this.selected.length === ROSTER_SIZE &&
        !this.overBudget &&
        this.teamName.trim().length >= 2 &&
        this.teamName.trim().length <= 40 &&
        this.emailValid &&
        this.consent &&
        !!this.turnstileToken
      )
    },

    // ---- Cloudflare Turnstile ----
    _renderTurnstile() {
      const mount = () => {
        if (!window.turnstile || !this.siteKey) return
        const el = this.$refs.turnstile
        if (!el) return
        this.turnstileWidgetId = window.turnstile.render(el, {
          sitekey: this.siteKey,
          callback: (token) => {
            this.turnstileToken = token
          },
          'expired-callback': () => {
            // Token is single-use / ~300s. Surface a friendly retry + re-render.
            this.turnstileToken = ''
            this.status = {
              type: 'warn',
              msg: 'Sicherheits-Check abgelaufen — bitte erneut bestätigen.',
            }
            this._resetTurnstile()
          },
          'error-callback': () => {
            this.turnstileToken = ''
          },
        })
      }
      if (window.turnstile) mount()
      else {
        // Script loaded async with onload=...; poll briefly until ready.
        let tries = 0
        const t = setInterval(() => {
          if (window.turnstile || tries++ > 40) {
            clearInterval(t)
            mount()
          }
        }, 150)
      }
    },
    _resetTurnstile() {
      this.turnstileToken = ''
      if (window.turnstile && this.turnstileWidgetId != null) {
        window.turnstile.reset(this.turnstileWidgetId)
      }
    },

    // ---- submit ----
    async submit() {
      if (this.submitting) return
      this.status = null
      if (!this.formValid) {
        this.status = { type: 'bad', msg: 'Bitte alle Felder korrekt ausfüllen.' }
        return
      }
      if (!WEBAPP_URL) {
        this.status = {
          type: 'bad',
          msg: 'Server-URL nicht konfiguriert (VITE_WEBAPP_URL fehlt).',
        }
        return
      }

      this.submitting = true
      // IDs only — never prices. The server looks up prices itself, and decides
      // the round from its own locks; `round` here is a hint only.
      const payload = {
        email: this.email.trim().toLowerCase(),
        teamName: this.teamName.trim(),
        round: this.roundKey,
        players: [...this.selected],
        turnstileToken: this.turnstileToken,
        honeypot: this.website,
      }

      try {
        // text/plain avoids the CORS preflight Apps Script cannot answer.
        const res = await fetch(WEBAPP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (data && data.ok) {
          this.status = {
            type: 'ok',
            msg:
              'Fast geschafft! Wir haben dir einen Bestätigungslink per E-Mail geschickt. ' +
              'Klicke ihn an, um dein Team zu fixieren. Schau auch im Spam-Ordner nach.',
          }
        } else {
          this.status = {
            type: 'bad',
            msg: (data && data.error) || 'Einreichung abgelehnt.',
          }
        }
      } catch (err) {
        // Network failure / offline. NEVER pretend the submission was confirmed.
        this.status = {
          type: 'warn',
          msg:
            'Du bist offline oder die Einreichung ist nicht durchgegangen. ' +
            'Dein Team wurde NICHT gespeichert — bitte später erneut versuchen.',
        }
      } finally {
        // Token is single-use; reset the widget either way.
        this._resetTurnstile()
        this.submitting = false
      }
    },
  }
}
