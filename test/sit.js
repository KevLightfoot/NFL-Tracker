'use strict';
// Live football tracker: parsing ESPN's situation payloads (scoreboard + summary shapes) and what the games panel draws.
const assert = require('assert');
const Stats = require('../public/lib/stats.js');
const tests = [], test = function (n, f) { tests.push([n, f]); };
const G = function (o) { return Object.assign({ id: '1', league: 'cfb', state: 'in', away: { id: '10', abbr: 'MSST' }, home: { id: '20', abbr: 'TEX' }, detail: '4:58 - 1st', clock: '4:58' }, o || {}); };
const P = function (s, g, lg) { return Stats.parseSituation(s, g || G(), lg || 'cfb'); };

test('own territory, away team has the ball (attacks right)', function () {
  const t = P({ possession: '10', down: 2, distance: 7, possessionText: 'MSST 35', downDistanceText: '2nd & 7 at MSST 35', shortDownDistanceText: '2nd & 7', isRedZone: false });
  assert.strictEqual(t.poss, 'away'); assert.strictEqual(t.possAbbr, 'MSST'); assert.strictEqual(t.dd, '2nd & 7');
  assert.strictEqual(t.spot, 'MSST 35'); assert.strictEqual(t.x, 35); assert.strictEqual(t.toGoal, 65); assert.strictEqual(t.fd, 42); assert.strictEqual(t.red, false);
});
test("opponent territory: away has it at TEX 30 -> x=70, 30 to go, red zone only inside the 20", function () {
  const t = P({ possession: '10', down: 1, distance: 10, possessionText: 'TEX 30', shortDownDistanceText: '1st & 10' });
  assert.strictEqual(t.x, 70); assert.strictEqual(t.toGoal, 30); assert.strictEqual(t.fd, 80); assert.strictEqual(t.red, false);
  const r = P({ possession: '10', down: 1, distance: 10, possessionText: 'TEX 18', shortDownDistanceText: '1st & 10' });
  assert.strictEqual(r.red, true); assert.strictEqual(r.x, 82);
});
test('home team attacks left: ball on its own 25 is x=75, first down line is toward x=0', function () {
  const t = P({ possession: '20', down: 3, distance: 4, possessionText: 'TEX 25', shortDownDistanceText: '3rd & 4' });
  assert.strictEqual(t.poss, 'home'); assert.strictEqual(t.x, 75); assert.strictEqual(t.toGoal, 75); assert.strictEqual(t.fd, 71);
  const o = P({ possession: '20', down: 1, distance: 10, possessionText: 'MSST 40', shortDownDistanceText: '1st & 10' });
  assert.strictEqual(o.x, 40); assert.strictEqual(o.toGoal, 40); assert.strictEqual(o.fd, 30);
});
test('midfield and goal-to-go', function () {
  const m = P({ possession: '20', down: 2, distance: 5, possessionText: '50', shortDownDistanceText: '2nd & 5' });
  assert.strictEqual(m.x, 50); assert.strictEqual(m.spot, 'the 50'); assert.strictEqual(m.toGoal, 50);
  const g = P({ possession: '10', down: 1, distance: 8, possessionText: 'TEX 8', shortDownDistanceText: '1st & Goal', downDistanceText: '1st & Goal at TEX 8' });
  assert.strictEqual(g.goal, true); assert.strictEqual(g.dd, '1st & Goal'); assert.strictEqual(g.fd, null); assert.strictEqual(g.x, 92); assert.strictEqual(g.red, true);
});
test('first-down line that would pass the goal line is not drawn', function () {
  const t = P({ possession: '10', down: 3, distance: 12, possessionText: 'TEX 9', shortDownDistanceText: '3rd & 12' });
  assert.strictEqual(t.fd, null);
});
test('text-only payloads (no down/distance numbers) still parse', function () {
  const t = P({ possession: '10', possessionText: 'TEX 44', downDistanceText: '4th & 2 at TEX 44' });
  assert.strictEqual(t.down, 4); assert.strictEqual(t.dist, 2); assert.strictEqual(t.dd, '4th & 2'); assert.strictEqual(t.x, 56);
  const u = P({ possession: '10', downDistanceText: '3rd & 6 at TEX 44' });
  assert.strictEqual(u.x, 56, 'spot taken from "at TEX 44" when possessionText is missing');
});
test('kickoff / PAT / no down: no down text, ball spot still shown, nothing invented', function () {
  const k = P({ possession: '20', down: 0, possessionText: 'TEX 35', lastPlay: { text: 'Kickoff' } });
  assert.strictEqual(k.dd, ''); assert.strictEqual(k.down, 0); assert.strictEqual(k.x, 65);
  assert.strictEqual(P({}), null); assert.strictEqual(P(null), null); assert.strictEqual(P({ possession: '10' }), null);
  assert.strictEqual(P({ down: -1, possession: '10' }), null);
});
test('unknown possession team: shows down & spot but no ball owner, no drive arrow, no first-down line', function () {
  const t = P({ possession: '999', down: 2, distance: 3, possessionText: 'TEX 40', shortDownDistanceText: '2nd & 3' });
  assert.strictEqual(t.poss, null); assert.strictEqual(t.possAbbr, ''); assert.strictEqual(t.fd, null); assert.strictEqual(t.x, 60); assert.strictEqual(t.dd, '2nd & 3');
});
test('a yard line on neither team is ignored instead of guessed', function () {
  const t = P({ possession: '10', down: 1, distance: 10, possessionText: 'XYZ 20', shortDownDistanceText: '1st & 10' });
  assert.strictEqual(t.x, null); assert.strictEqual(t.dd, '1st & 10');
  const bad = P({ possession: '10', down: 1, distance: 10, possessionText: 'TEX 77', shortDownDistanceText: '1st & 10' });
  assert.strictEqual(bad.x, null);
});
test('numeric yardLine is only a fallback when ESPN sent no text at all', function () {
  const own = P({ possession: '10', down: 1, distance: 10, yardLine: 25 });
  assert.strictEqual(own.x, 25); assert.strictEqual(own.spot, 'MSST 25');
  const opp = P({ possession: '10', down: 1, distance: 10, yardLine: 71 });
  assert.strictEqual(opp.x, 71); assert.strictEqual(opp.spot, 'TEX 29');
  const txt = P({ possession: '10', down: 1, distance: 10, yardLine: 25, possessionText: 'TEX 30' });
  assert.strictEqual(txt.x, 70, 'text wins');
});
test('possession as an object or a number works; non-football leagues return null', function () {
  assert.strictEqual(P({ possession: { id: '10' }, down: 1, distance: 10, possessionText: 'MSST 20' }).poss, 'away');
  assert.strictEqual(P({ possession: 20, down: 1, distance: 10, possessionText: 'TEX 20' }).poss, 'home');
  assert.strictEqual(Stats.parseSituation({ possession: '10', down: 1, distance: 10, possessionText: 'MSST 20' }, G({ league: 'nba' }), 'nba'), null);
  assert.strictEqual(Stats.parseSituation({ down: 1 }, { league: 'nfl' }, 'nfl'), null);
});
test('scoreboard event: situation only attaches to games in progress', function () {
  const ev = function (state, sit) { return { id: '77', date: '2026-10-31T23:00Z', status: { type: { state: state, shortDetail: '4:58 - 1st' }, period: 1, displayClock: '4:58' },
    competitions: [{ situation: sit, competitors: [{ homeAway: 'away', team: { id: '10', abbreviation: 'MSST' }, score: '0' }, { homeAway: 'home', team: { id: '20', abbreviation: 'TEX' }, score: '7' }] }] }; };
  const sit = { possession: '20', down: 1, distance: 10, possessionText: 'TEX 25', shortDownDistanceText: '1st & 10', lastPlay: { text: 'Quinn Ewers pass complete for 12 yds' } };
  const live = Stats.normalizeEvent(ev('in', sit), 'cfb');
  assert.ok(live.sit); assert.strictEqual(live.sit.possAbbr, 'TEX'); assert.strictEqual(live.sit.x, 75); assert.ok(/Ewers/.test(live.sit.last));
  assert.strictEqual(Stats.normalizeEvent(ev('pre', sit), 'cfb').sit, undefined);
  assert.strictEqual(Stats.normalizeEvent(ev('post', sit), 'cfb').sit, undefined);
  assert.strictEqual(Stats.normalizeEvent(ev('in', undefined), 'cfb').sit, undefined);
  assert.strictEqual(Stats.normalizeEvent(ev('in', { garbage: true }), 'cfb').sit, undefined);
});
test('summary payload: reads situation from top level, the header competition, or the current drive', function () {
  const mk = function (extra, comp) { return Object.assign({ header: { id: '77', competitions: [Object.assign({ date: 'd', status: { type: { state: 'in', shortDetail: '4:58 - 1st' }, period: 1, displayClock: '4:58' },
    competitors: [{ homeAway: 'away', team: { id: '10', abbreviation: 'MSST' }, score: '0' }, { homeAway: 'home', team: { id: '20', abbreviation: 'TEX' }, score: '7' }] }, comp || {})] } }, extra); };
  const sit = { possession: '10', down: 2, distance: 6, possessionText: 'MSST 31', shortDownDistanceText: '2nd & 6' };
  assert.strictEqual(Stats.normalizeSummary(mk({ situation: sit }), '77', 'cfb').sit.x, 31);
  assert.strictEqual(Stats.normalizeSummary(mk({}, { situation: sit }), '77', 'cfb').sit.x, 31);
  const drive = { drives: { current: { team: { id: '20' }, plays: [{ text: 'old' }, { text: 'Run for 3', end: { down: 3, distance: 4, possessionText: 'MSST 48', shortDownDistanceText: '3rd & 4' } }] } } };
  const d = Stats.normalizeSummary(mk(drive), '77', 'cfb');
  assert.strictEqual(d.sit.possAbbr, 'TEX'); assert.strictEqual(d.sit.x, 48); assert.strictEqual(d.sit.last, 'Run for 3');
  assert.strictEqual(Stats.normalizeSummary(mk({}), '77', 'cfb').sit, undefined, 'no situation anywhere: nothing shown');
  const done = mk({ situation: sit }); done.header.competitions[0].status.type.state = 'post';
  assert.strictEqual(Stats.normalizeSummary(done, '77', 'cfb').sit, undefined);
});
test('NFL abbreviations that ESPN and the tracker spell differently still match', function () {
  const g = { id: '1', league: 'nfl', state: 'in', away: { id: '28', abbr: Stats.normalizeEvent({ id: '1', status: { type: { state: 'in' } }, competitions: [{ competitors: [{ homeAway: 'away', team: { id: '28', abbreviation: 'WSH' } }, { homeAway: 'home', team: { id: '9', abbreviation: 'GB' } }] }] }, 'nfl').away.abbr }, home: { id: '9', abbr: 'GB' } };
  const t = Stats.parseSituation({ possession: '28', down: 1, distance: 10, possessionText: 'WSH 20', shortDownDistanceText: '1st & 10' }, g, 'nfl');
  assert.ok(t && t.x === 20, JSON.stringify(t));
});

let pass = 0, fail = 0;
tests.forEach(function (t) { try { t[1](); pass++; console.log('  ✓ ' + t[0]); } catch (e) { fail++; console.log('  ✗ ' + t[0] + '\n      ' + (e && e.message)); } });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
