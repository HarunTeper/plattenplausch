// End-to-end smoke test against the LIVE deployed system. Checks the things that
// have actually broken during development, so regressions are caught here rather
// than by a human clicking through the site.
//
// Usage:
//   node scripts/smoke.mjs
// Config (env or .env-style values passed inline):
//   SITE_URL   default https://harunteper.github.io/plattenplausch/
//   WEBAPP_URL the Apps Script /exec URL
//   CSV_URL    the published Ranking_Gesamt CSV URL
// If WEBAPP_URL / CSV_URL are omitted, they're read from .env in the repo root.
import { readFileSync } from 'node:fs'

function loadEnv() {
  try {
    const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    const env = {}
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/)
      if (m) env[m[1]] = m[2]
    }
    return env
  } catch {
    return {}
  }
}
const env = loadEnv()
const SITE = process.env.SITE_URL || 'https://harunteper.github.io/plattenplausch/'
const WEBAPP = process.env.WEBAPP_URL || env.VITE_WEBAPP_URL || ''
const CSV = process.env.CSV_URL || env.VITE_RANKING_CSV_URL || ''

let pass = 0
let fail = 0
const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}
async function get(url) {
  const r = await fetch(url, { cache: 'no-store', redirect: 'follow' })
  return { status: r.status, ct: r.headers.get('content-type') || '', text: await r.text() }
}
async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow',
  })
  return { status: r.status, text: await r.text() }
}

console.log('\n=== Plattenplausch smoke test ===')
console.log('site:', SITE)
console.log('webapp:', WEBAPP ? WEBAPP.slice(0, 60) + '…' : '(missing)')
console.log('csv:', CSV ? CSV.slice(0, 70) + '…' : '(missing)')
console.log('')

// --- 1. Pages: each route serves HTML 200 with the right Alpine root ---
for (const [page, xdata] of [
  ['index.html', 'draft'],
  ['ranking.html', 'ranking'],
  ['confirm.html', 'confirm'],
]) {
  try {
    const res = await get(SITE + page)
    const okHtml = res.status === 200 && res.text.includes(`x-data="${xdata}"`)
    check(`page ${page} serves & has x-data="${xdata}"`, okHtml, `HTTP ${res.status}`)
    // The JS bundle for that page must register the matching Alpine component.
    if (page === 'confirm.html') {
      const asset = (res.text.match(/assets\/main-[^"']+\.js/) || [])[0]
      const js = asset ? (await get(SITE + asset)).text : ''
      check(
        'bundle registers confirm component + has lookup/doConfirm',
        /\.data\(["']confirm["']/.test(js) && js.includes('doConfirm') && js.includes('lookup'),
        asset || 'no asset'
      )
      check('bundle has SW kill-switch (unregister)', js.includes('unregister'))
      check('no service worker (sw.js 404)', (await get(SITE + 'sw.js')).status === 404)
    }
  } catch (e) {
    check(`page ${page} reachable`, false, e.message)
  }
}

// --- 2. Ranking CSV: must be real CSV (not an HTML login wall), parseable ---
if (!CSV) {
  check('CSV_URL configured', false, 'set VITE_RANKING_CSV_URL')
} else {
  try {
    const res = await get(CSV)
    const isHtml = res.text.trimStart().startsWith('<')
    check('ranking CSV returns 200 + text/csv (not login HTML)', res.status === 200 && !isHtml, `HTTP ${res.status} ${res.ct}`)
    if (!isHtml) {
      const header = res.text.split('\n')[0].trim().toLowerCase()
      check('ranking CSV header is rank,teamName,total', header === 'rank,teamname,total', header)
    }
  } catch (e) {
    check('ranking CSV reachable', false, e.message)
  }
}

// --- 3. Backend: lookup endpoint responds with JSON (not the GAS HTML page) ---
if (!WEBAPP) {
  check('WEBAPP_URL configured', false, 'set VITE_WEBAPP_URL')
} else {
  try {
    // A bogus token must return {ok:false,error:"not-found"} as JSON — proves the
    // action router works and the deployment is current.
    const res = await post(WEBAPP, { action: 'lookup', token: 'smoke-test-bogus-token' })
    let json = null
    try { json = JSON.parse(res.text) } catch {}
    check(
      'backend lookup returns JSON {ok:false,not-found} for bogus token',
      json && json.ok === false && json.error === 'not-found',
      json ? JSON.stringify(json) : res.text.slice(0, 80)
    )
  } catch (e) {
    check('backend reachable', false, e.message)
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`)
process.exit(fail ? 1 : 0)
