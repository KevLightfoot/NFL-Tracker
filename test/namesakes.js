'use strict';
// Same name in the pros and in college (Derrick Henry, Lamar Jackson, Michael Wilson): a prop with no team on the slip must land in the right game.
const assert = require('assert');
const server = require('../server.js');
const tests = [], test = function (n, f) { tests.push([n, f]); };
const H = 36e5, now = Date.now();
const iso = function (hoursFromNow) { return new Date(now + hoursFromNow * H).toISOString(); };
const team = function (id, abbr) { return { id: String(id), abbr: abbr }; };
const G = function (id, league, state, hrs, a, h) { return { id: id, league: league, state: state, thisWeek: true, date: iso(hrs), away: a, home: h, completed: state === 'post' }; };
const games = [
  G('n1', 'nfl', 'in', -0.3, team(101, 'BAL'), team(102, 'BUF')),      // live: Henry + Lamar Jackson
  G('n2', 'nfl', 'in', -0.2, team(103, 'ARI'), team(104, 'DAL')),      // live: Michael Wilson (ARI)
  G('n3', 'nfl', 'post', -150, team(29, 'CAR'), team(9, 'GB')),        // finished last week, has a different Michael Wilson
  G('c1', 'cfb', 'post', -20, team(201, 'FAU'), team(202, 'UNT')),     // yesterday's college game: a Derrick Henry with 10 catches
  G('c2', 'cfb', 'post', -14, team(203, 'ILL'), team(204, 'MD')),      // yesterday's college game: a Lamar Jackson
  G('c3', 'cfb', 'in', -1, team(205, 'ORST'), team(206, 'FRES')),      // live college game: a Josh Allen, a Lamar Jackson
  G('c4', 'cfb', 'pre', 3, team(207, 'GT'), team(208, 'CLEM')),
  G('n4', 'nfl', 'pre', 24, team(105, 'NE'), team(106, 'MIA')),        // tomorrow: Ollie Gordon
];
const BOX = {
  n1: { BAL: ['Derrick Henry', 'Lamar Jackson'], BUF: ['Josh Allen'] },
  n2: { ARI: ['Michael Wilson'], DAL: ['CeeDee Lamb'] },
  n3: { CAR: ['Chuba Hubbard'], GB: ['Michael Wilson'] },
  c1: { FAU: ['Derrick Henry'], UNT: ['Someone Else'] },
  c2: { ILL: ['Lamar Jackson'], MD: ['Other Guy'] },
  c3: { ORST: ['Lamar Jackson', 'Josh Allen'], FRES: ['Fresno Guy'] },
};
const ids = { 101: 'BAL', 102: 'BUF', 103: 'ARI', 104: 'DAL', 29: 'CAR', 9: 'GB', 201: 'FAU', 202: 'UNT', 203: 'ILL', 204: 'MD', 205: 'ORST', 206: 'FRES', 207: 'GT', 208: 'CLEM', 105: 'NE', 106: 'MIA' };
const ROSTER = { 105: ['Rhamondre Stevenson'], 106: ['Tua Tagovailoa'], 207: ['Haynes King'], 208: ['Cade Klubnik'] };
const ok = function (j) { return { ok: true, status: 200, json: async function () { return j; } }; };
const summary = function (g) {
  const box = BOX[g.id] || {};
  const grp = function (side) { const names = box[side.abbr] || []; return { team: { id: side.id, abbreviation: side.abbr }, statistics: [{ name: 'receiving', labels: ['REC', 'YDS', 'TD'], athletes: names.map(function (n) { return { athlete: { displayName: n, id: n + side.abbr }, stats: ['10', '80', '1'] }; }) }] }; };
  return { header: { id: g.id, competitions: [{ status: { type: { state: g.state, completed: g.state === 'post', detail: g.state === 'post' ? 'Final' : '10:00 - 1st' }, period: 1, displayClock: '10:00' }, competitors: [
    { homeAway: 'away', score: '0', team: { id: g.away.id, abbreviation: g.away.abbr } }, { homeAway: 'home', score: '0', team: { id: g.home.id, abbreviation: g.home.abbr } }] }] }, boxscore: { players: [grp(g.away), grp(g.home)] } };
};
const run = async function (legs, body) {
  const realFetch = global.fetch;
  global.fetch = async function (url) {
    const u = String(url); let m;
    if ((m = u.match(/summary\?event=(\w+)/))) { const g = games.find(function (x) { return x.id === m[1]; }); return g ? ok(summary(g)) : { ok: false, status: 404, json: async function () { return {}; } }; }
    if ((m = u.match(/teams\/(\d+)\/roster/))) return ok({ athletes: [{ items: (ROSTER[m[1]] || []).map(function (n) { return { displayName: n }; }) }] });
    return { ok: false, status: 404, json: async function () { return {}; } };
  };
  try { return await body(legs); } finally { global.fetch = realFetch; }
};
const prop = function (id, player, o) { return Object.assign({ id: id, market: 'player_prop', player: player, stat: 'receptions', line: 0.5, side: 'over', league: 'cfb' }, o || {}); };
const td = function (id, player, o) { return Object.assign({ id: id, market: 'anytime_td', player: player }, o || {}); };

test('the slip from the screenshot: Henry and Lamar go to the live pro game, not yesterday\'s college namesakes (model said cfb)', async function () {
  const out = await run(null, function () { return server.resolveSlip([prop('a', 'Derrick Henry'), prop('b', 'Lamar Jackson', { stat: 'passing_tds' }), prop('c', 'Josh Allen', { stat: 'passing_tds' })], games); });
  assert.deepStrictEqual([out[0].gameId, out[0].league, out[0].team], ['n1', 'nfl', 'BAL']);
  assert.deepStrictEqual([out[1].gameId, out[1].team], ['n1', 'BAL']);
  assert.strictEqual(out[2].gameId, 'n1', 'Josh Allen: the live pro game, even though a live college namesake exists');
});
test('single anytime-TD slips: Lamar Jackson -> live pro game whatever the hint (cfb, nfl or none)', async function () {
  for (const lg of ['cfb', 'nfl', null]) {
    const out = await run(null, function () { return server.resolveSlip([td('a', 'Lamar Jackson', { league: lg })], games); });
    assert.strictEqual(out[0].gameId, 'n1', 'hint ' + lg); assert.strictEqual(out[0].team, 'BAL');
  }
});
test('Michael Wilson: the live game he is in beats a week-old final with another Michael Wilson', async function () {
  for (const lg of ['nfl', 'cfb', null]) {
    const out = await run(null, function () { return server.resolveSlip([td('a', 'Michael Wilson', { league: lg })], games); });
    assert.deepStrictEqual([out[0].gameId, out[0].team], ['n2', 'ARI'], 'hint ' + lg);
  }
});
test('lean: with college slip-mates already placed, the college namesake wins the tie', async function () {
  const realFetch = global.fetch; const g0 = games.slice();
  const r = await run(null, async function () {
    // resolveSlip derives its lean from where the slip\'s own legs landed; emulate it by calling findPlayerGame through resolveLeg
    return server.resolveLeg(prop('a', 'Lamar Jackson'), g0, 'cfb');
  });
  assert.strictEqual(r.gameId, 'c3'); assert.strictEqual(r.league, 'cfb'); assert.strictEqual(r.team, 'ORST');
  const r2 = await run(null, function () { return server.resolveLeg(prop('a', 'Lamar Jackson'), g0, 'nfl'); });
  assert.strictEqual(r2.gameId, 'n1'); global.fetch = realFetch;
});
test('the date printed on the slip picks the game: an earlier date -> that day\'s college game', async function () {
  const d = function (h) { return new Date(now + h * H).toISOString().slice(0, 10); };
  // (two days back, so the date never coincides with today's live games whatever time of day the test runs)
  const c1 = games.find(function (g) { return g.id === 'c1'; }), was = c1.date;
  c1.date = iso(-50);
  try {
    const out = await run(null, function () { return server.resolveSlip([prop('a', 'Derrick Henry', { game_date: d(-50) })], games); });
    assert.strictEqual(out[0].gameId, 'c1');
  } finally { c1.date = was; }
});
const Teams = require('../public/lib/teams.js');
[['FAU', 'Florida Atlantic Owls', 'Florida Atlantic', 'Owls'], ['UNT', 'North Texas Mean Green', 'North Texas', 'Mean Green']].forEach(function (t) { Teams.registerTeam('cfb', { abbr: t[0], name: t[1], short: t[2], nick: t[3], location: t[2] }); });
test('a slip that is entirely finished keeps its prop in the finished game (nothing flips to a live namesake)', async function () {
  const out = await run(null, function () { return server.resolveSlip([
    { id: 's', market: 'moneyline', team: 'North Texas', away_team: 'Florida Atlantic', home_team: 'North Texas', league: 'cfb' },
    prop('a', 'Derrick Henry')], games); });
  assert.strictEqual(out[0].gameId, 'c1'); assert.strictEqual(out[1].gameId, 'c1', 'finished slip, finished game');
});
test('a slip that still has an open game does not pull a prop into a finished namesake game', async function () {
  const out = await run(null, function () { return server.resolveSlip([
    { id: 's', market: 'moneyline', team: 'North Texas', away_team: 'Florida Atlantic', home_team: 'North Texas', league: 'cfb' },
    { id: 't', market: 'moneyline', team: 'Patriots', away_team: 'Patriots', home_team: 'Dolphins', league: 'nfl' },
    prop('a', 'Derrick Henry')], games); });
  assert.strictEqual(out[0].gameId, 'c1'); assert.strictEqual(out[1].gameId, 'n4');
  assert.strictEqual(out[2].gameId, 'n1', 'the live pro Henry, not the finished college one');
});
test('upcoming games are searched by roster; nobody found -> no game', async function () {
  const out = await run(null, function () { return server.resolveSlip([prop('a', 'Rhamondre Stevenson'), prop('b', 'Nobody Atall')], games); });
  assert.strictEqual(out[0].gameId, 'n4'); assert.strictEqual(out[0].team, 'NE');
  assert.strictEqual(out[1].gameId, null);
});
test('NBA/MLB hints still only search that league', async function () {
  const b1 = G('b1', 'nba', 'in', -0.5, team(301, 'LAL'), team(302, 'BOS'));
  BOX.b1 = { LAL: ['Lamar Jackson'], BOS: ['Jaylen Brown'] }; games.push(b1);
  try {
    const out = await run(null, function () { return server.resolveSlip([prop('a', 'Lamar Jackson', { league: 'nba', stat: 'points' })], games); });
    assert.strictEqual(out[0].gameId, 'b1'); assert.strictEqual(out[0].league, 'nba');
    const foot = await run(null, function () { return server.resolveSlip([td('a', 'Lamar Jackson', { league: 'nfl' })], games); });
    assert.strictEqual(foot[0].gameId, 'n1', 'a football hint never lands in a basketball game');
  } finally { games.pop(); delete BOX.b1; }
});
test('a slip-mate game that is still open wins over any search (one slip = one game)', async function () {
  const out = await run(null, function () { return server.resolveSlip([prop('a', 'Derrick Henry'), prop('b', 'Lamar Jackson', { stat: 'passing_tds' })], games); });
  assert.strictEqual(out[0].gameId, 'n1'); assert.strictEqual(out[1].gameId, 'n1');
});

(async function () {
  let pass = 0, fail = 0;
  for (const t of tests) { try { await t[1](); pass++; console.log('  ✓ ' + t[0]); } catch (e) { fail++; console.log('  ✗ ' + t[0] + '\n      ' + (e && e.message)); } }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
