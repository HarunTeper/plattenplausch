import playersHin from './players-hin.json'
import playersRueck from './players-rueck.json'
import {
  BUDGET,
  ROSTER_SIZE,
  POSITION_RULES,
  ROUNDS,
  ROUND_ORDER,
  currentRoundKey,
  isRoundOpen,
  WEBAPP_URL,
  TURNSTILE_SITE_KEY,
} from './config.js'

const POOLS = { HIN: playersHin, RUECK: playersRueck }

// Alpine component for the draft page. Shows BOTH rounds as tabs; the open round
// (Hin/Rück) is draftable, the other shows a locked panel. Holds `selected`
// (player ids), derives spent/remaining live, enforces budget + roster +
// position limits, and submits IDs-only to the Apps Script Web App. The server
// independently re-decides the round from its own lock dates.
export function draft() {
  // Default the active tab to whichever round is open; else the first round.
  const openKey = currentRoundKey()
  return {
    BUDGET,
    ROSTER_SIZE,
    siteKey: TURNSTILE_SITE_KEY,

    rounds: ROUND_ORDER.map((k) => ({ key: k, label: ROUNDS[k].label })),
    activeRound: openKey || ROUND_ORDER[0], // selected TAB (may be locked)

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
      // Render Turnstile only if the active tab is actually draftable.
      if (this.roundOpen) this._renderTurnstile()
    },

    // ---- round / tab state ----
    get roundKey() {
      return this.activeRound
    },
    get roundLabel() {
      return ROUNDS[this.activeRound] ? ROUNDS[this.activeRound].label : ''
    },
    get roundOpen() {
      return isRoundOpen(this.activeRound)
    },
    get players() {
      return POOLS[this.activeRound] || []
    },
    isActive(key) {
      return this.activeRound === key
    },
    isTabOpen(key) {
      return isRoundOpen(key)
    },
    // Switch tabs: reset the in-progress selection/filters, and lazily render
    // Turnstile the first time we land on an open round.
    selectRound(key) {
      if (this.activeRound === key) return
      this.activeRound = key
      this.selected = []
      this.query = ''
      this.posFilter = ''
      this.clubFilter = ''
      this.status = null
      if (this.roundOpen && !this.turnstileWidgetId) {
        // wait for the locked-panel→form DOM swap, then mount the widget
        this.$nextTick(() => this._renderTurnstile())
      }
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
              'Fast drin! Wir haben dir einen Bestätigungslink per Mail geschickt — ' +
              'einmal klicken und dein Team steht. Nichts da? Wirf einen Blick in den Spam-Ordner.',
          }
        } else {
          this.status = {
            type: 'bad',
            msg: (data && data.error) || 'Hat nicht geklappt — bitte nochmal versuchen.',
          }
        }
      } catch (err) {
        // Network failure / offline. NEVER pretend the submission was confirmed.
        this.status = {
          type: 'warn',
          msg:
            'Da ist nichts durchgegangen — wahrscheinlich offline. Dein Team wurde NICHT ' +
            'gespeichert. Kurz prüfen und nochmal abschicken.',
        }
      } finally {
        // Token is single-use; reset the widget either way.
        this._resetTurnstile()
        this.submitting = false
      }
    },
  }
}
