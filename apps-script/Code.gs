/**
 * Plattenplausch — Table Tennis Fantasy League backend.
 *
 * Google Apps Script Web App. Deploy as: Execute as ME, Anyone can access.
 * The bound spreadsheet is the system of record. No external host/DB/SMTP.
 *
 * Data flow:
 *   doPost  → validate, write PENDING row, email a confirm link.
 *   doGet   → render a click-through page; the button's action confirms.
 *   confirm → set confirmed=TRUE, recompute supersession (latest wins).
 *
 * SECURITY NOTES:
 *   - Turnstile SECRET lives only in Script Properties (key: TURNSTILE_SECRET).
 *   - The deadline (SEASON_LOCK) is enforced ONLY in doPost. doGet/confirm never
 *     re-check it (a late confirm of an already-valid row must still succeed).
 *   - Prices are looked up server-side from the Players sheet — never trusted
 *     from the payload.
 */

// ----------------------------- CONFIG (authoritative) -----------------------
var BUDGET = 100;
var ROSTER_SIZE = 6; // → columns p1..p6 in Submissions
var POSITION_RULES = {
  Abwehr: { max: 2 },
  Allrounder: { max: 4 },
  Offensiv: { max: 5 },
};

// Two independent drafts. Each round has its own submission deadline. The round
// is resolved SERVER-SIDE from these locks (the client's `round` is a hint only):
//   now <  HIN_LOCK              → 'HIN'   draft open
//   HIN_LOCK <= now < RUECK_LOCK → 'RUECK' draft open
//   now >= RUECK_LOCK            → null    both closed (doPost rejects)
// Keep these in sync with ROUNDS in src/config.js.
var HIN_LOCK = new Date('2026-09-01T12:00:00+02:00');
var RUECK_LOCK = new Date('2027-01-15T12:00:00+01:00');

function currentRound_(now) {
  now = now || new Date();
  if (now < HIN_LOCK) return 'HIN';
  if (now < RUECK_LOCK) return 'RUECK';
  return null;
}

var TEAM_NAME_MAX = 40;
var TEAM_NAME_MIN = 2;

// Anti-abuse limits.
var MAX_PENDING_PER_EMAIL_PER_HOUR = 3; // reject the Nth+ pending submit/hour/email
var MAIL_CEILING_HOUR = 60; // global confirm-emails/hour ceiling
var MAIL_CEILING_DAY = 60; // global confirm-emails/day (consumer Gmail ≈ 100/day;
// kept well under quota to limit blast radius if Turnstile is ever defeated)
var PRUNE_UNCONFIRMED_AFTER_HOURS = 48; // time-trigger prunes older unconfirmed rows

// Simple profanity stoplist (extend as needed). Substring, case-insensitive.
var PROFANITY = ['arsch', 'fick', 'hurensohn', 'nazi', 'fuck', 'shit', 'bitch'];

var SHEET_SUBMISSIONS = 'Submissions';
// Per-round player pools (distinct h*/r* ids; a player may change club per round).
var SHEET_PLAYERS = { HIN: 'Players_Hin', RUECK: 'Players_Rueck' };

// Submissions column order (1-based). Keep in sync with the README sheet spec.
// submittedAt, email, teamName, round, p1..pN, token, confirmed, confirmedAt, superseded
function submissionsHeader_() {
  var h = ['submittedAt', 'email', 'teamName', 'round'];
  for (var i = 1; i <= ROSTER_SIZE; i++) h.push('p' + i);
  h.push('token', 'confirmed', 'confirmedAt', 'superseded');
  return h;
}

// ----------------------------- ENTRY POINTS --------------------------------

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // 1. Honeypot — a bot filled the hidden field.
    if (body.honeypot && String(body.honeypot).trim() !== '') {
      return json_({ ok: false, error: 'Ungültige Anfrage.' });
    }

    // 2. Turnstile FIRST (before touching the sheet).
    if (!verifyTurnstile_(body.turnstileToken)) {
      return json_({ ok: false, error: 'Sicherheits-Check fehlgeschlagen. Bitte erneut versuchen.' });
    }

    // 3. Round — resolved SERVER-SIDE from the locks (client `round` ignored).
    //    This is the ONLY place the deadline is enforced.
    var round = currentRound_();
    if (!round) {
      return json_({ ok: false, error: 'Die Anmeldefrist ist abgelaufen. Beide Runden sind gesperrt.' });
    }

    // 4. Normalize + validate.
    var email = String(body.email || '').trim().toLowerCase();
    if (!isEmail_(email)) return json_({ ok: false, error: 'Ungültige E-Mail-Adresse.' });

    var teamName = String(body.teamName || '').trim();
    if (teamName.length < TEAM_NAME_MIN || teamName.length > TEAM_NAME_MAX) {
      return json_({ ok: false, error: 'Teamname muss 2–40 Zeichen lang sein.' });
    }
    // CSV/formula-injection guard: a teamName starting with = + - @ (or tab/CR)
    // becomes a LIVE formula when written to the Sheet / mirrored into the
    // published Ranking tabs — which could exfiltrate the Submissions email
    // column via =IMPORTDATA(...) etc. Reject such names outright.
    if (/^[=+\-@\t\r]/.test(teamName)) {
      return json_({ ok: false, error: 'Teamname darf nicht mit =, +, - oder @ beginnen.' });
    }
    if (hasProfanity_(teamName)) {
      return json_({ ok: false, error: 'Teamname enthält unzulässige Wörter.' });
    }

    var ids = Array.isArray(body.players) ? body.players.map(String) : [];
    if (ids.length !== ROSTER_SIZE) {
      return json_({ ok: false, error: 'Bitte genau ' + ROSTER_SIZE + ' Spieler:innen wählen.' });
    }
    if (new Set(ids).size !== ids.length) {
      return json_({ ok: false, error: 'Doppelte Spieler:innen sind nicht erlaubt.' });
    }

    // Validate against the OPEN round's pool (Players_Hin / Players_Rueck).
    var playerMap = loadPlayers_(round);
    var picked = [];
    for (var i = 0; i < ids.length; i++) {
      var p = playerMap[ids[i]];
      if (!p) return json_({ ok: false, error: 'Unbekannte:r Spieler:in: ' + ids[i] });
      picked.push(p);
    }

    // Prices looked up server-side — payload prices (if any) are ignored.
    var spent = picked.reduce(function (s, p) { return s + p.price; }, 0);
    if (spent > BUDGET) {
      return json_({ ok: false, error: 'Budget überschritten (' + spent + ' / ' + BUDGET + ').' });
    }

    // Position limits.
    var counts = {};
    for (var j = 0; j < picked.length; j++) {
      var pos = picked[j].position;
      counts[pos] = (counts[pos] || 0) + 1;
    }
    for (var posKey in POSITION_RULES) {
      var rule = POSITION_RULES[posKey];
      if (rule.max != null && (counts[posKey] || 0) > rule.max) {
        return json_({ ok: false, error: 'Zu viele ' + posKey + ' (max. ' + rule.max + ').' });
      }
    }

    // 5. Write + email under a lock.
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var sheet = getSheet_(SHEET_SUBMISSIONS, submissionsHeader_());

      // Name-lock: a team name is fixed per email for the whole season. If this
      // email already has ANY confirmed team (either round), its name must match
      // (normalized, case-insensitive). Only the roster may change per round.
      var existingName = confirmedTeamName_(sheet, email);
      if (existingName !== null && normName_(existingName) !== normName_(teamName)) {
        return json_({
          ok: false,
          error: 'Diese E-Mail ist als „' + existingName + '“ registriert. Bitte denselben Teamnamen verwenden.',
        });
      }

      // Per-email-per-round rate limit (pending in the last hour).
      if (countRecentPending_(sheet, email, round) >= MAX_PENDING_PER_EMAIL_PER_HOUR) {
        return json_({ ok: false, error: 'Zu viele offene Einreichungen. Bitte später erneut versuchen.' });
      }

      // Global mail ceiling guard (don't write a row we can't email about).
      if (!mailQuotaAvailable_()) {
        return json_({ ok: false, error: 'Das E-Mail-Kontingent ist vorübergehend erschöpft. Bitte später erneut versuchen.' });
      }

      var token = Utilities.getUuid();
      var now = new Date();
      var row = [now, email, teamName, round];
      for (var k = 0; k < ROSTER_SIZE; k++) row.push(ids[k]);
      row.push(token, false, '', false); // token, confirmed, confirmedAt, superseded
      sheet.appendRow(row);

      sendConfirmEmail_(email, teamName, token, round);
      bumpMailCounters_();
    } finally {
      lock.releaseLock();
    }

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: 'Serverfehler: ' + err });
  }
}

function doGet(e) {
  var token = e && e.parameter ? e.parameter.token : '';
  var action = e && e.parameter ? e.parameter.action : '';

  if (!token) {
    return htmlPage_('Plattenplausch', '<div class="big">🤔</div><h1>Link <em>unvollständig</em></h1><p>Diesem Bestätigungslink fehlt der Token. Bitte nutze den Link aus deiner E-Mail.</p>');
  }

  var found = findByToken_(token);
  if (!found) {
    return htmlPage_('Plattenplausch', '<div class="big">🔍</div><h1>Link <em>ungültig</em></h1><p>Wir konnten diese Einreichung nicht finden — vielleicht wurde sie bereits entfernt. Stelle dein Team einfach neu auf.</p>');
  }

  // The CONFIRM action only runs on the button POST-style click (action=confirm).
  // A passive GET (link preview / antivirus) lands here WITHOUT action → no confirm.
  if (action === 'confirm') {
    return confirmToken_(token);
  }

  if (found.confirmed) {
    return htmlPage_(
      'Bereits bestätigt',
      '<div class="big">✔</div><h1>Schon <em>bestätigt</em></h1><p>Dein Team <span class="team">' + esc_(found.teamName) + '</span> ist bereits fixiert. Alles gut!</p>' + rankingLink_()
    );
  }

  // Click-through page: show the team and a real confirm button.
  return confirmPromptPage_(found, token);
}

// ----------------------------- CONFIRM LOGIC -------------------------------

function confirmToken_(token) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_(SHEET_SUBMISSIONS, submissionsHeader_());
    var data = sheet.getDataRange().getValues();
    var col = colIndex_();
    var rowNum = -1;
    var rowObj = null;
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][col.token]) === String(token)) {
        rowNum = r + 1;
        rowObj = data[r];
        break;
      }
    }
    if (rowNum === -1) {
      return htmlPage_('Link ungültig', '<h1>Link ungültig</h1><p>Einreichung nicht gefunden.</p>');
    }

    var teamName = rowObj[col.teamName];
    if (rowObj[col.confirmed] === true || String(rowObj[col.confirmed]).toUpperCase() === 'TRUE') {
      return htmlPage_(
        'Bereits bestätigt',
        '<div class="big">✔</div><h1>Schon <em>bestätigt</em></h1>' +
          '<p>Dein Team <span class="team">' + esc_(teamName) + '</span> war bereits fixiert. Alles gut!</p>' +
          rankingLink_()
      );
    }

    // Mark confirmed. NOTE: deadline is intentionally NOT re-checked here.
    sheet.getRange(rowNum, col.confirmed + 1).setValue(true);
    sheet.getRange(rowNum, col.confirmedAt + 1).setValue(new Date());

    // Recompute supersession scoped to (email, round): the latest confirmed
    // submittedAt in THIS round wins; the other round is untouched.
    recomputeSupersession_(
      sheet,
      String(rowObj[col.email]).trim().toLowerCase(),
      String(rowObj[col.round])
    );

    var roundLabel = roundLabel_(String(rowObj[col.round]));
    return htmlPage_(
      'Team bestätigt',
      '<div class="big">🏓</div>' +
        '<span class="pill">' + esc_(roundLabel) + '</span>' +
        '<h1>Team <em>bestätigt!</em></h1>' +
        '<p>Dein ' + esc_(roundLabel) + '-Team <span class="team">' + esc_(teamName) +
        '</span> ist jetzt für die Saison fixiert. Viel Erfolg! 🔥</p>' +
        rankingLink_()
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * Among confirmed=TRUE rows for `email` IN `round`, the one with the latest
 * submittedAt is active (superseded=FALSE); all others superseded=TRUE.
 * Scoping by round keeps the two mini-seasons independent: re-confirming a Hin
 * team never touches the Rück team. Recomputing (rather than just superseding
 * older rows) means a late confirm of an EARLIER submission does not clobber an
 * already-confirmed LATER one. Caller holds the lock.
 */
function recomputeSupersession_(sheet, email, round) {
  var data = sheet.getDataRange().getValues();
  var col = colIndex_();
  var confirmedRows = []; // {rowNum, submittedAt}
  for (var r = 1; r < data.length; r++) {
    var rowEmail = String(data[r][col.email]).trim().toLowerCase();
    var rowRound = String(data[r][col.round]);
    var isConfirmed = data[r][col.confirmed] === true || String(data[r][col.confirmed]).toUpperCase() === 'TRUE';
    if (rowEmail === email && rowRound === round && isConfirmed) {
      confirmedRows.push({ rowNum: r + 1, submittedAt: new Date(data[r][col.submittedAt]).getTime() });
    }
  }
  if (confirmedRows.length === 0) return;

  // Latest submittedAt wins; ties broken toward the later sheet row.
  var winner = confirmedRows[0];
  for (var i = 1; i < confirmedRows.length; i++) {
    if (confirmedRows[i].submittedAt >= winner.submittedAt) winner = confirmedRows[i];
  }
  for (var k = 0; k < confirmedRows.length; k++) {
    var superseded = confirmedRows[k].rowNum !== winner.rowNum;
    sheet.getRange(confirmedRows[k].rowNum, col.superseded + 1).setValue(superseded);
  }
}

// ----------------------------- TURNSTILE -----------------------------------

function verifyTurnstile_(token) {
  if (!token) return false;
  var secret = PropertiesService.getScriptProperties().getProperty('TURNSTILE_SECRET');
  if (!secret) {
    // Fail closed: misconfiguration must not silently accept everyone.
    Logger.log('TURNSTILE_SECRET not set in Script Properties.');
    return false;
  }
  var resp = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'post',
    payload: { secret: secret, response: token },
    muteHttpExceptions: true,
  });
  try {
    var result = JSON.parse(resp.getContentText());
    return result.success === true;
  } catch (err) {
    return false;
  }
}

// ----------------------------- DATA HELPERS --------------------------------

function getSpreadsheet_() {
  // Bound script: the active spreadsheet IS the datastore.
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name, header) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(header);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
  }
  return sheet;
}

// Column index map (0-based) for Submissions, derived from the header order.
function colIndex_() {
  var h = submissionsHeader_();
  var map = {};
  for (var i = 0; i < h.length; i++) map[h[i]] = i;
  return map;
}

function loadPlayers_(round) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_PLAYERS[round]);
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};
  var head = data[0].map(function (x) { return String(x).trim().toLowerCase(); });
  var iId = head.indexOf('id');
  var iName = head.indexOf('name');
  var iClub = head.indexOf('club');
  if (iClub === -1) iClub = head.indexOf('verein');
  var iPos = head.indexOf('position');
  if (iPos === -1) iPos = head.indexOf('pos');
  var iPrice = head.indexOf('price');
  if (iPrice === -1) iPrice = head.indexOf('preis');

  var map = {};
  for (var r = 1; r < data.length; r++) {
    var id = String(data[r][iId]).trim();
    if (!id) continue;
    map[id] = {
      id: id,
      name: iName >= 0 ? String(data[r][iName]) : '',
      club: iClub >= 0 ? String(data[r][iClub]) : '',
      position: iPos >= 0 ? String(data[r][iPos]).trim() : '',
      price: iPrice >= 0 ? Number(data[r][iPrice]) || 0 : 0,
    };
  }
  return map;
}

function findByToken_(token) {
  var sheet = getSheet_(SHEET_SUBMISSIONS, submissionsHeader_());
  var data = sheet.getDataRange().getValues();
  var col = colIndex_();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][col.token]) === String(token)) {
      var picks = [];
      for (var i = 1; i <= ROSTER_SIZE; i++) picks.push(data[r][col['p' + i]]);
      return {
        rowNum: r + 1,
        email: data[r][col.email],
        teamName: data[r][col.teamName],
        round: String(data[r][col.round]),
        players: picks,
        confirmed: data[r][col.confirmed] === true || String(data[r][col.confirmed]).toUpperCase() === 'TRUE',
      };
    }
  }
  return null;
}

function countRecentPending_(sheet, email, round) {
  var data = sheet.getDataRange().getValues();
  var col = colIndex_();
  var cutoff = Date.now() - 60 * 60 * 1000;
  var n = 0;
  for (var r = 1; r < data.length; r++) {
    var rowEmail = String(data[r][col.email]).trim().toLowerCase();
    var rowRound = String(data[r][col.round]);
    var confirmed = data[r][col.confirmed] === true || String(data[r][col.confirmed]).toUpperCase() === 'TRUE';
    var ts = new Date(data[r][col.submittedAt]).getTime();
    if (rowEmail === email && rowRound === round && !confirmed && ts >= cutoff) n++;
  }
  return n;
}

// The team name (as originally cased) from any CONFIRMED row for this email, or
// null if the email has no confirmed team yet. Used to lock the name per email.
function confirmedTeamName_(sheet, email) {
  var data = sheet.getDataRange().getValues();
  var col = colIndex_();
  for (var r = 1; r < data.length; r++) {
    var rowEmail = String(data[r][col.email]).trim().toLowerCase();
    var confirmed = data[r][col.confirmed] === true || String(data[r][col.confirmed]).toUpperCase() === 'TRUE';
    if (rowEmail === email && confirmed) return String(data[r][col.teamName]);
  }
  return null;
}

function normName_(s) {
  return String(s).trim().toLowerCase();
}

function roundLabel_(round) {
  if (round === 'HIN') return 'Hinrunde';
  if (round === 'RUECK') return 'Rückrunde';
  return round;
}

// ----------------------------- EMAIL + QUOTA -------------------------------

function sendConfirmEmail_(email, teamName, token, round) {
  var url = ScriptApp.getService().getUrl() + '?token=' + encodeURIComponent(token);
  var label = roundLabel_(round);
  var subject = 'Plattenplausch: Bestätige dein ' + label + '-Team';
  var html =
    '<div style="font-family:Arial,sans-serif;max-width:520px">' +
    '<h2 style="color:#ff5a1f">Bestätige dein ' + esc_(label) + '-Team 🏓</h2>' +
    '<p>Du hast das ' + esc_(label) + '-Team <b>' + esc_(teamName) + '</b> eingereicht. Klicke zum Bestätigen:</p>' +
    '<p><a href="' + url + '" style="background:#ff5a1f;color:#0b1b2b;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Team bestätigen</a></p>' +
    '<p style="color:#666;font-size:13px">Oder kopiere diesen Link: ' + url + '</p>' +
    '<p style="color:#666;font-size:13px">Falls du das nicht warst, ignoriere diese E-Mail einfach.</p>' +
    '</div>';
  MailApp.sendEmail({ to: email, subject: subject, htmlBody: html });
}

// Track global mail counters in Script Properties (hour + day buckets).
function mailQuotaAvailable_() {
  var props = PropertiesService.getScriptProperties();
  var now = new Date();
  var hourKey = 'mail_h_' + now.getFullYear() + dd_(now.getMonth() + 1) + dd_(now.getDate()) + dd_(now.getHours());
  var dayKey = 'mail_d_' + now.getFullYear() + dd_(now.getMonth() + 1) + dd_(now.getDate());
  var h = Number(props.getProperty(hourKey) || 0);
  var d = Number(props.getProperty(dayKey) || 0);
  return h < MAIL_CEILING_HOUR && d < MAIL_CEILING_DAY;
}

function bumpMailCounters_() {
  var props = PropertiesService.getScriptProperties();
  var now = new Date();
  var hourKey = 'mail_h_' + now.getFullYear() + dd_(now.getMonth() + 1) + dd_(now.getDate()) + dd_(now.getHours());
  var dayKey = 'mail_d_' + now.getFullYear() + dd_(now.getMonth() + 1) + dd_(now.getDate());
  props.setProperty(hourKey, String(Number(props.getProperty(hourKey) || 0) + 1));
  props.setProperty(dayKey, String(Number(props.getProperty(dayKey) || 0) + 1));
}

// ----------------------------- PRUNE TRIGGER -------------------------------

/**
 * Time-driven trigger target. Create it once (Triggers → add → pruneUnconfirmed_
 * → time-driven → hour timer). Deletes unconfirmed rows older than the cutoff so
 * abandoned pending rows don't accumulate (and never reach the ranking anyway).
 */
function pruneUnconfirmed_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_(SHEET_SUBMISSIONS, submissionsHeader_());
    var data = sheet.getDataRange().getValues();
    var col = colIndex_();
    var cutoff = Date.now() - PRUNE_UNCONFIRMED_AFTER_HOURS * 60 * 60 * 1000;
    for (var r = data.length - 1; r >= 1; r--) {
      var confirmed = data[r][col.confirmed] === true || String(data[r][col.confirmed]).toUpperCase() === 'TRUE';
      var ts = new Date(data[r][col.submittedAt]).getTime();
      if (!confirmed && ts < cutoff) sheet.deleteRow(r + 1);
    }
  } finally {
    lock.releaseLock();
  }
}

// ----------------------------- HTML / UTIL ---------------------------------

// Render a styled roster card for `found` (looks player ids up in the round's
// pool to show name / club / position / price + total spend bar). Falls back to
// raw ids if a player isn't found in the pool.
function teamRosterHtml_(found) {
  var pool = loadPlayers_(found.round); // {id:{name,club,position,price}}
  var ids = found.players.filter(String);
  var spent = 0;
  var items = ids
    .map(function (id) {
      var p = pool[String(id)];
      if (!p) return '<li><span class="pos">?</span><span><b class="pname">' + esc_(String(id)) + '</b><span class="pclub">unbekannt</span></span><span class="pprice">—</span></li>';
      spent += Number(p.price) || 0;
      return (
        '<li><span class="pos">' + esc_(p.position) + '</span>' +
        '<span><b class="pname">' + esc_(p.name) + '</b><span class="pclub">' + esc_(p.club) + '</span></span>' +
        '<span class="pprice">' + (Number(p.price) || 0) + '</span></li>'
      );
    })
    .join('');
  var pct = Math.max(0, Math.min(100, Math.round((spent / BUDGET) * 100)));
  return (
    '<ul class="roster">' + items + '</ul>' +
    '<div class="spend"><span class="lbl">Budget genutzt</span>' +
    '<span class="val">' + spent + ' / ' + BUDGET + ' Pkt</span></div>' +
    '<div class="bar"><i style="width:' + pct + '%"></i></div>'
  );
}

function confirmPromptPage_(found, token) {
  var label = roundLabel_(found.round);
  var body =
    '<span class="pill">' + esc_(label) + '</span>' +
    '<h1>Dein Team <em>bestätigen</em></h1>' +
    '<p>Gleich geschafft! Prüfe deine Aufstellung und fixiere dein ' + esc_(label) + '-Team:</p>' +
    '<div class="team">' + esc_(found.teamName) + '</div>' +
    teamRosterHtml_(found) +
    // target="_top" makes the confirm navigate the WHOLE tab, not the Apps Script
    // iframe — otherwise the result page (script.google.com, X-Frame-Options:
    // DENY) can't render embedded and the browser shows an error.
    '<form method="get" target="_top" action="' + ScriptApp.getService().getUrl() + '" style="margin-top:18px">' +
    '<input type="hidden" name="action" value="confirm" />' +
    '<input type="hidden" name="token" value="' + esc_(token) + '" />' +
    '<button type="submit" class="btn">🏓 Mein Team fixieren</button>' +
    '</form>' +
    '<p class="hint">Erst mit dem Klick wird dein Team fixiert — automatisch passiert nichts. ' +
    'Danach ist dieses ' + esc_(label) + '-Team für die Saison gesperrt.</p>';
  return htmlPage_('Team bestätigen', body);
}

function rankingLink_() {
  // Set RANKING_PAGE_URL in Script Properties to your Pages ranking.html URL.
  var url = PropertiesService.getScriptProperties().getProperty('RANKING_PAGE_URL') || '';
  if (!url) return '';
  return '<a class="btn ghost" target="_top" href="' + esc_(url) + '" style="margin-top:16px">Zur Tabelle →</a>';
}

function htmlPage_(title, bodyHtml) {
  var html =
    '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<title>' + esc_(title) + ' · Plattenplausch</title>' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@600;700;800&family=Sora:wght@400;600;700&display=swap" rel="stylesheet">' +
    '<style>' + pageCss_() + '</style></head>' +
    '<body><div class="bg"></div><div class="card">' +
    '<div class="brand"><span class="dot"></span><span class="brandtext">Plattenplausch' +
    '<small>TT Fantasy League</small></span></div>' +
    bodyHtml +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setTitle(title + ' · Plattenplausch')
    // Allow the page to render when navigated top-level (post-confirm), avoiding
    // the browser's "can't display embedded page" block.
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Broadcast-aesthetic CSS for the confirm/result pages — matches the website
// (TT orange + ITTF blue on navy, Saira Condensed display + Sora body).
function pageCss_() {
  return [
    ':root{--orange:#ff5a1f;--orange2:#ff7a45;--blue:#1d6fb8;--blue2:#3a9be0;--navy:#0b1b2b;--panel:#16314a;--panel2:#1c3a57;--ink:#eef3f7;--dim:#9fb3c4;--line:#284a68;--ok:#38d39f}',
    '*{box-sizing:border-box}',
    'body{margin:0;min-height:100vh;font-family:"Sora",system-ui,sans-serif;color:var(--ink);background:var(--navy);-webkit-font-smoothing:antialiased;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 40px}',
    '.bg{position:fixed;inset:0;z-index:0;background:radial-gradient(1100px 560px at 82% -10%,rgba(29,111,184,.22),transparent 60%),radial-gradient(820px 460px at -8% 8%,rgba(255,90,31,.18),transparent 55%)}',
    '.card{position:relative;z-index:1;max-width:560px;width:100%;background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.45);padding:30px 28px}',
    '.brand{display:flex;align-items:center;gap:12px;margin-bottom:18px}',
    '.brand .dot{width:34px;height:34px;border-radius:50%;background:var(--orange);position:relative;box-shadow:0 0 0 4px rgba(255,90,31,.18),inset 0 -6px 10px rgba(0,0,0,.25)}',
    '.brand .dot::after{content:"";position:absolute;right:-5px;top:-5px;width:11px;height:11px;border-radius:50%;background:var(--ink);box-shadow:0 0 0 3px var(--blue)}',
    '.brandtext{font-family:"Saira Condensed",sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.5px;font-size:1.35rem;line-height:1}',
    '.brandtext small{display:block;color:var(--dim);font-size:.62rem;letter-spacing:2px;font-weight:600}',
    'h1{font-family:"Saira Condensed",sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.5px;font-size:clamp(1.9rem,5vw,2.6rem);line-height:.98;margin:6px 0 4px}',
    'h1 em{color:var(--orange);font-style:normal}',
    'p{color:var(--dim);margin:8px 0}',
    '.pill{display:inline-block;font-family:"Saira Condensed",sans-serif;text-transform:uppercase;letter-spacing:1px;font-weight:800;font-size:.85rem;background:var(--orange);color:var(--navy);padding:3px 12px;border-radius:999px;margin-bottom:6px}',
    '.team{font-family:"Saira Condensed",sans-serif;font-weight:800;font-size:1.6rem;color:var(--ink);letter-spacing:.5px}',
    '.roster{list-style:none;margin:18px 0;padding:0;border:1px solid var(--line);border-radius:12px;overflow:hidden}',
    '.roster li{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid rgba(40,74,104,.55);background:rgba(255,255,255,.02)}',
    '.roster li:last-child{border-bottom:none}',
    '.pos{font-family:"Saira Condensed",sans-serif;font-size:.72rem;text-transform:uppercase;letter-spacing:1px;padding:3px 8px;border-radius:6px;background:rgba(29,111,184,.22);color:var(--blue2);white-space:nowrap}',
    '.pname{font-weight:600}.pclub{display:block;color:var(--dim);font-size:.8rem}',
    '.pprice{font-family:"Saira Condensed",sans-serif;font-weight:800;font-size:1.25rem;color:var(--orange);font-variant-numeric:tabular-nums}',
    '.spend{display:flex;justify-content:space-between;align-items:baseline;margin:14px 0 4px}',
    '.spend .lbl{font-size:.72rem;letter-spacing:2px;text-transform:uppercase;color:var(--dim)}',
    '.spend .val{font-family:"Saira Condensed",sans-serif;font-weight:800;font-size:1.5rem;font-variant-numeric:tabular-nums}',
    '.bar{height:12px;border-radius:999px;background:#0a1622;border:1px solid var(--line);overflow:hidden}',
    '.bar > i{display:block;height:100%;background:linear-gradient(90deg,var(--orange),var(--orange2))}',
    '.btn{display:inline-block;font-family:"Saira Condensed",sans-serif;text-transform:uppercase;letter-spacing:1px;font-weight:800;font-size:1.25rem;border:none;cursor:pointer;border-radius:12px;padding:15px 26px;background:var(--orange);color:var(--navy);width:100%;margin-top:6px}',
    '.btn:hover{background:var(--orange2)}',
    '.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line);font-size:1.05rem}',
    '.hint{font-size:.8rem;color:var(--dim);margin-top:14px}',
    '.big{font-size:3.2rem;line-height:1;margin:4px 0 10px}',
    'a.link{color:var(--blue2);text-decoration:none;font-weight:600}a.link:hover{text-decoration:underline}',
  ].join('');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function isEmail_(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function hasProfanity_(s) {
  var low = String(s).toLowerCase();
  for (var i = 0; i < PROFANITY.length; i++) {
    if (low.indexOf(PROFANITY[i]) !== -1) return true;
  }
  return false;
}

function esc_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;'); // also escape single quotes (defense-in-depth)
}

function dd_(n) {
  return n < 10 ? '0' + n : '' + n;
}
