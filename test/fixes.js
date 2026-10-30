'use strict';
// Regression tests for the "0 bug", ladder lines, wrong-team player lookups and slip-aware resolving.
const assert = require('assert');
const Stats = require('../public/lib/stats.js');
const E = require('../public/lib/evaluate.js');

const tests = [];
const test = function (n, f) { tests.push([n, f]); };
const live = function (players) {
  return { id: 'g1', league: 'nfl', state: 'in', completed: false, period: 2, clock: '7:13', detail: '7:13 - 2nd', away: { abbr: 'CAR', score: 10, linescores: [] }, home: { abbr: 'GB', score: 6, linescores: [] }, players: players };
};
const kraft = { name: 'Tucker Kraft', team: 'GB', stats: { receiving: { rec: 2, yds: 21, td: 0 } } };
const jacobs = { name: 'Josh Jacobs', team: 'GB', stats: { rushing: { car: 8, yds: 12, td: 1 } } };
const leg = function (o) { return Object.assign({ id: 'l', market: 'player_prop', side: 'over', period: 'full', league: 'nfl', gameId: 'g1' }, o); };

test('a missing line is never graded against 0 (props, spreads, totals)', function () {
  const g = live([kraft]);
  ['player_prop', 'spread', 'total', 'team_total'].forEach(function (market) {
    const r = E.evaluateLeg(leg({ market: market, player: 'Tucker Kraft', team: 'GB', stat: 'receiving_yards', line: null }), g);
    assert.strictEqual(r.state, 'unresolved', market);
    assert.ok(/line is missing/.test(r.detail), market);
  });
  const r0 = E.evaluateLeg(leg({ player: 'Tucker Kraft', stat: 'receiving_yards', line: 0 }), g);
  assert.strictEqual(r0.state, 'unresolved', 'a model "0" on a prop is also "no line"');
  assert.strictEqual(E.evaluateLeg(leg({ market: 'spread', team: 'GB', line: 0 }), g).state === 'unresolved', false, 'a 0 spread (pick\'em) is real');
  assert.strictEqual(E.evaluateLeg(leg({ player: 'Tucker Kraft', stat: 'receptions', line: 1.5 }), g).state, 'hit');
});

test('ladder lines: "30+" is over 29.5 whatever the model said; only the exact bad value is rewritten', function () {
  const mk = function (line, raw) { return { market: 'player_prop', side: 'over', line: line, raw_text: raw }; };
  let l = mk(30, 'Chuba Hubbard 30+ Rushing Yards'); assert.ok(E.applyLadder(l, false)); assert.strictEqual(l.line, 29.5);
  l = mk(null, '30+ Chuba Hubbard Rushing Yards'); assert.ok(!E.applyLadder(l, false), 'migration leaves missing lines alone'); assert.ok(E.applyLadder(l, true)); assert.strictEqual(l.line, 29.5);
  l = mk(29.5, '30+ Rushing Yards'); assert.ok(!E.applyLadder(l, true)); assert.strictEqual(l.line, 29.5);
  l = mk(45.5, '30+ Rushing Yards'); assert.ok(!E.applyLadder(l, false), 'a line someone typed is kept'); assert.strictEqual(l.line, 45.5);
  l = mk(1.5, '2+ Touchdowns'); assert.ok(!E.applyLadder(l, false)); assert.strictEqual(l.line, 1.5);
  l = mk(2, '2+'); E.applyLadder(l, false); assert.strictEqual(l.line, 1.5);
  l = mk(30, 'Chuba Hubbard Over 30 +110'); assert.ok(!E.applyLadder(l, true), 'odds like "+110" are not ladders'); assert.strictEqual(l.line, 30);
  l = mk(29.5, 'Over 29.5 +110'); assert.ok(!E.applyLadder(l, true));
  l = { market: 'player_prop', side: 'under', line: 30, raw_text: '30+' }; assert.ok(!E.applyLadder(l, true));
  l = { market: 'moneyline', line: null, raw_text: '5+' }; assert.ok(!E.applyLadder(l, true));
  // and the 30/30 case from the screenshot now behaves: 30 yards clears "30+"
  const g = live([{ name: 'Chuba Hubbard', team: 'CAR', stats: { rushing: { car: 8, yds: 30, td: 0 } } }]);
  const bad = leg({ player: 'Chuba Hubbard', stat: 'rushing_yards', line: 30, raw_text: '30+' }); E.applyLadder(bad, false);
  assert.strictEqual(E.evaluateLeg(bad, g).state, 'hit');
});

test('player lookup: a wrong team on the slip no longer hides a player who is in the box score', function () {
  const g = live([kraft, jacobs, { name: 'Jordan Love', team: 'GB', stats: {} }, { name: 'Chuba Hubbard', team: 'CAR', stats: { rushing: { yds: 14 } } }]);
  assert.strictEqual(Stats.findPlayer(g.players, 'Tucker Kraft', 'CAR').name, 'Tucker Kraft', 'slip said CAR, he is GB');
  assert.strictEqual(Stats.findPlayer(g.players, 'Tucker Kraft', 'GB').name, 'Tucker Kraft');
  assert.strictEqual(Stats.findPlayer(g.players, 'Tucker Kraft').name, 'Tucker Kraft');
  assert.strictEqual(Stats.findPlayer(g.players, 'Nobody Here', 'CAR'), null);
  // team still breaks ties between same-named players
  const twins = [{ name: 'Josh Allen', team: 'BUF' }, { name: 'Josh Allen', team: 'JAX' }];
  assert.strictEqual(Stats.findPlayer(twins, 'Josh Allen', 'JAX').team, 'JAX');
  const r = E.evaluateLeg(leg({ player: 'Tucker Kraft', team: 'Panthers', stat: 'receptions', line: 1.5 }), g);
  assert.strictEqual(r.state, 'hit'); assert.strictEqual(r.current, 2);
  const t = E.evaluateLeg(leg({ market: 'player_prop', player: 'Josh Jacobs', team: 'Panthers', stat: 'total_tds', line: 0.5 }), g);
  assert.strictEqual(t.current, 1);
});

test('resolving: a prop with no matchup is placed in the game its slip-mates are in (and learns his real team)', async function () {
  const server = require('../server.js');
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async function (url) {
    calls.push(String(url));
    const u = String(url);
    if (/summary\?event=401/.test(u)) {
      const mk = function (team, abbr, names) {
        return { team: { id: abbr === 'GB' ? '9' : '29', abbreviation: abbr }, statistics: [{ name: 'receiving', labels: ['REC', 'YDS', 'TD'], athletes: names.map(function (n) { return { athlete: { displayName: n, id: n }, stats: ['2', '21', '0'] }; }) }] };
      };
      return { ok: true, status: 200, json: async function () { return {
        header: { id: '401', competitions: [{ status: { type: { state: 'in', completed: false, detail: '7:13 - 2nd', description: 'In Progress' }, period: 2, displayClock: '7:13' }, competitors: [
          { homeAway: 'away', score: '10', team: { id: '29', abbreviation: 'CAR', displayName: 'Carolina Panthers' } }, { homeAway: 'home', score: '6', team: { id: '9', abbreviation: 'GB', displayName: 'Green Bay Packers' } }] }] },
        boxscore: { players: [mk('CAR', 'CAR', ['Chuba Hubbard']), mk('GB', 'GB', ['Tucker Kraft'])] } }; } };
    }
    return { ok: false, status: 404, json: async function () { return {}; } };
  };
  try {
    const games = [{ id: '401', league: 'nfl', state: 'in', thisWeek: true, date: new Date().toISOString(), away: { id: '29', abbr: 'CAR' }, home: { id: '9', abbr: 'GB' } },
                   { id: '777', league: 'cfb', state: 'in', thisWeek: true, date: new Date().toISOString(), away: { id: '1', abbr: 'SMU' }, home: { id: '2', abbr: 'SYR' } }];
    const legs = [
      { id: 'a', market: 'spread', team: 'CAR Panthers', line: 17.5, league: 'nfl', away_team: 'CAR Panthers', home_team: 'GB Packers' },
      { id: 'b', market: 'player_prop', player: 'Tucker Kraft', stat: 'receptions', line: 1.5, league: 'cfb' },
    ];
    // the resolver is exported; resolveSlip is internal, so go through the endpoint-shaped helper
    const out = await server.resolveSlip(legs, games);
    assert.strictEqual(out[0].gameId, '401');
    assert.strictEqual(out[1].gameId, '401', 'prop joins the slip\'s game even though the model labelled it cfb');
    assert.strictEqual(out[1].team, 'GB', 'and carries his real team');
  } finally { global.fetch = realFetch; }
});

(async function () {
  let pass = 0, fail = 0;
  for (const [n, f] of tests) { try { await f(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + '\n      ' + (e && e.stack || e)); } }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
