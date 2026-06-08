// Generate `plattenplausch-sheet.xlsx` with all four tabs pre-built, ready to
// import into Google Sheets. Zero dependencies — an .xlsx is a zip of XML parts.
//
// Tabs:
//   Players      — seeded from src/players.json (id,name,club,position,price)
//   Scores       — one row per player, MD1..MD22 + playerTotal (=SUM)
//   Submissions  — header row only (the Apps Script appends rows here)
//   Ranking      — formula-driven rank/teamName/total over ACTIVE confirmed teams
//
// Run: node scripts/make-sheet.mjs   →   plattenplausch-sheet.xlsx
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'

const players = JSON.parse(readFileSync(new URL('../src/players.json', import.meta.url)))
const ROSTER_SIZE = 6
const MATCHDAYS = 22 // TTBL-ish; trim/extend as you like

// ----- minimal XLSX writer (inline strings + formulas, no shared strings) -----
const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
function colName(n) {
  // 1-based column index → A, B, ... Z, AA, AB ...
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = COLS[r] + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
// cell: {v: value} number, {t:'s', v:str} string, {f:'FORMULA'} formula
function cellXml(ref, cell) {
  if (cell == null || cell === '') return ''
  if (cell.f != null) return `<c r="${ref}"><f>${esc(cell.f)}</f></c>`
  if (cell.t === 's') return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`
  return `<c r="${ref}"><v>${cell.v}</v></c>`
}
function sheetXml(rows) {
  let body = ''
  rows.forEach((row, ri) => {
    const r = ri + 1
    let cells = ''
    row.forEach((cell, ci) => {
      cells += cellXml(colName(ci + 1) + r, cell)
    })
    body += `<row r="${r}">${cells}</row>`
  })
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}
const S = (v) => ({ t: 's', v }) // string cell
const N = (v) => ({ v }) // number cell
const F = (f) => ({ f }) // formula cell

// ----------------------------- Players ------------------------------------
const playersRows = [
  [S('id'), S('name'), S('club'), S('position'), S('price')],
  ...players.map((p) => [S(p.id), S(p.name), S(p.club), S(p.position), N(p.price)]),
]

// ----------------------------- Scores -------------------------------------
// id | name | MD1..MDn | playerTotal(=SUM of MD range)
const scoresHeader = [S('id'), S('name')]
for (let m = 1; m <= MATCHDAYS; m++) scoresHeader.push(S('MD' + m))
scoresHeader.push(S('playerTotal'))
const firstMdCol = colName(3) // C
const lastMdCol = colName(2 + MATCHDAYS)
const totalColIdx = 3 + MATCHDAYS // 1-based col of playerTotal
const scoresRows = [scoresHeader]
players.forEach((p, i) => {
  const r = i + 2 // sheet row (1=header)
  const row = [S(p.id), S(p.name)]
  for (let m = 1; m <= MATCHDAYS; m++) row.push(N(0)) // seed all matchdays = 0
  row.push(F(`SUM(${firstMdCol}${r}:${lastMdCol}${r})`))
  scoresRows.push(row)
})

// ----------------------------- Submissions --------------------------------
// HEADER ONLY. The Apps Script uses appendRow(), which lands on the first fully
// empty row — so we must NOT pre-fill any data/helper rows here, or appends
// would skip past them. All "active" + "teamTotal" logic lives in the Ranking
// tab as whole-column array formulas instead.
// Layout: submittedAt|email|teamName|p1..p6|token|confirmed|confirmedAt|superseded
const subHeader = [S('submittedAt'), S('email'), S('teamName')]
for (let i = 1; i <= ROSTER_SIZE; i++) subHeader.push(S('p' + i))
subHeader.push(S('token'), S('confirmed'), S('confirmedAt'), S('superseded'))
const subRows = [subHeader]

// Submissions column letters referenced from Ranking formulas:
const colSubmittedAt = colName(1) // A
const colTeamName = colName(3) // C
const colP1 = colName(4) // D
const colPN = colName(3 + ROSTER_SIZE) // I (for roster 6)
// After p1..pN come: token, confirmed, confirmedAt, superseded.
const colConfirmed = colName(3 + ROSTER_SIZE + 2) // K — confirmed
const colSuperseded = colName(3 + ROSTER_SIZE + 4) // M — superseded
const scoreId = `Scores!$A$2:$A$${players.length + 1}`
const scoreTotal = `Scores!$${colName(totalColIdx)}$2:$${colName(totalColIdx)}$${players.length + 1}`

// ----------------------------- Ranking ------------------------------------
// Self-contained. Helper columns E:G (hidden conceptually) compute, per
// Submissions data row: active flag, teamTotal, submittedAt — as whole-column
// array formulas anchored in E2/F2/G2. Then A/B/C produce the sorted standings.
//
// active   = confirmed=TRUE AND superseded<>TRUE AND teamName not blank
// teamTotal= SUMPRODUCT over the 6 picks XLOOKUP'd into Scores.playerTotal
const subTeamRange = `Submissions!$${colTeamName}$2:$${colTeamName}`
const subConfirmed = `Submissions!$${colConfirmed}$2:$${colConfirmed}`
const subSuperseded = `Submissions!$${colSuperseded}$2:$${colSuperseded}`
const subSubmitted = `Submissions!$${colSubmittedAt}$2:$${colSubmittedAt}`
const subPicks = `Submissions!$${colP1}$2:$${colPN}`

// E2: active flag per row (array). BYROW evaluates each data row.
const activeArr =
  `=MAP(${subTeamRange},${subConfirmed},${subSuperseded},` +
  `LAMBDA(tn,cf,ss,IF(tn="","",IF(AND(cf=TRUE,ss<>TRUE),TRUE,FALSE))))`
// F2: teamTotal per row (array) — sum each row's 6 picks via XLOOKUP into Scores.
const totalArr =
  `=BYROW(${subPicks},LAMBDA(row,` +
  `IF(INDEX(row,1,1)="","",SUMPRODUCT(IFERROR(XLOOKUP(row,${scoreId},${scoreTotal}),0)))))`
// G2: submittedAt mirror (array), for the tie-break sort key.
const submittedArr = `=ARRAYFORMULA(IF(${subTeamRange}="","",${subSubmitted}))`
// H2: teamName mirror (array) — used as the FILTER source so the visible B
// column never references itself (which would be circular).
const teamArr = `=ARRAYFORMULA(IF(${subTeamRange}="","",${subTeamRange}))`

const rankRows = [
  // A1:C1 visible headers; E1:H1 helper headers (E:H can be hidden in the UI)
  [
    S('rank'),
    S('teamName'),
    S('total'),
    S(''),
    S('active'),
    S('teamTotal'),
    S('submittedAt'),
    S('teamNameSrc'),
  ],
  [
    // A2: rank numbers for as many rows as B2 spills.
    F('IF(COUNTA(B2:B)=0,"",SEQUENCE(COUNTA(B2:B)))'),
    // B2: sorted teamName of active rows. FILTER source = helpers H/F/G (NOT B).
    // Sort keys: total desc, submittedAt asc, teamName asc.
    F(
      `IFERROR(INDEX(SORT(FILTER({$H$2:$H,$F$2:$F,$G$2:$G},$E$2:$E=TRUE),2,FALSE,3,TRUE,1,TRUE),0,1),"")`
    ),
    // C2: matching total column.
    F(
      `IFERROR(INDEX(SORT(FILTER({$H$2:$H,$F$2:$F,$G$2:$G},$E$2:$E=TRUE),2,FALSE,3,TRUE,1,TRUE),0,2),"")`
    ),
    S(''),
    // E2/F2/G2/H2 helper arrays (formula strings include leading '='; strip it).
    { f: activeArr.slice(1) },
    { f: totalArr.slice(1) },
    { f: submittedArr.slice(1) },
    { f: teamArr.slice(1) },
  ],
]

// ----------------------------- assemble xlsx -------------------------------
const sheets = [
  { name: 'Submissions', xml: sheetXml(subRows) },
  { name: 'Players', xml: sheetXml(playersRows) },
  { name: 'Scores', xml: sheetXml(scoresRows) },
  { name: 'Ranking', xml: sheetXml(rankRows) },
]

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets
  .map(
    (s, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )
  .join('\n')}
</Types>`

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('\n')}
</sheets>
</workbook>`

const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (s, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  )
  .join('\n')}
</Relationships>`

// ----- write a minimal ZIP (store/deflate) ourselves -----
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}
const files = [
  ['[Content_Types].xml', contentTypes],
  ['_rels/.rels', rootRels],
  ['xl/workbook.xml', workbook],
  ['xl/_rels/workbook.xml.rels', workbookRels],
  ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, s.xml]),
]

const locals = []
const centrals = []
let offset = 0
for (const [name, content] of files) {
  const nameBuf = Buffer.from(name, 'utf8')
  const data = Buffer.from(content, 'utf8')
  const comp = deflateRawSync(data)
  const crc = crc32(data)
  const lh = Buffer.alloc(30)
  lh.writeUInt32LE(0x04034b50, 0)
  lh.writeUInt16LE(20, 4)
  lh.writeUInt16LE(0, 6)
  lh.writeUInt16LE(8, 8) // deflate
  lh.writeUInt16LE(0, 10)
  lh.writeUInt16LE(0, 12)
  lh.writeUInt32LE(crc, 14)
  lh.writeUInt32LE(comp.length, 18)
  lh.writeUInt32LE(data.length, 22)
  lh.writeUInt16LE(nameBuf.length, 26)
  lh.writeUInt16LE(0, 28)
  locals.push(lh, nameBuf, comp)

  const ch = Buffer.alloc(46)
  ch.writeUInt32LE(0x02014b50, 0)
  ch.writeUInt16LE(20, 4)
  ch.writeUInt16LE(20, 6)
  ch.writeUInt16LE(0, 8)
  ch.writeUInt16LE(8, 10)
  ch.writeUInt16LE(0, 12)
  ch.writeUInt16LE(0, 14)
  ch.writeUInt32LE(crc, 16)
  ch.writeUInt32LE(comp.length, 20)
  ch.writeUInt32LE(data.length, 24)
  ch.writeUInt16LE(nameBuf.length, 28)
  ch.writeUInt16LE(0, 30)
  ch.writeUInt16LE(0, 32)
  ch.writeUInt16LE(0, 34)
  ch.writeUInt16LE(0, 36)
  ch.writeUInt32LE(0, 38)
  ch.writeUInt32LE(offset, 42)
  centrals.push(ch, nameBuf)

  offset += lh.length + nameBuf.length + comp.length
}
const centralStart = offset
const centralBuf = Buffer.concat(centrals)
const eocd = Buffer.alloc(22)
eocd.writeUInt32LE(0x06054b50, 0)
eocd.writeUInt16LE(0, 4)
eocd.writeUInt16LE(0, 6)
eocd.writeUInt16LE(files.length, 8)
eocd.writeUInt16LE(files.length, 10)
eocd.writeUInt32LE(centralBuf.length, 12)
eocd.writeUInt32LE(centralStart, 16)
eocd.writeUInt16LE(0, 20)

const zip = Buffer.concat([...locals, centralBuf, eocd])
const out = new URL('../plattenplausch-sheet.xlsx', import.meta.url)
writeFileSync(out, zip)
console.log(`Wrote plattenplausch-sheet.xlsx (${zip.length} bytes)`)
console.log(`  Players: ${players.length} rows | Scores: ${MATCHDAYS} matchdays | Submissions: header only (appendRow lands on row 2)`)
