'use strict';
/* Zero-dependency test suite: node test/run.js */
const assert = require('assert');
const path = require('path');
const T = require('../public/lib/teams.js');
const St = require('../public/lib/stats.js');
const E = require('../public/lib/evaluate.js');
const F = require('./fixtures.js');

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push({ name: name, fn: fn }); }
async function runAll() {
  for (const t of queue) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + (e && e.message)); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

const game = function (over) { return Object.assign(St.normalizeSummary(F.liveGame), over || {}); };
const leg = function (o) { return Object.assign({ id: 'x', period: 'full', manual: null, manualValue: null }, o); };

/* ---------- teams ---------- */
test('team matching handles nicknames, cities, abbreviations and slip text', function () {
  const cases = { 'Jets': 'NYJ', 'NY Jets': 'NYJ', 'New York Jets': 'NYJ', 'Giants': 'NYG', 'LA Chargers': 'LAC', 'Los Angeles Rams': 'LAR',
    'Raiders': 'LV', 'Las Vegas Raiders': 'LV', 'Saints +7.5': 'NO', '49ers': 'SF', 'San Francisco': 'SF', 'Washington Commanders': 'WSH',
    'Commanders': 'WSH', 'TB': 'TB', 'jags': 'JAX', 'Kansas City Chiefs -3': 'KC', 'Browns': 'CLE', 'Packers ML': 'GB', 'Pats': 'NE' };
  Object.keys(cases).forEach(function (k) { assert.strictEqual(T.matchTeam(k), cases[k], k); });
  assert.strictEqual(T.matchTeam('New York'), null);
  assert.strictEqual(T.matchTeam('LA'), null);
  assert.strictEqual(T.matchTeam('Over 54.5'), null);
  assert.strictEqual(T.matchTeam(''), null);
});

/* ---------- player names ---------- */
test('player matching: initials, suffixes, typos', function () {
  const g = game();
  const f = function (n) { const p = St.findPlayer(g.players, n); return p && p.name; };
  assert.strictEqual(f('Nico Collins'), 'Nico Collins');
  assert.strictEqual(f('Nico Colling'), 'Nico Collins'); // OCR typo
  assert.strictEqual(f('N. Collins'), 'Nico Collins');
  assert.strictEqual(f('Collins'), 'Nico Collins');
  assert.strictEqual(f('Michael Pittman'), 'Michael Pittman Jr.');
  assert.strictEqual(f('Will Anderson'), 'Will Anderson Jr.');
  assert.strictEqual(f('CJ Stroud'), 'C.J. Stroud');
  assert.strictEqual(f('Patrick Mahomes'), null);
});

/* ---------- parsing ---------- */
test('summary normalisation: scores, linescores, box score categories', function () {
  const g = game();
  assert.strictEqual(g.state, 'in'); assert.strictEqual(g.period, 3);
  assert.strictEqual(g.away.abbr, 'IND'); assert.strictEqual(g.home.score, 24);
  assert.deepStrictEqual(g.home.linescores, [10, 7, 7]);
  const nico = g.players.find(function (p) { return p.name === 'Nico Collins'; });
  assert.strictEqual(nico.stats.receiving.yds, 88); assert.strictEqual(nico.stats.receiving.rec, 6); assert.strictEqual(nico.stats.receiving.td, 1);
  const stroud = g.players.find(function (p) { return p.name === 'C.J. Stroud'; });
  assert.strictEqual(stroud.stats.passing['c/att_made'], 20); assert.strictEqual(stroud.stats.passing['c/att_att'], 28);
  assert.strictEqual(stroud.stats.passing.sacks_n, 2);
  const k = g.players.find(function (p) { return /Fairbairn/.test(p.name); });
  assert.strictEqual(k.stats.kicking.fg_made, 2); assert.strictEqual(k.stats.kicking.long, 48);
  assert.strictEqual(g.scoringPlays.length, 2); assert.strictEqual(g.scoringPlays[0].team, 'IND');
});

/* ---------- moneyline / spread ---------- */
test('moneyline: live leading, final win/loss', function () {
  const l = leg({ market: 'moneyline', team: 'Texans' });
  let r = E.evaluateLeg(l, game());
  assert.strictEqual(r.state, 'live'); assert.strictEqual(r.kind, 'score'); assert.strictEqual(r.onTrack, true);
  assert.ok(/IND 17 – HOU 24/.test(r.scoreText), r.scoreText);
  r = E.evaluateLeg(l, game({ state: 'post' })); assert.strictEqual(r.state, 'hit');
  r = E.evaluateLeg(leg({ market: 'moneyline', team: 'Colts' }), game({ state: 'post' })); assert.strictEqual(r.state, 'miss');
  r = E.evaluateLeg(l, game({ state: 'pre' })); assert.strictEqual(r.state, 'pending');
});

test('spread: covering, needs-more, push, final', function () {
  const colts = leg({ market: 'spread', team: 'Colts', line: 7.5 }); // down 7 -> covering by .5
  let r = E.evaluateLeg(colts, game());
  assert.strictEqual(r.state, 'live'); assert.strictEqual(r.onTrack, true); assert.ok(/Covering by 0.5/.test(r.detail), r.detail);
  r = E.evaluateLeg(colts, game({ state: 'post' })); assert.strictEqual(r.state, 'hit');
  r = E.evaluateLeg(leg({ market: 'spread', team: 'Colts', line: 6.5 }), game({ state: 'post' })); assert.strictEqual(r.state, 'miss');
  r = E.evaluateLeg(leg({ market: 'spread', team: 'Colts', line: 7 }), game({ state: 'post' })); assert.strictEqual(r.state, 'push');
  r = E.evaluateLeg(leg({ market: 'spread', team: 'Texans', line: -3 }), game()); // up 7, -3 -> covering by 4
  assert.strictEqual(r.onTrack, true); assert.ok(/Covering by 4/.test(r.detail));
});

/* ---------- totals ---------- */
test('game total: over hits early, under busts early, finals', function () {
  // current total 41
  let r = E.evaluateLeg(leg({ market: 'total', side: 'over', line: 40.5 }), game());
  assert.strictEqual(r.state, 'hit'); assert.strictEqual(r.kind, 'total'); assert.strictEqual(r.valueText, '41');
  r = E.evaluateLeg(leg({ market: 'total', side: 'over', line: 54.5 }), game());
  assert.strictEqual(r.state, 'live'); assert.ok(/Needs 14 more/.test(r.detail), r.detail);
  r = E.evaluateLeg(leg({ market: 'total', side: 'under', line: 40.5 }), game()); assert.strictEqual(r.state, 'miss');
  r = E.evaluateLeg(leg({ market: 'total', side: 'under', line: 54.5 }), game()); assert.strictEqual(r.state, 'live');
  r = E.evaluateLeg(leg({ market: 'total', side: 'under', line: 54.5 }), game({ state: 'post' })); assert.strictEqual(r.state, 'hit');
  r = E.evaluateLeg(leg({ market: 'total', side: 'over', line: 54.5 }), game({ state: 'post' })); assert.strictEqual(r.state, 'miss');
  r = E.evaluateLeg(leg({ market: 'total', side: 'over', line: 41 }), game({ state: 'post' })); assert.strictEqual(r.state, 'push');
});

test('team total and first-half markets use the right scores', function () {
  let r = E.evaluateLeg(leg({ market: 'team_total', team: 'Texans', side: 'over', line: 23.5 }), game()); assert.strictEqual(r.state, 'hit');
  r = E.evaluateLeg(leg({ market: 'team_total', team: 'Colts', side: 'over', line: 20.5 }), game()); assert.strictEqual(r.state, 'live');
  // 1H: IND 7+10=17, HOU 10+7=17 -> tied, 3rd quarter in progress so 1H is final
  r = E.evaluateLeg(leg({ market: 'spread', team: 'Colts', line: 0.5, period: '1h' }), game()); assert.strictEqual(r.state, 'hit');
  r = E.evaluateLeg(leg({ market: 'moneyline', team: 'Texans', period: '1h' }), game()); assert.strictEqual(r.state, 'push');
  r = E.evaluateLeg(leg({ market: 'total', side: 'over', line: 33.5, period: '1h' }), game()); assert.strictEqual(r.state, 'hit');
  r = E.evaluateLeg(leg({ market: 'total', side: 'over', line: 34.5, period: '1h' }), game()); assert.strictEqual(r.state, 'miss'); // 1H over, half is finished at 34
  r = E.evaluateLeg(leg({ market: 'total', side: 'over', line: 9.5, period: 'q1' }), game()); assert.strictEqual(r.state, 'hit'); // Q1: 7+10 = 17
  r = E.evaluateLeg(leg({ market: 'total', side: 'over', line: 3.5, period: 'q4' }), game()); assert.strictEqual(r.state, 'pending');
});

/* ---------- player props ---------- */
test('receiving yards over: live fill bar, hit on crossing, miss at final', function () {
  const base = { market: 'player_prop', player: 'Nico Collins', stat: 'receiving_yards', side: 'over' };
  let r = E.evaluateLeg(leg(Object.assign({ line: 99.5 }, base)), game());
  assert.strictEqual(r.state, 'live'); assert.strictEqual(r.kind, 'bar'); assert.strictEqual(r.current, 88);
  assert.ok(Math.abs(r.progress - 88 / 99.5) < 1e-9); assert.ok(/12 to go/.test(r.detail), r.detail);
  assert.ok(/6 rec/.test(r.playerLine), r.playerLine);
  r = E.evaluateLeg(leg(Object.assign({ line: 79.5 }, base)), game()); assert.strictEqual(r.state, 'hit'); assert.strictEqual(r.progress, 1);
  r = E.evaluateLeg(leg(Object.assign({ line: 99.5 }, base)), game({ state: 'post' })); assert.strictEqual(r.state, 'miss');
  r = E.evaluateLeg(leg(Object.assign({ line: 88 }, base)), game({ state: 'post' })); assert.strictEqual(r.state, 'push');
  r = E.evaluateLeg(leg(Object.assign({ line: 99.5 }, base)), game({ state: 'pre', players: [] })); assert.strictEqual(r.state, 'pending'); assert.strictEqual(r.current, 0);
});

test('under props: live until final, bust the moment they pass', function () {
  const base = { market: 'player_prop', player: 'Nico Collins', stat: 'receiving_yards', side: 'under' };
  let r = E.evaluateLeg(leg(Object.assign({ line: 99.5 }, base)), game()); assert.strictEqual(r.state, 'live'); assert.strictEqual(r.onTrack, true);
  r = E.evaluateLeg(leg(Object.assign({ line: 99.5 }, base)), game({ state: 'post' })); assert.strictEqual(r.state, 'hit');
  r = E.evaluateLeg(leg(Object.assign({ line: 79.5 }, base)), game()); assert.strictEqual(r.state, 'miss');
});

test('every supported stat key extracts the right number', function () {
  const g = game();
  const v = function (player, stat) { return St.statValue(g, player, stat).value; };
  assert.strictEqual(v('C.J. Stroud', 'passing_yards'), 260); assert.strictEqual(v('C.J. Stroud', 'passing_tds'), 2);
  assert.strictEqual(v('C.J. Stroud', 'passing_attempts'), 28); assert.strictEqual(v('C.J. Stroud', 'passing_completions'), 20);
  assert.strictEqual(v('C.J. Stroud', 'interceptions_thrown'), 1);
  assert.strictEqual(v('Jonathan Taylor', 'rushing_yards'), 95); assert.strictEqual(v('Jonathan Taylor', 'rushing_attempts'), 18);
  assert.strictEqual(v('Jonathan Taylor', 'rushing_tds'), 2); assert.strictEqual(v('Jonathan Taylor', 'longest_rush'), 41);
  assert.strictEqual(v('Nico Collins', 'receptions'), 6); assert.strictEqual(v('Nico Collins', 'longest_reception'), 34);
  assert.strictEqual(v('Nico Collins', 'receiving_targets'), 9); assert.strictEqual(v('Nico Collins', 'receiving_tds'), 1);
  assert.strictEqual(v('Joe Mixon', 'rush_rec_yards'), 61); assert.strictEqual(v('Joe Mixon', 'pass_rush_yards'), 61);
  assert.strictEqual(v('Fairbairn', 'fg_made'), 2); assert.strictEqual(v('Fairbairn', 'fg_attempted'), 3);
  assert.strictEqual(v('Fairbairn', 'xp_made'), 3); assert.strictEqual(v('Fairbairn', 'kicking_points'), 9); assert.strictEqual(v('Fairbairn', 'longest_fg'), 48);
  assert.strictEqual(v('Will Anderson', 'tackles_assists'), 5); assert.strictEqual(v('Will Anderson', 'solo_tackles'), 4); assert.strictEqual(v('Will Anderson', 'sacks'), 1.5);
  assert.strictEqual(v('Jonathan Taylor', 'total_tds'), 2);
  assert.strictEqual(St.statValue(g, 'Nico Collins', 'longest_completion').status, 'unsupported');
});

test('fantasy points: DraftKings bonuses/PPR vs FanDuel half-PPR', function () {
  const p = St.findPlayer(game().players, 'Nico Collins'); // 6 rec, 88 yds, 1 TD, 1 fumble lost
  assert.strictEqual(St.fantasyPoints(p, 'ppr'), 8.8 + 6 + 6 - 1);
  assert.strictEqual(St.fantasyPoints(p, 'dk'), 8.8 + 6 + 6 - 1);
  assert.strictEqual(St.fantasyPoints(p, 'fd'), 8.8 + 3 + 6 - 2);
  const big = { stats: { receiving: { rec: 10, yds: 120, td: 0 } } };
  assert.strictEqual(St.fantasyPoints(big, 'dk'), 12 + 10 + 3); // 100-yd bonus
  const qb = St.findPlayer(game().players, 'Stroud'); // 260y, 2TD, 1INT
  assert.strictEqual(St.fantasyPoints(qb, 'dk'), 10.4 + 8 - 1);
  const r = E.evaluateLeg(leg({ market: 'player_prop', player: 'Nico Collins', stat: 'fantasy_points', side: 'over', line: 19.5, fantasy_system: 'dk' }), game());
  assert.strictEqual(r.current, 19.8); assert.strictEqual(r.state, 'hit');
});

/* ---------- TD scorers ---------- */
test('anytime TD: hit, still live, miss at final, pending pregame', function () {
  let r = E.evaluateLeg(leg({ market: 'anytime_td', player: 'Jonathan Taylor' }), game());
  assert.strictEqual(r.state, 'hit'); assert.strictEqual(r.kind, 'bar'); assert.strictEqual(r.progress, 1);
  r = E.evaluateLeg(leg({ market: 'anytime_td', player: 'Tank Dell' }), game()); assert.strictEqual(r.state, 'live'); assert.strictEqual(r.progress, 0);
  r = E.evaluateLeg(leg({ market: 'anytime_td', player: 'Tank Dell' }), game({ state: 'post' })); assert.strictEqual(r.state, 'miss');
  r = E.evaluateLeg(leg({ market: 'anytime_td', player: 'Tank Dell' }), game({ state: 'pre', players: [] })); assert.strictEqual(r.state, 'pending');
  // WR with zero stats isn't in the box score at all
  r = E.evaluateLeg(leg({ market: 'anytime_td', player: 'Some Backup' }), game()); assert.strictEqual(r.state, 'live');
});

test('first TD scorer: rusher and pass-catcher names resolve correctly', function () {
  let r = E.evaluateLeg(leg({ market: 'first_td', player: 'Jonathan Taylor' }), game()); assert.strictEqual(r.state, 'hit');
  r = E.evaluateLeg(leg({ market: 'first_td', player: 'Nico Collins' }), game()); assert.strictEqual(r.state, 'miss');
  r = E.evaluateLeg(leg({ market: 'first_td', player: 'C.J. Stroud' }), game()); assert.strictEqual(r.state, 'miss'); // passer is not the scorer
  r = E.evaluateLeg(leg({ market: 'first_td', player: 'Nico Collins' }), game({ scoringPlays: [], state: 'in' })); assert.strictEqual(r.state, 'live');
  r = E.evaluateLeg(leg({ market: 'last_td', player: 'Nico Collins' }), game({ state: 'post' })); assert.strictEqual(r.state, 'hit');
});

/* ---------- manual / unresolved / summary ---------- */
test('manual overrides, manual values and untrackable legs', function () {
  let r = E.evaluateLeg(leg({ market: 'other', raw_text: 'Longest TD over 40.5' }), game());
  assert.strictEqual(r.state, 'unresolved'); assert.ok(/mark it yourself/.test(r.detail));
  r = E.evaluateLeg(leg({ market: 'other', manual: { state: 'hit' } }), game()); assert.strictEqual(r.state, 'hit');
  r = E.evaluateLeg(leg({ market: 'player_prop', player: 'X Y', stat: 'longest_completion', side: 'over', line: 44.5 }), game());
  assert.strictEqual(r.state, 'unresolved'); assert.strictEqual(r.kind, 'bar');
  r = E.evaluateLeg(leg({ market: 'player_prop', player: 'X Y', stat: 'longest_completion', side: 'over', line: 44.5, manualValue: 50 }), game());
  assert.strictEqual(r.state, 'hit'); assert.strictEqual(r.current, 50);
  r = E.evaluateLeg(leg({ market: 'moneyline', team: 'Jets' }), null); assert.strictEqual(r.state, 'unresolved');
  r = E.evaluateLeg(leg({ market: 'moneyline', team: 'Jets' }), game()); assert.ok(/not found in this game/.test(r.detail));
});

test('parlay summary: live / won / lost / pending', function () {
  const mk = function (states) { return states.map(function (s) { return { state: s }; }); };
  assert.strictEqual(E.summarize(mk(['hit', 'live', 'pending'])).status, 'live');
  assert.strictEqual(E.summarize(mk(['hit', 'hit', 'push'])).status, 'won');
  assert.strictEqual(E.summarize(mk(['hit', 'miss', 'pending'])).status, 'lost');
  assert.strictEqual(E.summarize(mk(['pending', 'pending'])).status, 'pending');
  assert.strictEqual(E.summarize(mk(['void', 'void'])).status, 'void');
  assert.strictEqual(E.summarize(mk(['hit', 'live'])).hits, 1);
});

test('the user\'s example parlay renders sensible titles', function () {
  const titles = [
    leg({ market: 'moneyline', team: 'Jets' }), leg({ market: 'anytime_td', player: 'Derrick Henry' }),
    leg({ market: 'total', side: 'over', line: 54.5, away_team: 'Raiders', home_team: 'Browns' }), leg({ market: 'spread', team: 'Saints', line: 7.5 }),
    leg({ market: 'player_prop', player: 'Nico Collins', stat: 'receiving_yards', side: 'over', line: 79.5 }),
  ].map(E.describeLeg);
  assert.deepStrictEqual(titles, ['Jets ML', 'Derrick Henry Anytime TD', 'Raiders @ Browns Over 54.5', 'Saints +7.5', 'Nico Collins Over 79.5 Receiving Yards']);
});

/* ---------- demo ---------- */
test('demo simulation runs the full parlay from live to won', function () {
  const Demo = require('../public/demo.js');
  assert.ok(Demo && Demo.parlay, 'demo module should export');
  Demo.reset();
  const p = Demo.parlay();
  const run = function () {
    return p.legs.map(function (l) { return E.evaluateLeg(l, Demo.getGame(l.gameId)); });
  };
  let sum = E.summarize(run());
  assert.strictEqual(sum.status, 'live');
  while (!Demo.done()) Demo.tick(0.05);
  const res = run();
  assert.deepStrictEqual(res.map(function (r) { return r.state; }), ['hit', 'hit', 'hit', 'hit', 'hit']);
  assert.strictEqual(E.summarize(res).status, 'won');
});

/* ---------- server (stubbed network) ---------- */
test('server: config, static files, traversal guard, parse, games, game, resolve', async function () {
  const http = require('http');
  const realFetch = global.fetch;
  const calls = [];
  const sb = { events: [
    F.ev(401, F.IND, F.HOU, 'in', 17, 24),
    F.ev(402, F.team(3, 'NYJ', 'New York Jets'), F.team(4, 'DEN', 'Denver Broncos'), 'pre', 0, 0),
    F.ev(403, F.team(5, 'PIT', 'Pittsburgh Steelers'), F.team(6, 'BAL', 'Baltimore Ravens'), 'post', 17, 27),
  ] };
  global.fetch = async function (url, opts) {
    url = String(url); calls.push({ url: url, opts: opts });
    const json = function (o, status) { return { ok: (status || 200) < 400, status: status || 200, json: async function () { return o; }, text: async function () { return JSON.stringify(o); } }; };
    if (url.indexOf('api.openai.com/v1/chat/completions') >= 0) {
      return json({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_bet', arguments: JSON.stringify({ bet_type: 'parlay', wager: 10, payout: 122.5, legs: [{ raw_text: 'Jets ML', market: 'moneyline', team: 'Jets' }] }) } }] } }] });
    }
    if (url.indexOf('college-football') >= 0 && url.indexOf('/scoreboard') >= 0) return json({ events: [] }); // NFL-only fixtures
    if (url.indexOf('/scoreboard') >= 0) return json(sb);
    if (url.indexOf('/summary?event=401') >= 0) return json(F.liveGame);
    if (url.indexOf('/roster') >= 0) return json({ athletes: [{ position: 'offense', items: [{ displayName: 'Garrett Wilson' }, { displayName: 'Breece Hall' }] }] });
    return json({ error: 'nope' }, 404);
  };
  const { server } = require('../server.js');
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const req = function (method, p, body, headers) {
    return new Promise(function (resolve, reject) {
      const data = body ? JSON.stringify(body) : null;
      const rq = http.request({ host: '127.0.0.1', port: port, path: p, method: method, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) }, function (res) {
        let s = ''; res.on('data', function (c) { s += c; }); res.on('end', function () { let j = null; try { j = JSON.parse(s); } catch (e) { /* html */ } resolve({ status: res.statusCode, body: s, json: j, headers: res.headers }); });
      });
      rq.on('error', reject); if (data) rq.write(data); rq.end();
    });
  };
  try {
    delete process.env.OPENAI_API_KEY;
    let r = await req('GET', '/api/config'); assert.strictEqual(r.json.hasServerKey, false);
    r = await req('GET', '/'); assert.strictEqual(r.status, 200); assert.ok(/Parlay Tracker/.test(r.body));
    r = await req('GET', '/lib/evaluate.js'); assert.strictEqual(r.status, 200);
    r = await req('GET', '/..%2Fserver.js'); assert.ok(r.status === 403 || r.status === 404, 'traversal blocked, got ' + r.status);
    r = await req('GET', '/%2e%2e/server.js'); assert.ok(r.status === 403 || r.status === 404);

    // parse: no key -> clear 401
    const img = { mediaType: 'image/png', data: 'iVBORw0KGgo=' };
    r = await req('POST', '/api/parse', { images: [img] }); assert.strictEqual(r.status, 401); assert.ok(/API key/.test(r.json.error));
    // parse: with key from header -> forced tool call, image forwarded
    r = await req('POST', '/api/parse', { images: [img] }, { 'x-api-key': 'sk-test' });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.bet.legs[0].team, 'Jets');
    const a = calls.find(function (c) { return c.url.indexOf('api.openai.com/v1/chat/completions') >= 0; });
    const sent = JSON.parse(a.opts.body);
    assert.strictEqual(sent.tool_choice.function.name, 'submit_bet'); assert.strictEqual(a.opts.headers.authorization, 'Bearer sk-test');
    assert.ok(sent.messages[1].content.some(function (c) { return c.type === 'image_url' && /image\/png;base64/.test(c.image_url.url); }));
    assert.ok(sent.tools[0].function.parameters.properties.legs.items.properties.market.enum.indexOf('anytime_td') >= 0);
    r = await req('POST', '/api/parse', { images: [{ mediaType: 'application/pdf', data: 'x' }] }, { 'x-api-key': 'k' }); assert.strictEqual(r.status, 400);

    // games + game
    r = await req('GET', '/api/games'); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.games.length, 3);
    assert.ok(r.json.games.every(function (g) { return g.thisWeek; }));
    r = await req('GET', '/api/game/401'); assert.strictEqual(r.json.game.away.abbr, 'IND'); assert.ok(r.json.game.players.length >= 8);

    // resolve: matchup, single team, player in live box score, player on a pregame roster, unknown
    r = await req('POST', '/api/resolve', { legs: [
      { id: 'a', market: 'total', away_team: 'Raiders', home_team: 'Browns' },
      { id: 'b', market: 'moneyline', team: 'Jets' },
      { id: 'c', market: 'player_prop', player: 'Nico Collins' },
      { id: 'd', market: 'anytime_td', player: 'Breece Hall' },
      { id: 'e', market: 'moneyline', team: 'Ravens' },
      { id: 'f', market: 'player_prop', player: 'Nobody Real' },
      { id: 'g', market: 'player_prop', player: 'Nico Collins', team: 'Texans', away_team: 'Colts', home_team: 'Texans' },
    ] });
    const m = {}; r.json.results.forEach(function (x) { m[x.id] = x; });
    assert.strictEqual(m.a.gameId, null);
    assert.strictEqual(m.b.gameId, '402');
    assert.strictEqual(m.c.gameId, '401'); assert.strictEqual(m.c.team, 'HOU');
    assert.strictEqual(m.d.gameId, '402'); assert.strictEqual(m.d.team, 'NYJ');
    assert.strictEqual(m.e.gameId, '403');
    assert.strictEqual(m.f.gameId, null);
    assert.strictEqual(m.g.gameId, '401');
  } finally {
    global.fetch = realFetch; server.close();
  }
});

runAll();
