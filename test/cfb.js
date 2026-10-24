'use strict';
// College football support: team matching, box scores, live evaluation, and league-aware game lookup (mixed NFL + CFB slips).
const assert = require('assert');
const http = require('http');
const F = require('./fixtures.js');
const Teams = require('../public/lib/teams.js');
const Stats = require('../public/lib/stats.js');
const E = require('../public/lib/evaluate.js');
 
let pass = 0, fail = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
 
/* ESPN college teams carry location / short name / nickname */
function cteam(id, abbr, location, nick, short) {
  return { id: String(id), abbreviation: abbr, displayName: location + ' ' + nick, shortDisplayName: short || location, name: nick, location: location };
}
const UGA = cteam(61, 'UGA', 'Georgia', 'Bulldogs'), GT = cteam(59, 'GT', 'Georgia Tech', 'Yellow Jackets'), AUB = cteam(2, 'AUB', 'Auburn', 'Tigers');
const OSU = cteam(194, 'OSU', 'Ohio State', 'Buckeyes'), MICH = cteam(130, 'MICH', 'Michigan', 'Wolverines'), MSU = cteam(127, 'MSU', 'Michigan State', 'Spartans');
const MSST = cteam(344, 'MSST', 'Mississippi State', 'Bulldogs'), MISS = cteam(145, 'MISS', 'Ole Miss', 'Rebels'), TAMU = cteam(245, 'TAMU', 'Texas A&M', 'Aggies');
const ALA = cteam(333, 'ALA', 'Alabama', 'Crimson Tide'), MIA = cteam(2390, 'MIA', 'Miami', 'Hurricanes'), MOH = cteam(193, 'M-OH', 'Miami (OH)', 'RedHawks', 'Miami (OH)');
const BUFc = cteam(2084, 'BUF', 'Buffalo', 'Bulls'), TX = cteam(251, 'TEX', 'Texas', 'Longhorns');
 
function cgame(id, away, home, o) {
  o = o || {};
  const sum = F.summary(Object.assign({ id: id, away: away.abbreviation, home: home.abbreviation, state: 'in', period: 3, clock: '5:12', awayScore: 17, homeScore: 24, awayLs: [7, 10, 0], homeLs: [10, 7, 7] }, o));
  sum.header.competitions[0].competitors.forEach(function (c) { c.team = c.homeAway === 'home' ? home : away; });
  return sum;
}
 
test('college teams match by short name, abbreviation, slang, rank prefix and "St"', function () {
  [UGA, GT, AUB, OSU, MICH, MSU, MSST, MISS, TAMU, ALA, MIA, MOH].forEach(function (t) { Teams.registerTeam('cfb', { abbr: t.abbreviation, name: t.displayName, short: t.shortDisplayName, nick: t.name, location: t.location }); });
  const m = function (s) { return Teams.matchTeam(s, 'cfb'); };
  assert.strictEqual(m('Georgia'), 'UGA');
  assert.strictEqual(m('Georgia Tech -3'), 'GT');           // longest name wins over "Georgia"
  assert.strictEqual(m('#5 Ohio State'), 'OSU');
  assert.strictEqual(m('(12) Ohio St'), 'OSU');
  assert.strictEqual(m('Michigan St'), 'MSU');
  assert.strictEqual(m('Michigan'), 'MICH');
  assert.strictEqual(m('Miss State'), 'MSST');
  assert.strictEqual(m('Mississippi'), 'MISS');
  assert.strictEqual(m('Ole Miss'), 'MISS');
  assert.strictEqual(m('Texas A&M'), 'TAMU');
  assert.strictEqual(m('Texas AM'), 'TAMU');
  assert.strictEqual(m('Bama'), 'ALA');
  Teams.registerTeam('cfb', { abbr: 'CONN', name: 'UConn Huskies', short: 'UConn', nick: 'Huskies', location: 'UConn' });
  Teams.registerTeam('cfb', { abbr: 'MASS', name: 'UMass Minutemen', short: 'UMass', nick: 'Minutemen', location: 'Massachusetts' });
  assert.strictEqual(m('UConn ML'), 'CONN');                // ESPN's own short name must not be rewritten away
  assert.strictEqual(m('Connecticut'), 'CONN');
  assert.strictEqual(m('UMass'), 'MASS');
  assert.strictEqual(m('Massachusetts'), 'MASS');
  assert.strictEqual(m('Miami'), 'MIA');
  assert.strictEqual(m('Miami OH'), 'M-OH');
  assert.strictEqual(m('Crimson Tide'), 'ALA');
  assert.strictEqual(m('Bulldogs'), null, '"Bulldogs" is shared by Georgia and Mississippi State -> ambiguous, not guessed');
  assert.strictEqual(m('Tigers'), 'AUB');                    // only one Tigers registered here
});
 
test('NFL matching is untouched and stays separate from college', function () {
  assert.strictEqual(Teams.matchTeam('Jets', 'nfl'), 'NYJ');
  assert.strictEqual(Teams.matchTeam('Jets'), 'NYJ');
  assert.strictEqual(Teams.matchTeam('49ers +3', 'nfl'), 'SF');
  assert.strictEqual(Teams.matchTeam('Jets', 'cfb'), null);
  assert.strictEqual(Teams.matchTeam('Georgia', 'nfl'), null);
  assert.strictEqual(Teams.name('NYJ', 'nfl'), 'Jets');
  assert.strictEqual(Teams.name('UGA', 'cfb'), 'Georgia');
});
 
test('college summary keeps ESPN abbreviations and tags the league', function () {
  const g = Stats.normalizeSummary(cgame(501, UGA, AUB), '501', 'cfb');
  assert.strictEqual(g.league, 'cfb'); assert.strictEqual(g.away.abbr, 'UGA'); assert.strictEqual(g.home.short, 'Auburn'); assert.strictEqual(g.home.nick, 'Tigers');
  const ev = Stats.normalizeEvent(F.ev(502, OSU, MICH, 'in', 10, 7), 'cfb');
  assert.strictEqual(ev.league, 'cfb'); assert.strictEqual(ev.away.abbr, 'OSU');
  assert.strictEqual(Stats.normalizeEvent(F.ev(1, F.IND, F.HOU, 'pre', 0, 0)).league, 'nfl'); // default
});
 
test('moneyline, spread, total and props evaluate on a college game', function () {
  const box = [
    F.box(UGA, [F.cat('passing', ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'], [['1', 'Carson Beck', ['18/25', '231', '9.2', '2', '0', '1-7', '80', '160']]]),
      F.cat('rushing', ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], [['2', 'Trevor Etienne', ['12', '70', '5.8', '1', '22']]]),
      F.cat('receiving', ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'], [['3', 'Dillon Bell', ['5', '81', '16.2', '1', '33', '7']]])]),
    F.box(AUB, [F.cat('rushing', ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], [['9', 'Jarquez Hunter', ['15', '88', '5.9', '0', '40']]])]),
  ];
  const g = Stats.normalizeSummary(cgame(501, UGA, AUB, { awayScore: 31, homeScore: 17, boxPlayers: box }), '501', 'cfb');
  const ev = function (leg) { return E.evaluateLeg(Object.assign({ id: 'x' }, leg), g); };
 
  let r = ev({ market: 'moneyline', team: 'Georgia' });
  assert.strictEqual(r.state, 'live'); assert.strictEqual(r.onTrack, true); assert.strictEqual(r.title, 'Georgia ML'); assert.ok(/UGA 31 – AUB 17/.test(r.scoreText), r.scoreText);
  r = ev({ market: 'spread', team: 'Auburn', line: 14.5 }); assert.strictEqual(r.onTrack, true);   // 17+14.5 > 31
  r = ev({ market: 'spread', team: 'Georgia', line: -14.5 }); assert.strictEqual(r.onTrack, false);
  r = ev({ market: 'total', side: 'over', line: 44.5 }); assert.strictEqual(r.state, 'hit');       // 48 > 44.5
  r = ev({ market: 'player_prop', player: 'Dillon Bell', stat: 'receiving_yards', side: 'over', line: 79.5 }); assert.strictEqual(r.state, 'hit');
  r = ev({ market: 'player_prop', player: 'Carson Beck', stat: 'passing_yards', side: 'over', line: 275.5 }); assert.strictEqual(r.state, 'live'); assert.strictEqual(r.current, 231);
  r = ev({ market: 'anytime_td', player: 'Trevor Etienne' }); assert.strictEqual(r.state, 'hit');
  r = ev({ market: 'anytime_td', player: 'Jarquez Hunter', team: 'Auburn' }); assert.strictEqual(r.state, 'live');
  r = ev({ market: 'moneyline', team: 'Georgia Tech' }); assert.strictEqual(r.state, 'unresolved'); // wrong team for this game: don't guess
});
 
test('final college game settles legs', function () {
  const g = Stats.normalizeSummary(cgame(503, OSU, MICH, { state: 'post', period: 4, clock: '0:00', awayScore: 24, homeScore: 27, detail: 'Final' }), '503', 'cfb');
  assert.strictEqual(E.evaluateLeg({ id: 'a', market: 'moneyline', team: 'Michigan' }, g).state, 'hit');
  assert.strictEqual(E.evaluateLeg({ id: 'b', market: 'spread', team: 'Ohio State', line: 3.5 }, g).state, 'hit');  // 24 + 3.5 > 27
  assert.strictEqual(E.evaluateLeg({ id: 'c', market: 'spread', team: 'Michigan', line: -3.5 }, g).state, 'miss');
  assert.strictEqual(E.evaluateLeg({ id: 'd', market: 'total', side: 'under', line: 51.5 }, g).state, 'hit');
});
 
/* ---------- server: league-aware lookup, mixed slips ---------- */
test('server: mixed NFL + college slip resolves each leg to the right league', async function () {
  const realFetch = global.fetch, seen = [];
  const nflSb = { events: [F.ev(401, F.IND, F.HOU, 'in', 17, 24), F.ev(402, F.team(3, 'NYJ', 'New York Jets'), F.team(4, 'DEN', 'Denver Broncos'), 'pre', 0, 0), F.ev(403, F.team(5, 'BUF', 'Buffalo Bills'), F.team(6, 'MIA', 'Miami Dolphins'), 'pre', 0, 0)] };
  const cfbSb = { events: [F.ev(501, UGA, AUB, 'pre', 0, 0), F.ev(502, OSU, MICH, 'in', 10, 7), F.ev(504, BUFc, cteam(9, 'KENT', 'Kent State', 'Golden Flashes'), 'pre', 0, 0)] };
  const json = function (o, status) { return { ok: (status || 200) < 400, status: status || 200, json: async function () { return o; }, text: async function () { return JSON.stringify(o); } }; };
  global.fetch = async function (url) {
    url = String(url); seen.push(url);
    if (/college-football\/scoreboard/.test(url)) { if (url.indexOf('groups=80') < 0) throw new Error('college scoreboard needs groups=80'); return json(cfbSb); }
    if (/\/nfl\/scoreboard/.test(url)) return json(nflSb);
    if (/\/nfl\/summary\?event=401/.test(url)) return json(F.liveGame);
    if (/college-football\/summary\?event=502/.test(url)) return json(cgame(502, OSU, MICH, { awayScore: 10, homeScore: 7 }));
    if (/college-football\/summary\?event=501/.test(url)) return json(cgame(501, UGA, AUB, { state: 'pre' }));
    if (/college-football\/teams\/61\/roster/.test(url)) return json({ athletes: [{ items: [{ displayName: 'Carson Beck' }] }] });
    if (/college-football\/teams\/2\/roster/.test(url)) return json({ athletes: [{ position: 'offense', items: [{ displayName: 'Jarquez Hunter' }, { displayName: 'Payton Thorne' }] }] });
    if (/\/roster/.test(url)) return json({ athletes: [{ items: [{ displayName: 'Garrett Wilson' }] }] });
    return json({ error: 'nope' }, 404);
  };
  const { server } = require('../server.js');
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const req = function (method, p, body) {
    return new Promise(function (resolve, reject) {
      const data = body ? JSON.stringify(body) : null;
      const rq = http.request({ host: '127.0.0.1', port: port, path: p, method: method, headers: { 'content-type': 'application/json' } }, function (res) {
        let s = ''; res.on('data', function (c) { s += c; }); res.on('end', function () { let j = null; try { j = JSON.parse(s); } catch (e) { /* */ } resolve({ status: res.statusCode, json: j }); });
      });
      rq.on('error', reject); if (data) rq.write(data); rq.end();
    });
  };
  try {
    let r = await req('GET', '/api/games');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.games.map(function (g) { return g.league; }).sort(), ['cfb', 'cfb', 'cfb', 'nfl', 'nfl', 'nfl']);
 
    r = await req('POST', '/api/resolve', { legs: [
      { id: 'a', market: 'moneyline', team: 'Jets', league: 'nfl' },
      { id: 'b', market: 'spread', team: 'Georgia', away_team: 'Georgia', home_team: 'Auburn', league: 'cfb' },
      { id: 'c', market: 'moneyline', team: 'Ohio St' },                              // no hint at all
      { id: 'd', market: 'moneyline', team: 'Buffalo', league: 'cfb' },               // Bills vs Bulls: hint decides
      { id: 'e', market: 'moneyline', team: 'Buffalo', league: 'nfl' },
      { id: 'f', market: 'moneyline', team: 'Georgia', league: 'nfl' },              // wrong hint -> still found
      { id: 'g', market: 'player_prop', player: 'Jarquez Hunter', league: 'cfb' },   // no matchup: found on a college roster
    ] });
    const by = {}; r.json.results.forEach(function (x) { by[x.id] = x; });
    assert.deepStrictEqual([by.a.gameId, by.a.league], ['402', 'nfl']);
    assert.deepStrictEqual([by.b.gameId, by.b.league, by.b.team], ['501', 'cfb', 'UGA']);
    assert.deepStrictEqual([by.c.gameId, by.c.league], ['502', 'cfb']);
    assert.deepStrictEqual([by.d.gameId, by.d.league], ['504', 'cfb']);
    assert.deepStrictEqual([by.e.gameId, by.e.league], ['403', 'nfl']);
    assert.deepStrictEqual([by.f.gameId, by.f.league], ['501', 'cfb']);
    assert.deepStrictEqual([by.g.gameId, by.g.league, by.g.team], ['501', 'cfb', 'AUB']);
 
    // summary routes to the college endpoint, with or without the league hint
    r = await req('GET', '/api/game/502?league=cfb'); assert.strictEqual(r.json.game.league, 'cfb'); assert.strictEqual(r.json.game.away.abbr, 'OSU');
    assert.ok(seen.some(function (u) { return /college-football\/summary\?event=502/.test(u); }));
    r = await req('GET', '/api/game/401'); assert.strictEqual(r.json.game.league, 'nfl'); assert.ok(seen.some(function (u) { return /\/nfl\/summary\?event=401/.test(u); }));
  } finally { server.close(); global.fetch = realFetch; }
});
 
(async function () {
  for (const t of tests) {
    try { await t[1](); pass++; console.log('  ✓ ' + t[0]); } catch (e) { fail++; console.log('  ✗ ' + t[0] + '\n    ' + (e && e.stack || e)); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
 