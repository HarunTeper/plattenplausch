// Export a Players pool tab to its src JSON from a gviz/tq JSON endpoint.
// The Players_Hin / Players_Rueck tabs are the source of truth for each round's
// roster + prices; commit the regenerated JSON when a roster changes. Usage:
//   PLAYERS_URL='https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?sheet=Players_Hin&tqx=out:json' \
//   OUT=players-hin.json  node scripts/export-players.mjs
// (OUT defaults to players-hin.json; use players-rueck.json for the Rück pool.)
import { writeFileSync } from 'node:fs'

const url = process.env.PLAYERS_URL
const out = process.env.OUT || 'players-hin.json'
if (!url) {
  console.error('Set PLAYERS_URL to a Players_Hin/Players_Rueck gviz/tq endpoint (tqx=out:json).')
  console.error('Optionally set OUT=players-hin.json | players-rueck.json (default players-hin.json).')
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
  new URL('../src/' + out, import.meta.url),
  JSON.stringify(players, null, 2) + '\n'
)
console.log(`Wrote ${players.length} players to src/${out}`)
