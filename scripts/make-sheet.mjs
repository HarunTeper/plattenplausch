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

const ROSTER_SIZE = 6

// Two independent drafts. Each round has its OWN Scores sheet, each numbered
// MD1..MD_ROUND from 1 (no continued 12..22 offset), its own player pool
// (distinct h*/r* ids), and its own player count.
const HIN_MATCHDAYS = 11 // matchdays in the Hinrunde
const RUECK_MATCHDAYS = 11 // matchdays in the Rückrunde

const byClub = (a, b) => a.club.localeCompare(b.club, 'de') || a.name.localeCompare(b.name, 'de')
const playersHin = JSON.parse(
  readFileSync(new URL('../src/players-hin.json', import.meta.url))
).sort(byClub)
const playersRueck = JSON.parse(
  readFileSync(new URL('../src/players-rueck.json', import.meta.url))
).sort(byClub)

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

// ----------------------------- Players_Hin / Players_Rueck -----------------
function playersTab(pool) {
  return [
    [S('id'), S('name'), S('club'), S('position'), S('price')],
    ...pool.map((p) => [S(p.id), S(p.name), S(p.club), S(p.position), N(p.price)]),
  ]
}
const playersHinRows = playersTab(playersHin)
const playersRueckRows = playersTab(playersRueck)

// ----------------------------- Scores_Hin / Scores_Rueck -------------------
// One Scores sheet PER ROUND, each numbered from MD1 (no offset). Layout:
//   id | name | club | MD1..MD<n> | total      total = SUM(MD1:MD<n>)
// Each round's sheet only lists that round's players (h* in Hin, r* in Rück),
// grouped by club. Organizer types MD1, MD2, … from 1 for that round.
const FIXED = 3 // id, name, club
function scoresTab(pool, matchdays) {
  const header = [S('id'), S('name'), S('club')]
  for (let m = 1; m <= matchdays; m++) header.push(S('MD' + m))
  header.push(S('total'))
  const firstMd = colName(FIXED + 1) // D
  const lastMd = colName(FIXED + matchdays)
  const rows = [header]
  pool.forEach((p, i) => {
    const r = i + 2
    const row = [S(p.id), S(p.name), S(p.club)]
    for (let m = 1; m <= matchdays; m++) row.push(N(0)) // seed matchdays = 0
    row.push(F(`SUM(${firstMd}${r}:${lastMd}${r})`)) // total
    rows.push(row)
  })
  return { rows, totalColIdx: FIXED + matchdays + 1, lastRow: pool.length + 1 }
}
const scoresHin = scoresTab(playersHin, HIN_MATCHDAYS)
const scoresRueck = scoresTab(playersRueck, RUECK_MATCHDAYS)

// Lookup helpers: id column + total column per round's Scores sheet.
const hinScoreId = `Scores_Hin!$A$2:$A$${scoresHin.lastRow}`
const hinScoreTotal = `Scores_Hin!$${colName(scoresHin.totalColIdx)}$2:$${colName(
  scoresHin.totalColIdx
)}$${scoresHin.lastRow}`
const rueckScoreId = `Scores_Rueck!$A$2:$A$${scoresRueck.lastRow}`
const rueckScoreTotal = `Scores_Rueck!$${colName(scoresRueck.totalColIdx)}$2:$${colName(
  scoresRueck.totalColIdx
)}$${scoresRueck.lastRow}`

// ----------------------------- Submissions --------------------------------
// HEADER ONLY. The Apps Script uses appendRow(), which lands on the first fully
// empty row — so we must NOT pre-fill any data/helper rows here, or appends
// would skip past them. All "active" + "teamTotal" logic lives in the Ranking
// tab as whole-column array formulas instead.
// Layout: submittedAt|email|teamName|round|p1..p6|token|confirmed|confirmedAt|superseded
const subHeader = [S('submittedAt'), S('email'), S('teamName'), S('round')]
for (let i = 1; i <= ROSTER_SIZE; i++) subHeader.push(S('p' + i))
subHeader.push(S('token'), S('confirmed'), S('confirmedAt'), S('superseded'))
const subRows = [subHeader]

// Submissions column letters referenced from Ranking formulas (round at D):
const colSubmittedAt = colName(1) // A
const colEmail = colName(2) // B
const colTeamName = colName(3) // C
const colRound = colName(4) // D
const colP1 = colName(5) // E
const colPN = colName(4 + ROSTER_SIZE) // J (for roster 6)
// After p1..pN come: token, confirmed, confirmedAt, superseded.
const colConfirmed = colName(4 + ROSTER_SIZE + 2) // L — confirmed
const colSuperseded = colName(4 + ROSTER_SIZE + 4) // N — superseded

// ----------------------------- Ranking tabs --------------------------------
// IMPORTANT: MAP/BYROW need EQUAL-LENGTH inputs and choke on open-ended column
// ranges (`$C$2:$C`). So every Submissions range is BOUNDED to the same fixed
// row count (rows 2..MAXSUB+1). MAXSUB is the max submissions the season can
// hold; bump it if you ever exceed it.
const MAXSUB = 1000
const LAST = MAXSUB + 1 // last sheet row referenced (1 = header)
const bsub = (col) => `Submissions!$${col}$2:$${col}$${LAST}` // bounded single col
const subEmailRange = bsub(colEmail)
const subTeamRange = bsub(colTeamName)
const subRoundRange = bsub(colRound)
const subConfirmed = bsub(colConfirmed)
const subSuperseded = bsub(colSuperseded)
const subSubmitted = bsub(colSubmittedAt)
const subPicks = `Submissions!$${colP1}$2:$${colPN}$${LAST}` // bounded picks block

// --- Per-round tables (Ranking_Hin / Ranking_Rueck) ---
// One row per active team in THAT round. active = confirmed AND not superseded
// AND teamName non-blank AND round matches. teamTotal = sum of the 6 picks
// XLOOKUP'd into the round's Scores total column. Helper cols E:H (hideable).
function buildRoundRankingRows(roundKey, scoreIdRange, scoreTotalRange) {
  // Bounded local helper-column ranges (same length as the Submissions ranges).
  const E = `$E$2:$E$${LAST}`
  const F_ = `$F$2:$F$${LAST}`
  const G = `$G$2:$G$${LAST}`
  const H = `$H$2:$H$${LAST}`

  // E: active in THIS round. All MAP inputs are bounded → equal length.
  const activeArr =
    `MAP(${subTeamRange},${subConfirmed},${subSuperseded},${subRoundRange},` +
    `LAMBDA(tn,cf,ss,rd,IF(tn="",FALSE,IF(AND(cf=TRUE,ss<>TRUE,rd="${roundKey}"),TRUE,FALSE))))`
  // F: team total per row — BYROW over the bounded picks block, XLOOKUP'd into
  //    THIS round's Scores sheet.
  const totalArr =
    `BYROW(${subPicks},LAMBDA(row,` +
    `IF(INDEX(row,1,1)="",0,SUMPRODUCT(IFERROR(XLOOKUP(row,${scoreIdRange},${scoreTotalRange}),0)))))`
  // G: submittedAt mirror; H: teamName mirror.
  const submittedArr = `ARRAYFORMULA(IF(${subTeamRange}="","",${subSubmitted}))`
  const teamArr = `ARRAYFORMULA(IF(${subTeamRange}="","",${subTeamRange}))`

  return [
    [S('rank'), S('teamName'), S('total'), S(''), S('active'), S('teamTotal'), S('submittedAt'), S('teamNameSrc')],
    [
      // rank: a running 1,2,3… over the non-blank teamName cells in B (spills in
      // lockstep with B, so tied teams still get distinct sequential ranks). SCAN
      // accumulates the count; blank rows stay "".
      F(`ARRAYFORMULA(IF($B$2:$B$${LAST}="","",SCAN(0,$B$2:$B$${LAST},LAMBDA(acc,v,IF(v="",acc,acc+1)))))`),
      F(`IFERROR(INDEX(SORT(FILTER({${H},${F_},${G}},${E}=TRUE),2,FALSE,3,TRUE,1,TRUE),0,1),"")`),
      F(`IFERROR(INDEX(SORT(FILTER({${H},${F_},${G}},${E}=TRUE),2,FALSE,3,TRUE,1,TRUE),0,2),"")`),
      S(''),
      F(activeArr),
      F(totalArr),
      F(submittedArr),
      F(teamArr),
    ],
  ]
}

// --- Combined table (Ranking_Gesamt) ---
// Gesamt = Hin points + Rück points, paired by EMAIL (missing round counts 0).
// PRIVACY: email is the join key but must NEVER appear in any cell on this tab
// (the tab is published to the web). So the ENTIRE aggregation happens inside a
// single LET in B2 / C2 — email lives only as a LET-local intermediate and is
// never written to a cell. There are NO helper columns: only A rank | B teamName
// | C total. Nothing returnable contains an address.
//
// Inside the LET (per output cell):
//   act   = active mask (confirmed, not superseded, non-blank teamName)
//   eml   = email where active else ""        (LET-local, never output)
//   tot   = each active row's round total (Hin→Scores_Hin, Rück→Scores_Rueck)
//   nm    = teamName where active else ""
//   sub   = submittedAt where active else ""
//   ue    = UNIQUE active emails              (LET-local, never output)
//   uTot  = SUMIF tot by ue ;  uName = team name per ue ;  uEarl = MINIFS sub
//   sorted= SORT {uName,uTot,uEarl} by total desc, earliest asc, name asc
// B2 outputs column 1 (name); C2 outputs column 2 (total).
function buildGesamtRankingRows() {

  // Shared LET preamble computing the sorted aggregate. `outCol` picks which
  // column of the sorted result this cell emits (1=teamName, 2=total).
  // CRITICAL: inside LET, a bare `IF(actArray=TRUE, rangeA, rangeB)` does NOT
  // gate element-wise — Sheets evaluates the condition as a single truthy test
  // and returns the WHOLE rangeA, pulling in unconfirmed rows. So every per-row
  // value is built with MAP (which IS element-wise), gating each row by its own
  // confirmed/superseded/teamName. `pickTotalFor(rd, idx)` sums a row's 6 picks
  // against the round's Scores sheet.
  const pickRow = `INDEX(${subPicks},i,0)`
  const hinRowSum = `SUMPRODUCT(IFERROR(XLOOKUP(${pickRow},${hinScoreId},${hinScoreTotal}),0))`
  const rueckRowSum = `SUMPRODUCT(IFERROR(XLOOKUP(${pickRow},${rueckScoreId},${rueckScoreTotal}),0))`
  const sortedLet = (outCol) =>
    `IFERROR(LET(` +
    `n,ROWS(${subTeamRange}),` +
    `idx,SEQUENCE(n),` +
    // eml: this row's email IF active, else "" — computed per row via MAP.
    `eml,MAP(${subTeamRange},${subConfirmed},${subSuperseded},${subEmailRange},` +
    `LAMBDA(tn,cf,ss,em,IF(AND(tn<>"",cf=TRUE,ss<>TRUE),em,""))),` +
    // tot: this row's round-appropriate team total IF active, else 0.
    `tot,MAP(${subTeamRange},${subConfirmed},${subSuperseded},${subRoundRange},idx,` +
    `LAMBDA(tn,cf,ss,rd,i,IF(AND(tn<>"",cf=TRUE,ss<>TRUE),IF(rd="HIN",${hinRowSum},IF(rd="RUECK",${rueckRowSum},0)),0))),` +
    // nm / sub mirrors gated the same way.
    `nm,MAP(${subTeamRange},${subConfirmed},${subSuperseded},LAMBDA(tn,cf,ss,IF(AND(tn<>"",cf=TRUE,ss<>TRUE),tn,""))),` +
    `sub,MAP(${subTeamRange},${subConfirmed},${subSuperseded},${subSubmitted},LAMBDA(tn,cf,ss,sb,IF(AND(tn<>"",cf=TRUE,ss<>TRUE),sb,""))),` +
    `ue,UNIQUE(FILTER(eml,eml<>"")),` +
    `uTot,MAP(ue,LAMBDA(e,SUMPRODUCT((eml=e)*IF(ISNUMBER(tot),tot,0)))),` +
    `uName,MAP(ue,LAMBDA(e,INDEX(FILTER(nm,eml=e),1))),` +
    `uEarl,MAP(ue,LAMBDA(e,MINIFS(sub,eml,e))),` +
    `sorted,SORT(HSTACK(uName,uTot,uEarl),2,FALSE,3,TRUE,1,TRUE),` +
    `INDEX(sorted,0,${outCol})),"")`

  return [
    [S('rank'), S('teamName'), S('total')],
    [
      // rank: running 1,2,3… over non-blank teamName cells in B (ties already
      // broken inside the sort, so each gets a distinct sequential rank).
      F(`ARRAYFORMULA(IF($B$2:$B$${LAST}="","",SCAN(0,$B$2:$B$${LAST},LAMBDA(acc,v,IF(v="",acc,acc+1)))))`),
      F(sortedLet(1)), // B2: teamName (spills)
      F(sortedLet(2)), // C2: total (spills)
    ],
  ]
}

const rankHinRows = buildRoundRankingRows('HIN', hinScoreId, hinScoreTotal)
const rankRueckRows = buildRoundRankingRows('RUECK', rueckScoreId, rueckScoreTotal)
const rankGesamtRows = buildGesamtRankingRows()

// ----------------------------- assemble xlsx -------------------------------
const sheets = [
  { name: 'Submissions', xml: sheetXml(subRows) },
  { name: 'Players_Hin', xml: sheetXml(playersHinRows) },
  { name: 'Players_Rueck', xml: sheetXml(playersRueckRows) },
  { name: 'Scores_Hin', xml: sheetXml(scoresHin.rows) },
  { name: 'Scores_Rueck', xml: sheetXml(scoresRueck.rows) },
  { name: 'Ranking_Gesamt', xml: sheetXml(rankGesamtRows) },
  { name: 'Ranking_Hin', xml: sheetXml(rankHinRows) },
  { name: 'Ranking_Rueck', xml: sheetXml(rankRueckRows) },
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
console.log(
  `  Players_Hin: ${playersHin.length} | Players_Rueck: ${playersRueck.length}`
)
console.log(
  `  Scores_Hin: ${playersHin.length} rows, MD1..MD${HIN_MATCHDAYS} | Scores_Rueck: ${playersRueck.length} rows, MD1..MD${RUECK_MATCHDAYS}`
)
console.log('  Rankings: Ranking_Gesamt (email-join, website reads this), Ranking_Hin, Ranking_Rueck')
