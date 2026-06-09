import { WEBAPP_URL, BUDGET } from './config.js'

// Alpine component for the branded confirmation page (confirm.html). Replaces
// the Apps Script click-through page so users stay on our domain and never see
// Google's "unverified app" warning.
//
// Flow: read ?token → POST {action:'lookup'} (read-only) → render the roster →
// user clicks the button → POST {action:'confirm'} → show the result.
//
// Double-opt-in is preserved: confirming happens ONLY on the button click, never
// on page load — so an email prefetch/scanner that merely loads this page (or
// the lookup) does not confirm anything.
export function confirm() {
  return {
    BUDGET,
    token: '',
    state: 'loading', // loading | ready | confirming | done | already | error
    error: '',
    teamName: '',
    roundLabel: '',
    players: [],

    get spent() {
      return this.players.reduce((s, p) => s + (Number(p.price) || 0), 0)
    },
    get spentPct() {
      return Math.max(0, Math.min(100, Math.round((this.spent / BUDGET) * 100)))
    },

    async init() {
      const params = new URLSearchParams(location.search)
      this.token = params.get('token') || ''
      if (!this.token) {
        this.state = 'error'
        this.error = 'Diesem Link fehlt der Token. Bitte nutze den Link aus deiner E-Mail.'
        return
      }
      if (!WEBAPP_URL) {
        this.state = 'error'
        this.error = 'Server-URL nicht konfiguriert.'
        return
      }
      await this._lookup()
    },

    async _post(payload) {
      // text/plain dodges the CORS preflight Apps Script can't answer.
      const res = await fetch(WEBAPP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      })
      return res.json()
    },

    async _lookup() {
      try {
        const data = await this._post({ action: 'lookup', token: this.token })
        if (!data || !data.ok) {
          this.state = 'error'
          this.error =
            data && data.error === 'not-found'
              ? 'Diese Einreichung konnten wir nicht finden — vielleicht wurde sie bereits entfernt. Stelle dein Team einfach neu auf.'
              : 'Dieser Link ist ungültig.'
          return
        }
        this.teamName = data.teamName || ''
        this.roundLabel = data.roundLabel || ''
        this.players = data.players || []
        // Already confirmed → show that state directly (no button needed).
        this.state = data.confirmed ? 'already' : 'ready'
      } catch (err) {
        this.state = 'error'
        this.error = 'Verbindung fehlgeschlagen. Bist du online? Bitte später erneut versuchen.'
      }
    },

    async doConfirm() {
      if (this.state === 'confirming') return
      this.state = 'confirming'
      try {
        const data = await this._post({ action: 'confirm', token: this.token })
        if (data && data.ok) {
          this.state = data.already ? 'already' : 'done'
          if (data.teamName) this.teamName = data.teamName
          if (data.roundLabel) this.roundLabel = data.roundLabel
        } else {
          this.state = 'error'
          this.error = (data && data.error) || 'Bestätigung fehlgeschlagen.'
        }
      } catch (err) {
        this.state = 'error'
        this.error = 'Verbindung fehlgeschlagen. Dein Team wurde NICHT bestätigt — bitte erneut versuchen.'
        // allow retry
        this._retry = true
      }
    },
  }
}
