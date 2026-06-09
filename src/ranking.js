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
        this.rows = this._parseCsv(text)
        this.updated = new Date()
      } catch (err) {
        // Network unreachable. If the SW served a cached copy fetch() still
        // resolves; a true failure lands here.
        this.error =
          'Tabelle konnte nicht geladen werden. Eventuell wird eine ältere, gespeicherte Version angezeigt.'
      } finally {
        this.loading = false
      }
    },

    // Parse the published-to-web CSV. Header row maps columns by label so order
    // is robust. Handles quoted fields (team names may contain commas/quotes).
    _parseCsv(text) {
      const rows = this._csvRows(text.trim())
      if (rows.length < 1) return []
      const header = rows[0].map((h) => h.trim().toLowerCase())
      const idx = (names) => header.findIndex((c) => names.includes(c))
      const iRank = idx(['rank', 'rang', 'platz'])
      const iTeam = idx(['teamname', 'team', 'name'])
      const iTotal = idx(['total', 'punkte', 'points', 'gesamt'])

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
