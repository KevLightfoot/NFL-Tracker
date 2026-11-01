'use strict';
// The live situation survives the real server path: scoreboard -> /api/games, summary -> /api/game/:id, scoreboard backfill, stale-data guards.
const assert = require('assert'), http = require('http');
const json = function (o, status) { return { ok: (status || 200) < 400, status: status || 200, json: async function () { return o; }, text: async function () { return JSON.stringify(o); } }; };
const comp = function (id, state, sit, extra) {
  return Object.assign({ id: String(id), date: '2026-10-31T23:00Z', status: { type: { state: state, completed: state === 'post', shortDetail: '4:58 - 1st' }, period: 1, displayClock: '4:58' },
    competitors: [{ homeAway: 'away', team: { id: '10', abbreviation: 'MSST', displayName: 'Mississippi State Bulldogs' }, score: '0' }, { homeAway: 'home', team: { id: '20', abbreviation: 'TEX', displayName: 'Texas Longhorns' }, score: '7' }] }, extra || {});
};
const ev = function (id, state, sit) { const c = comp(id, state); c.situation = sit; return { id: String(id), date: c.date, status: c.status, shortName: 'MSST @ TEX', competitions: [c] }; };
const summary = function (id, state, top) { const c = comp(id, state); delete c.id; return Object.assign({ header: { id: String(id), competitions: [c] }, boxscore: { players: [] } }, top || {}); };
const SIT = { possession: '20', down: 2, distance: 7, possessionText: 'MSST 35', downDistanceText: '2nd & 7 at MSST 35', shortDownDistanceText: '2nd & 7', lastPlay: { text: 'Run for 3 yds' } };

(async function () {
  const realFetch = global.fetch;
  const live = { 601: SIT, 602: SIT, 603: null };
  global.fetch = async function (url) {
    url = String(url);
    if (/college-football\/scoreboard/.test(url)) return json({ events: [ev(601, 'in', SIT), ev(602, 'in', SIT), ev(603, 'in', undefined), ev(604, 'post', SIT)] });
    if (/\/nfl\/scoreboard/.test(url)) return json({ events: [] });
    if (/summary\?event=601/.test(url)) return json(summary(601, 'in'));                                         // summary has none: backfill from scoreboard
    if (/summary\?event=602/.test(url)) return json(summary(602, 'in', { situation: { possession: '10', down: 1, distance: 10, possessionText: 'MSST 20', shortDownDistanceText: '1st & 10' } })); // summary wins
    if (/summary\?event=603/.test(url)) return json(summary(603, 'in'));
    if (/summary\?event=604/.test(url)) return json(summary(604, 'post', { situation: SIT }));               // finished: never shown
    return json({}, 404);
  };
  const { server } = require('../server.js');
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const get = function (p) { return new Promise(function (resolve, reject) { http.get({ host: '127.0.0.1', port: port, path: p }, function (res) { let s = ''; res.on('data', function (c) { s += c; }); res.on('end', function () { resolve(JSON.parse(s)); }); }).on('error', reject); }); };
  let fail = 0;
  const t = async function (name, f) { try { await f(); console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } };
  try {
    await t('/api/games carries the situation for live games only', async function () {
      const gs = (await get('/api/games')).games, by = {}; gs.forEach(function (g) { by[g.id] = g; });
      assert.ok(by[601].sit && by[601].sit.possAbbr === 'TEX' && by[601].sit.x === 35 && by[601].sit.toGoal === 35, JSON.stringify(by[601].sit));
      assert.strictEqual(by[603].sit, undefined); assert.strictEqual(by[604].sit, undefined);
    });
    await t('/api/game: summary without a situation is backfilled from the scoreboard', async function () {
      const g = (await get('/api/game/601?league=cfb')).game;
      assert.ok(g.sit, 'sit missing'); assert.strictEqual(g.sit.dd, '2nd & 7'); assert.strictEqual(g.sit.possAbbr, 'TEX'); assert.strictEqual(g.sit.last, 'Run for 3 yds');
    });
    await t('/api/game: the summary\'s own (fresher) situation beats the scoreboard\'s', async function () {
      const g = (await get('/api/game/602?league=cfb')).game;
      assert.strictEqual(g.sit.possAbbr, 'MSST'); assert.strictEqual(g.sit.dd, '1st & 10'); assert.strictEqual(g.sit.x, 20);
    });
    await t('/api/game: nothing anywhere -> no situation key, no crash', async function () {
      const g = (await get('/api/game/603?league=cfb')).game; assert.strictEqual(g.sit, undefined); assert.strictEqual(g.state, 'in');
    });
    await t('/api/game: a finished game never shows a situation', async function () {
      const g = (await get('/api/game/604?league=cfb')).game; assert.strictEqual(g.sit, undefined);
    });
  } finally { server.close(); global.fetch = realFetch; }
  console.log('\n' + (fail ? fail + ' failed' : 'all passed'));
  process.exit(fail ? 1 : 0);
})();
