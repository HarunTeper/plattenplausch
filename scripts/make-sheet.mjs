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

// Two independent drafts. Hinrunde = MD1..HIN_MATCHDAYS, Rückrunde = the rest up
// to MATCHDAYS. Each round has its own player pool (distinct h*/r* ids).
const HIN_MATCHDAYS = 11 // matchdays in the Hinrunde
const MATCHDAYS = 22 // total matchdays (Hin + Rück)

const byClub = (a, b) => a.club.localeCompare(b.club, 'de') || a.name.localeCompare(b.name, 'de')
const playersHin = JSON.parse(
  readFileSync(new URL('../src/players-hin.json', import.meta.url))
).sort(byClub)
const playersRueck = JSON.parse(
  readFileSync(new URL('../src/players-rueck.json', import.meta.url))
).sort(byClub)

// Scores has ONE row per listing across BOTH pools (ids never overlap): an
// h-listing scores MD1..MD11, an r-listing scores MD12..MD22; the off-round
// matchday cells stay 0. Hin listings first, then Rück, each grouped by club.
const scoresPlayers = [...playersHin, ...playersRueck]

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

// ----------------------------- Scores -------------------------------------
// id | name | club | round | MD1..MDn | hinTotal | rueckTotal | playerTotal
// hinTotal   = SUM(MD1..MD<HIN_MATCHDAYS>)   (only meaningful for h* listings)
// rueckTotal = SUM(MD<HIN+1>..MD<MATCHDAYS>) (only meaningful for r* listings)
// playerTotal= hinTotal + rueckTotal
const scoresHeader = [S('id'), S('name'), S('club'), S('round')]
for (let m = 1; m <= MATCHDAYS; m++) scoresHeader.push(S('MD' + m))
scoresHeader.push(S('hinTotal'), S('rueckTotal'), S('playerTotal'))

const FIXED = 4 // id,name,club,round
const firstMdCol = colName(FIXED + 1) // E
const hinLastCol = colName(FIXED + HIN_MATCHDAYS)
const rueckFirstCol = colName(FIXED + HIN_MATCHDAYS + 1)
const lastMdCol = colName(FIXED + MATCHDAYS)
const hinTotalIdx = FIXED + MATCHDAYS + 1
const rueckTotalIdx = FIXED + MATCHDAYS + 2
const totalColIdx = FIXED + MATCHDAYS + 3
const hinTotalCol = colName(hinTotalIdx)
const rueckTotalCol = colName(rueckTotalIdx)
const playerTotalCol = colName(totalColIdx)
const scoresLastRow = scoresPlayers.length + 1

const scoresRows = [scoresHeader]
scoresPlayers.forEach((p, i) => {
  const r = i + 2 // sheet row (1=header)
  const round = String(p.id).charAt(0) === 'r' ? 'RUECK' : 'HIN'
  const row = [S(p.id), S(p.name), S(p.club), S(round)]
  for (let m = 1; m <= MATCHDAYS; m++) row.push(N(0)) // seed all matchdays = 0
  row.push(F(`SUM(${firstMdCol}${r}:${hinLastCol}${r})`)) // hinTotal
  row.push(F(`SUM(${rueckFirstCol}${r}:${lastMdCol}${r})`)) // rueckTotal
  row.push(F(`${hinTotalCol}${r}+${rueckTotalCol}${r}`)) // playerTotal
  scoresRows.push(row)
})

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
const scoreId = `Scores!$A$2:$A$${scoresLastRow}`
const scoreRange = (col) => `Scores!$${col}$2:$${col}$${scoresLastRow}`

// ----------------------------- Ranking tabs --------------------------------
// Shared Submissions ranges.
const subEmailRange = `Submissions!$${colEmail}$2:$${colEmail}`
const subTeamRange = `Submissions!$${colTeamName}$2:$${colTeamName}`
const subRoundRange = `Submissions!$${colRound}$2:$${colRound}`
const subConfirmed = `Submissions!$${colConfirmed}$2:$${colConfirmed}`
const subSuperseded = `Submissions!$${colSuperseded}$2:$${colSuperseded}`
const subSubmitted = `Submissions!$${colSubmittedAt}$2:$${colSubmittedAt}`
const subPicks = `Submissions!$${colP1}$2:$${colPN}`

// --- Per-round tables (Ranking_Hin / Ranking_Rueck) ---
// One row per active team in THAT round. active = confirmed AND not superseded
// AND teamName non-blank AND round matches. teamTotal = sum of the 6 picks
// XLOOKUP'd into the round's Scores total column. Helper cols E:H (hideable).
function buildRoundRankingRows(roundKey, scoreTotalCol) {
  const scoreTotal = scoreRange(scoreTotalCol)
  const activeArr =
    `MAP(${subTeamRange},${subConfirmed},${subSuperseded},${subRoundRange},` +
    `LAMBDA(tn,cf,ss,rd,IF(tn="","",IF(AND(cf=TRUE,ss<>TRUE,rd="${roundKey}"),TRUE,FALSE))))`
  const totalArr =
    `BYROW(${subPicks},LAMBDA(row,` +
    `IF(INDEX(row,1,1)="","",SUMPRODUCT(IFERROR(XLOOKUP(row,${scoreId},${scoreTotal}),0)))))`
  const submittedArr = `ARRAYFORMULA(IF(${subTeamRange}="","",${subSubmitted}))`
  const teamArr = `ARRAYFORMULA(IF(${subTeamRange}="","",${subTeamRange}))`

  return [
    [S('rank'), S('teamName'), S('total'), S(''), S('active'), S('teamTotal'), S('submittedAt'), S('teamNameSrc')],
    [
      F('IF(COUNTA(B2:B)=0,"",SEQUENCE(COUNTA(B2:B)))'),
      F(`IFERROR(INDEX(SORT(FILTER({$H$2:$H,$F$2:$F,$G$2:$G},$E$2:$E=TRUE),2,FALSE,3,TRUE,1,TRUE),0,1),"")`),
      F(`IFERROR(INDEX(SORT(FILTER({$H$2:$H,$F$2:$F,$G$2:$G},$E$2:$E=TRUE),2,FALSE,3,TRUE,1,TRUE),0,2),"")`),
      S(''),
      F(activeArr),
      F(totalArr),
      F(submittedArr),
      F(teamArr),
    ],
  ]
}

// --- Combined table (Ranking_Gesamt) ---
// Gesamt = Hin points + Rück points, paired by EMAIL (missing round counts as
// 0). Each active row contributes its round-appropriate total. We then aggregate
// by distinct email: total = SUMIFS over active rows of that email; name = the
// team name on that email's rows (fixed per email); tie-break = earliest
// submittedAt for that email. Email is used only for the in-sheet join — never
// emitted. Helper cols E:I hold per-row arrays; J:L aggregate per distinct email.
// Column map for Ranking_Gesamt:
//   A rank | B teamName | C total           (visible output)
//   E active | F email | G rowTotal | H teamNameSrc | I submittedAt   (per-row arrays)
//   K uEmail | L uTotal | M uName | N uEarliest                       (per-email aggregate)
// Email is used only for the in-sheet join — never emitted to A:C.
function buildGesamtRankingRows() {
  const hinTotal = scoreRange(hinTotalCol)
  const rueckTotal = scoreRange(rueckTotalCol)
  const nRows = `ROWS(${subRoundRange})`

  // E: active (any round). Blank string for inactive/empty rows.
  const activeArr =
    `MAP(${subTeamRange},${subConfirmed},${subSuperseded},` +
    `LAMBDA(tn,cf,ss,IF(tn="","",IF(AND(cf=TRUE,ss<>TRUE),TRUE,FALSE))))`
  // F: email of active rows (else "").
  const emailArr = `ARRAYFORMULA(IF($E$2:$E=TRUE,${subEmailRange},""))`
  // G: each active row's round-appropriate team total. MAP over (round, picks-row)
  //    using INDEX to slice each row's 6 pick cells; Hin→hinTotal, Rück→rueckTotal.
  const rowTotal =
    `MAP(${subRoundRange},SEQUENCE(${nRows}),LAMBDA(rd,i,` +
    `IF(INDEX($E$2:$E,i)<>TRUE,"",` +
    `LET(picks,INDEX(${subPicks},i,0),` +
    `IF(rd="HIN",SUMPRODUCT(IFERROR(XLOOKUP(picks,${scoreId},${hinTotal}),0)),` +
    `IF(rd="RUECK",SUMPRODUCT(IFERROR(XLOOKUP(picks,${scoreId},${rueckTotal}),0)),0))))))`
  // H: teamName of active rows; I: submittedAt of active rows.
  const teamArr = `ARRAYFORMULA(IF($E$2:$E=TRUE,${subTeamRange},""))`
  const submittedArr = `ARRAYFORMULA(IF($E$2:$E=TRUE,${subSubmitted},""))`

  // K: distinct active emails (spills). L/M/N: aggregates mapped over the K spill
  // (MAP handles the per-cell blank guard, so no outer wrapper needed).
  const distinctEmails = `IFERROR(UNIQUE(FILTER($F$2:$F,$F$2:$F<>"")),"")`
  const sumByEmail = `MAP($K$2:$K,LAMBDA(e,IF(e="","",SUMIF($F$2:$F,e,$G$2:$G))))`
  const nameByEmail =
    `MAP($K$2:$K,LAMBDA(e,IF(e="","",IFERROR(INDEX(FILTER($H$2:$H,$F$2:$F=e),1),""))))`
  const earliestByEmail = `MAP($K$2:$K,LAMBDA(e,IF(e="","",MINIFS($I$2:$I,$F$2:$F,e))))`

  return [
    [
      S('rank'), S('teamName'), S('total'), S(''),
      S('active'), S('email'), S('rowTotal'), S('teamNameSrc'), S('submittedAt'), S(''),
      S('uEmail'), S('uTotal'), S('uName'), S('uEarliest'),
    ],
    [
      // A2: ranks for as many distinct teams as B spills.
      F('IF(COUNTA(B2:B)=0,"",SEQUENCE(COUNTA(B2:B)))'),
      // B2/C2: sort per-email aggregate {uName,uTotal,uEarliest} (M/L/N) by
      // total desc → earliest asc → name asc. FILTER drops blank-email rows.
      F(`IFERROR(INDEX(SORT(FILTER({$M$2:$M,$L$2:$L,$N$2:$N},$K$2:$K<>""),2,FALSE,3,TRUE,1,TRUE),0,1),"")`),
      F(`IFERROR(INDEX(SORT(FILTER({$M$2:$M,$L$2:$L,$N$2:$N},$K$2:$K<>""),2,FALSE,3,TRUE,1,TRUE),0,2),"")`),
      S(''),
      F(activeArr), // E2
      F(emailArr), // F2
      F(rowTotal), // G2
      F(teamArr), // H2
      F(submittedArr), // I2
      S(''), // J2 spacer
      F(distinctEmails), // K2
      F(sumByEmail), // L2
      F(nameByEmail), // M2
      F(earliestByEmail), // N2
    ],
  ]
}

const rankHinRows = buildRoundRankingRows('HIN', hinTotalCol)
const rankRueckRows = buildRoundRankingRows('RUECK', rueckTotalCol)
const rankGesamtRows = buildGesamtRankingRows()

// ----------------------------- assemble xlsx -------------------------------
const sheets = [
  { name: 'Submissions', xml: sheetXml(subRows) },
  { name: 'Players_Hin', xml: sheetXml(playersHinRows) },
  { name: 'Players_Rueck', xml: sheetXml(playersRueckRows) },
  { name: 'Scores', xml: sheetXml(scoresRows) },
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
  `  Players_Hin: ${playersHin.length} | Players_Rueck: ${playersRueck.length} | Scores rows: ${scoresPlayers.length}`
)
console.log(
  `  Scores split: MD1..MD${HIN_MATCHDAYS} Hin + MD${HIN_MATCHDAYS + 1}..MD${MATCHDAYS} Rück`
)
console.log('  Rankings: Ranking_Gesamt (email-join, website reads this), Ranking_Hin, Ranking_Rueck')
