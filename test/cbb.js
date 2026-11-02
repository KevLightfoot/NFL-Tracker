'use strict';
// Men's college basketball: scoreboards, box scores, halves (not quarters), and keeping Duke basketball apart from Duke football.
const assert = require('assert'), http = require('http');
const Teams = require('../public/lib/teams.js');
const Stats = require('../public/lib/stats.js');
const E = require('../public/lib/evaluate.js');
const tests = [], test = function (n, f) { tests.push([n, f]); };
const now = Date.now(), H = 36e5, iso = function (h) { return new Date(now + h * H).toISOString(); };
const tm = function (id, abbr, name, short, nick) { return { id: String(id), abbreviation: abbr, displayName: name, shortDisplayName: short, name: nick, location: short }; };
const DUKE = tm(150, 'DUKE', 'Duke Blue Devils', 'Duke', 'Blue Devils'), UNC = tm(153, 'UNC', 'North Carolina Tar Heels', 'North Carolina', 'Tar Heels');
const CONN = tm(41, 'CONN', 'UConn Huskies', 'UConn', 'Huskies'), KU = tm(2305, 'KU', 'Kansas Jayhawks', 'Kansas', 'Jayhawks');
const CLEM = tm(228, 'CLEM', 'Clemson Tigers', 'Clemson', 'Tigers');
const LABELS = ['MIN', 'FG', '3PT', 'FT', 'OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'PTS'];   // ESPN college basketball box score
const ev = function (id, away, home, o) {
  o = o || {};
  const ls = function (a) { return (a || []).map(function (v) { return { displayValue: String(v) }; }); };
  return { id: String(id), date: o.date || iso(-0.5), shortName: away.abbreviation + ' @ ' + home.abbreviation,
    status: { period: o.period || 0, displayClock: o.clock || '0:00', type: { state: o.state || 'pre', completed: o.state === 'post', shortDetail: o.detail || '' } },
    competitions: [{ date: o.date || iso(-0.5), status: { period: o.period || 0, displayClock: o.clock || '0:00', type: { state: o.state || 'pre', completed: o.state === 'post', shortDetail: o.detail || '' } },
      competitors: [{ homeAway: 'away', team: away, score: String(o.as || 0), linescores: ls(o.als) }, { homeAway: 'home', team: home, score: String(o.hs || 0), linescores: ls(o.hls) }] }] };
};
const summary = function (e, box) {
  const c = e.competitions[0];
  return { header: { id: e.id, competitions: [c] }, boxscore: { players: (box || []).map(function (b) { return { team: b[0], statistics: [{ labels: LABELS, athletes: b[1].map(function (r) { return { athlete: { id: r[0], displayName: r[1] }, stats: r[2] }; }) }] }; }) } };
};
// Duke @ UNC hoops, 2nd half 10:00 left, DUKE 52 - UNC 47 (1st half 38-35); Duke football at Clemson the same weekend.
const HOOPS = ev(9001, DUKE, UNC, { state: 'in', period: 2, clock: '10:00', detail: '10:00 - 2nd Half', as: 52, hs: 47, als: [38, 14], hls: [35, 12] });
const BOX = [[DUKE, [['1', 'Cooper Flagg', ['24', '7-12', '2-4', '3-4', '2', '6', '8', '3', '1', '2', '2', '1', '19']]]], [UNC, [['2', 'RJ Davis', ['25', '6-14', '3-8', '2-2', '0', '3', '3', '4', '0', '0', '1', '2', '17']]]]];
const FOOT = Object.assign(ev(7001, DUKE, CLEM, { state: 'pre', date: iso(20) }), {});

test('teams: college hoops teams register from the scoreboard and match by school, nickname and slang', function () {
  Stats.normalizeEvent(HOOPS, 'cbb'); Stats.normalizeEvent(ev(9002, CONN, KU, { state: 'pre', date: iso(5) }), 'cbb');
  assert.strictEqual(Teams.matchTeam('Duke', 'cbb'), 'DUKE'); assert.strictEqual(Teams.matchTeam('North Carolina Tar Heels', 'cbb'), 'UNC');
  assert.strictEqual(Teams.matchTeam('Connecticut', 'cbb'), 'CONN', 'college slang works for basketball too'); assert.strictEqual(Teams.matchTeam('Kansas', 'cbb'), 'KU');
  assert.strictEqual(Teams.name('UNC', 'cbb'), 'North Carolina');
});
test('box score: points, rebounds, threes, PRA read from a college box score', function () {
  const g = Stats.normalizeSummary(summary(HOOPS, BOX), '9001', 'cbb');
  assert.strictEqual(g.league, 'cbb'); assert.strictEqual(g.away.abbr, 'DUKE'); assert.deepStrictEqual(g.away.linescores, [38, 14]);
  const leg = function (stat, line) { return { id: 'x', market: 'player_prop', player: 'Cooper Flagg', stat: stat, side: 'over', line: line, period: 'full', league: 'cbb' }; };
  assert.strictEqual(E.evaluateLeg(leg('points', 17.5), g).state, 'hit');
  assert.strictEqual(E.evaluateLeg(leg('rebounds', 7.5), g).state, 'hit');
  assert.strictEqual(E.evaluateLeg(leg('three_pointers_made', 2.5), g).state, 'live');
  assert.strictEqual(E.evaluateLeg(leg('pts_reb_ast', 30.5), g).state, 'live');
  const r = E.evaluateLeg(leg('pts_reb_ast', 30.5), g); assert.strictEqual(r.valueText, '30'); assert.strictEqual(E.evaluateLeg(leg('points', 17.5), g).valueText, '19');
});
test('halves: 1st half uses the first half only, 2nd half the rest (incl. OT); no quarter math', function () {
  const g = Stats.normalizeSummary(summary(HOOPS, BOX), '9001', 'cbb');
  const sp = function (team, line, period) { return E.evaluateLeg({ id: 's', market: 'spread', team: team, line: line, period: period, league: 'cbb' }, g); };
  const h1 = sp('Duke', -2.5, '1h'); assert.strictEqual(h1.state, 'hit', 'Duke won the 1st half 38-35 and that half is over');
  const h2 = sp('Duke', -2.5, '2h'); assert.strictEqual(h2.state, 'live', '2nd half is 14-12 and still going');
  assert.deepStrictEqual(E.scopedScore(g, '1h'), { away: 38, home: 35, final: true, started: true });
  const ot = Object.assign({}, g, { state: 'post', period: 3, away: Object.assign({}, g.away, { score: 80, linescores: [38, 32, 10] }), home: Object.assign({}, g.home, { score: 78, linescores: [35, 35, 8] }) });
  assert.deepStrictEqual(E.scopedScore(ot, '2h'), { away: 42, home: 43, final: true, started: true });
  const tot = E.evaluateLeg({ id: 't', market: 'total', side: 'over', line: 140.5, period: 'full', league: 'cbb' }, g);
  assert.strictEqual(tot.state, 'live'); assert.ok(/pace 132/.test(tot.detail || '') || /pace 132/.test(JSON.stringify(tot)), 'pace uses 40 minutes: 99 points at 30 of 40 minutes = 132: ' + JSON.stringify(tot));
});
test('clock: halftime, end of the 1st half and overtime are counted as halves', function () {
  const base = Stats.normalizeSummary(summary(HOOPS, BOX), '9001', 'cbb');
  const at = function (o) { return Object.assign({}, base, o); };
  assert.strictEqual(E.scopedScore(at({ period: 1, clock: '0:00', detail: 'Halftime' }), '1h').final, true);
  assert.strictEqual(E.scopedScore(at({ period: 1, clock: '0:00', detail: 'End of 1st Half' }), '1h').final, true);
  assert.strictEqual(E.scopedScore(at({ period: 1, clock: '3:10', detail: '3:10 - 1st Half' }), '1h').final, false);
  assert.strictEqual(E.scopedScore(at({ period: 2, clock: '3:10', detail: '3:10 - 2nd Half' }), '2h').final, false);
  // the same clock logic for the NBA is unchanged: halftime there means two quarters are done
  const nba = Object.assign({}, base, { league: 'nba', period: 2, clock: '0:00', detail: 'Halftime', away: Object.assign({}, base.away, { linescores: [20, 25] }), home: Object.assign({}, base.home, { linescores: [22, 21] }) });
  assert.deepStrictEqual(E.scopedScore(nba, '1h'), { away: 45, home: 43, final: true, started: true });
});

/* ---- server: scoreboards + resolving ---- */
const json = function (o, st) { return { ok: (st || 200) < 400, status: st || 200, json: async function () { return o; }, text: async function () { return JSON.stringify(o); } }; };
test('server: college basketball scoreboards are asked per day with all of Division I; games are this week and resolve apart from football', async function () {
  const realFetch = global.fetch, seen = [];
  global.fetch = async function (url) {
    const u = String(url); seen.push(u);
    if (/mens-college-basketball\/scoreboard/.test(u)) return json({ events: [HOOPS, ev(9002, CONN, KU, { state: 'pre', date: iso(5) })] });
    if (/college-football\/scoreboard/.test(u)) return json({ events: [FOOT] });
    if (/mens-college-basketball\/summary\?event=9001/.test(u)) return json(summary(HOOPS, BOX));
    if (/scoreboard/.test(u)) return json({ events: [] });
    return json({}, 404);
  };
  const { server } = require('../server.js');
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const req = function (m, p, body) { return new Promise(function (res, rej) { const d = body ? JSON.stringify(body) : null; const q = http.request({ host: '127.0.0.1', port: port, path: p, method: m, headers: { 'content-type': 'application/json' } }, function (r) { let s = ''; r.on('data', function (c) { s += c; }); r.on('end', function () { res(JSON.parse(s)); }); }); q.on('error', rej); if (d) q.write(d); q.end(); }); };
  try {
    const gs = (await req('GET', '/api/games')).games;
    const cb = seen.filter(function (u) { return /mens-college-basketball\/scoreboard/.test(u); });
    assert.ok(cb.length === 6 && cb.every(function (u) { return /dates=\d{8}&groups=50&limit=400$/.test(u); }), cb.join(' '));
    const hoops = gs.find(function (g) { return g.id === '9001'; }); assert.strictEqual(hoops.league, 'cbb'); assert.strictEqual(hoops.thisWeek, true);
    const r = (await req('POST', '/api/resolve', { legs: [
      { id: 'a', market: 'spread', team: 'Duke', line: -4.5, league: 'cbb' },                         // labelled right
      { id: 'b', market: 'total', side: 'over', line: 145.5, away_team: 'Duke', home_team: 'North Carolina', league: 'cfb' },   // labelled football, but a 145.5 total is hoops
      { id: 'c', market: 'total', side: 'over', line: 48.5, away_team: 'Duke', home_team: 'Clemson' },  // no label, football-sized total
      { id: 'd', market: 'moneyline', team: 'Duke', league: 'cfb' },                                  // football ML stays football
      { id: 'e', market: 'player_prop', player: 'Cooper Flagg', stat: 'points', line: 18.5, side: 'over' },   // no label, no team: found in the hoops box score
      { id: 'f', market: 'spread', team: 'UConn', line: -3.5, league: 'cbb' },
      { id: 'g', market: 'player_prop', player: 'Cooper Flagg', stat: 'points', line: 18.5, side: 'over', league: 'nba' },  // wrong pro label
    ] })).results;
    const by = {}; r.forEach(function (x) { by[x.id] = x; });
    assert.deepStrictEqual([by.a.gameId, by.a.league, by.a.team], ['9001', 'cbb', 'DUKE']);
    assert.deepStrictEqual([by.b.gameId, by.b.league], ['9001', 'cbb']);
    assert.deepStrictEqual([by.c.gameId, by.c.league], ['7001', 'cfb']);
    assert.deepStrictEqual([by.d.gameId, by.d.league], ['7001', 'cfb']);
    assert.deepStrictEqual([by.e.gameId, by.e.league, by.e.team], ['9001', 'cbb', 'DUKE']);
    assert.deepStrictEqual([by.f.gameId, by.f.league, by.f.team], ['9002', 'cbb', 'CONN']);
    assert.deepStrictEqual([by.g.gameId, by.g.league], ['9001', 'cbb']);
    const g = (await req('GET', '/api/game/9001?league=cbb')).game;
    assert.strictEqual(g.league, 'cbb'); assert.ok(g.players.some(function (p) { return p.name === 'Cooper Flagg' && p.team === 'DUKE'; }));
    assert.ok(seen.some(function (u) { return /mens-college-basketball\/summary\?event=9001/.test(u); }));
  } finally { server.close(); global.fetch = realFetch; }
});
test('reader: the schema and prompt know college basketball', function () {
  const { TOOL } = require('../server.js');
  assert.ok(TOOL.input_schema.properties.legs.items.properties.league.enum.indexOf('cbb') >= 0);
  const src = require('fs').readFileSync(require('path').join(__dirname, '../server.js'), 'utf8');
  assert.ok(/College basketball \(cbb\) vs college football \(cfb\)/.test(src)); assert.ok(/two halves/.test(src));
});

(async function () {
  let pass = 0, fail = 0;
  for (const t of tests) { try { await t[1](); pass++; console.log('  ✓ ' + t[0]); } catch (e) { fail++; console.log('  ✗ ' + t[0] + '\n      ' + (e && e.message)); } }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
