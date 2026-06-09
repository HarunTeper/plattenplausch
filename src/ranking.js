import { RANKING_URL } from './config.js'

// Alpine component for the standings page. Fetches the published-to-web CSV of
// the Ranking_Gesamt tab (keeps the spreadsheet itself private — only that one
// tab is exposed, and it contains no email), parses it, and renders
// rank/teamName/total. Never displays email. Degrades gracefully: the service
// worker caches the last successful response, so an outage shows stale data.
// Note: publish-to-web caches for ~5 min, so standings lag a few minutes.
export function ranking() {
  return {
    rows: [],
    loading: true,
    error: null,
    updated: null,
    sortKey: 'rank',
    sortDir: 'asc',

    async init() {
      await this.load()
    },

    async load() {
      this.loading = true
      this.error = null
      if (!RANKING_URL) {
        this.loading = false
        this.error = 'Ranking-URL nicht konfiguriert (VITE_RANKING_CSV_URL fehlt).'
        return
      }
      try {
        const res = await fetch(RANKING_URL, { headers: { 'Cache-Control': 'no-cache' } })
        const text = await res.text()
        // The publish-to-web endpoint can return an HTTP error or an HTML login
        // page (e.g. if publishing lapsed) instead of CSV. Detect both, and
        // throw → show the error state, NOT a misleading "no teams yet" (which
        // would happen if we parsed HTML to zero rows).
        if (!res.ok) throw new Error('http ' + res.status)
        if (text.trimStart().startsWith('<')) throw new Error('not-csv')
        const parsed = this._parseCsv(text)
        // A valid-but-empty table is fine; only adopt it if the header was real.
        this.rows = parsed
        this.updated = new Date()
      } catch (err) {
        // Network unreachable, HTTP error, or non-CSV response. Keep any rows we
        // already have (e.g. an earlier successful load) rather than blanking.
        this.error =
          'Tabelle konnte gerade nicht geladen werden. Eventuell wird eine ältere Version angezeigt — bitte später erneut „Aktualisieren“.'
      } finally {
        this.loading = false
      }
    },

    // Parse the published-to-web CSV. Header row maps columns by label so order
    // is robust. Handles quoted fields (team names may contain commas/quotes).
    // Throws if the first row isn't a recognizable header (so callers can treat
    // junk/HTML as an error rather than an empty table).
    _parseCsv(text) {
      const rows = this._csvRows(text.trim())
      if (rows.length < 1) return []
      const header = rows[0].map((h) => h.trim().toLowerCase())
      const idx = (names) => header.findIndex((c) => names.includes(c))
      const iRank = idx(['rank', 'rang', 'platz'])
      const iTeam = idx(['teamname', 'team', 'name'])
      const iTotal = idx(['total', 'punkte', 'points', 'gesamt'])
      // No recognizable columns → this isn't our CSV (HTML/error page).
      if (iTeam < 0 && iTotal < 0 && iRank < 0) throw new Error('bad-header')

      return rows
        .slice(1)
        .filter((r) => (iTeam >= 0 ? r[iTeam] : r[1]) ) // drop fully-empty rows
        .map((r, n) => ({
          rank: iRank >= 0 ? Number(r[iRank]) || n + 1 : n + 1,
          teamName: String((iTeam >= 0 ? r[iTeam] : r[1]) || '—'),
          total: Number(iTotal >= 0 ? r[iTotal] : r[2]) || 0,
        }))
    },

    // Minimal RFC-4180 CSV splitter: handles "quoted" fields, escaped "" quotes,
    // and commas/newlines inside quotes. Returns an array of string-arrays.
    _csvRows(text) {
      const rows = []
      let row = []
      let field = ''
      let inQuotes = false
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (inQuotes) {
          if (ch === '"') {
            if (text[i + 1] === '"') { field += '"'; i++ }
            else inQuotes = false
          } else field += ch
        } else if (ch === '"') {
          inQuotes = true
        } else if (ch === ',') {
          row.push(field); field = ''
        } else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++
          row.push(field); rows.push(row); row = []; field = ''
        } else field += ch
      }
      if (field !== '' || row.length) { row.push(field); rows.push(row) }
      return rows
    },

    get sortedRows() {
      const dir = this.sortDir === 'asc' ? 1 : -1
      const k = this.sortKey
      return [...this.rows].sort((a, b) => {
        if (a[k] < b[k]) return -1 * dir
        if (a[k] > b[k]) return 1 * dir
        return 0
      })
    },

    sortBy(key) {
      if (this.sortKey === key) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'
      } else {
        this.sortKey = key
        this.sortDir = key === 'total' ? 'desc' : 'asc'
      }
    },

    ariaSort(key) {
      if (this.sortKey !== key) return 'none'
      return this.sortDir === 'asc' ? 'ascending' : 'descending'
    },

    get updatedLabel() {
      if (!this.updated) return ''
      return this.updated.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    },
  }
}
