import { RANKING_URL } from './config.js'

// Alpine component for the standings page. Fetches the Google Sheet gviz/tq JSON
// (fresher than publish-to-web CSV), parses it, and renders rank/teamName/total.
// Never displays email. Degrades gracefully: the service worker caches the last
// successful gviz response (StaleWhileRevalidate), so an outage shows stale data.
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
        this.rows = this._parseGviz(text)
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

    // gviz/tq wraps JSON in `…(google.visualization.Query.setResponse({...}));`.
    // Strip the wrapper, parse, map columns by label so column order is robust.
    _parseGviz(text) {
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start === -1 || end === -1) throw new Error('bad gviz payload')
      const json = JSON.parse(text.slice(start, end + 1))
      const cols = (json.table.cols || []).map((c) =>
        (c.label || c.id || '').toString().trim().toLowerCase()
      )
      const idx = (names) => cols.findIndex((c) => names.includes(c))
      const iRank = idx(['rank', 'rang', 'platz'])
      const iTeam = idx(['teamname', 'team', 'name'])
      const iTotal = idx(['total', 'punkte', 'points', 'gesamt'])

      const cell = (r, i) => (i >= 0 && r.c[i] ? (r.c[i].v ?? r.c[i].f ?? '') : '')

      const out = (json.table.rows || []).map((r, n) => ({
        rank: iRank >= 0 ? Number(cell(r, iRank)) || n + 1 : n + 1,
        teamName: String(cell(r, iTeam) || '—'),
        total: Number(cell(r, iTotal)) || 0,
      }))
      // Never trust source order — sort by total desc as the default presentation.
      return out
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
