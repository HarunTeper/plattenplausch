// Export the Players sheet to src/players.json from a gviz/tq CSV/JSON endpoint.
// The Players sheet is the single source of truth for roster + prices; commit the
// regenerated players.json when the roster changes. Usage:
//   PLAYERS_URL='https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?sheet=Players&tqx=out:json' \
//     node scripts/export-players.mjs
import { writeFileSync } from 'node:fs'

const url = process.env.PLAYERS_URL
if (!url) {
  console.error('Set PLAYERS_URL to the Players gviz/tq endpoint (tqx=out:json).')
  process.exit(1)
}

const text = await (await fetch(url)).text()
const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
const cols = json.table.cols.map((c) => (c.label || c.id || '').toString().trim().toLowerCase())
const at = (names) => cols.findIndex((c) => names.includes(c))
const iId = at(['id'])
const iName = at(['name'])
const iClub = at(['club', 'verein'])
const iPos = at(['position', 'pos'])
const iPrice = at(['price', 'preis', 'wert'])

const cell = (r, i) => (i >= 0 && r.c[i] ? (r.c[i].v ?? r.c[i].f ?? '') : '')
const players = json.table.rows
  .map((r) => ({
    id: String(cell(r, iId)),
    name: String(cell(r, iName)),
    club: String(cell(r, iClub)),
    position: String(cell(r, iPos)),
    price: Number(cell(r, iPrice)) || 0,
  }))
  .filter((p) => p.id)

writeFileSync(
  new URL('../src/players.json', import.meta.url),
  JSON.stringify(players, null, 2) + '\n'
)
console.log(`Wrote ${players.length} players to src/players.json`)
