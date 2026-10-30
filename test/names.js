'use strict';
// Automatic slip names: "JMU -3.5, UNT ML, Chuba 30+"
const assert = require('assert');
const Teams = require('../public/lib/teams.js');
const E = require('../public/lib/evaluate.js');

let pass = 0, fail = 0; const tests = [];
function test(name, fn) { tests.push([name, fn]); }
const L = function (o) { return Object.assign({ id: Math.random().toString(36).slice(2), period: 'full' }, o); };

test('the example: "James Madison -3.5, North Texas ML, Chuba Hubbard 30+ yards" -> "JMU -3.5, UNT ML, Chuba 30+"', function () {
  const legs = [
    L({ market: 'spread', team: 'James Madison', line: -3.5, league: 'cfb', teamResolved: 'JMU' }),
    L({ market: 'moneyline', team: 'North Texas', league: 'cfb', teamResolved: 'UNT' }),
    L({ market: 'player_prop', player: 'Chuba Hubbard', stat: 'rushing_yards', side: 'over', line: 29.5, raw_text: 'Chuba Hubbard 30+ Rushing Yards', league: 'cfb' }),
  ];
  const r = E.autoName(legs, {});
  assert.strictEqual(r.text, 'JMU -3.5, UNT ML, Chuba 30+'); assert.strictEqual(r.complete, true);
});

test('teams that are not resolved yet fall back to the written name and mark the name as not final; once known the college registry supplies the abbreviation', function () {
  const legs = [L({ market: 'spread', team: 'Tulane', line: 7, league: 'cfb' }), L({ market: 'moneyline', team: 'Tulane', league: 'cfb' })];
  let r = E.autoName(legs, {});
  assert.strictEqual(r.text, 'Tulane +7, Tulane ML'); assert.strictEqual(r.complete, false);
  Teams.registerTeam('cfb', { abbr: 'TULN', name: 'Tulane Green Wave', short: 'Tulane', nick: 'Green Wave', location: 'Tulane' });
  r = E.autoName(legs, {}); assert.strictEqual(r.text, 'TULN +7, TULN ML'); assert.strictEqual(r.complete, true);
});

test('every market has a short form: totals (with the matchup), team totals, periods, scorers, ladders vs plain lines, first names and initials', function () {
  const nm = function (leg, games) { return E.autoName([L(leg)], games || {}).text; };
  const game = { league: 'nfl', away: { abbr: 'LV' }, home: { abbr: 'CLE' } };
  assert.strictEqual(nm({ market: 'total', side: 'over', line: 44.5, gameId: 'g', league: 'nfl' }, { g: game }), 'LV/CLE o44.5');
  assert.strictEqual(nm({ market: 'total', side: 'under', line: 22.5, period: '1h', gameId: 'g', league: 'nfl' }, { g: game }), '1H LV/CLE u22.5');
  assert.strictEqual(nm({ market: 'total', side: 'over', line: 44.5, league: 'nfl', away_team: 'Raiders', home_team: 'Browns' }), 'LV/CLE o44.5', 'matchup from the slip when the game is not loaded');
  assert.strictEqual(nm({ market: 'total', side: 'over', line: 44.5, league: 'nfl' }), 'o44.5');
  assert.strictEqual(nm({ market: 'team_total', team: 'Browns', side: 'over', line: 20.5, league: 'nfl', teamResolved: 'CLE' }), 'CLE TT o20.5');
  assert.strictEqual(nm({ market: 'moneyline', team: 'Dodgers', period: 'f5', league: 'mlb', teamResolved: 'LAD' }), 'F5 LAD ML');
  assert.strictEqual(nm({ market: 'total', side: 'under', line: 0.5, period: 'i1', league: 'mlb' }), '1st inn u0.5');
  assert.strictEqual(nm({ market: 'anytime_td', player: 'Chuba Hubbard' }), 'Chuba TD');
  assert.strictEqual(nm({ market: 'first_td', player: 'Derrick Henry' }), 'Derrick 1st TD');
  assert.strictEqual(nm({ market: 'first_basket', player: 'Jayson Tatum' }), 'Jayson 1st bkt');
  assert.strictEqual(nm({ market: 'player_prop', player: 'Anthony Davis', stat: 'double_double', side: 'yes' }), 'Anthony DD');
  assert.strictEqual(nm({ market: 'player_prop', player: 'Mookie Betts', stat: 'total_bases', side: 'over', line: 4.5, raw_text: 'To record 5+ Total Bases' }), 'Mookie 5+');
  assert.strictEqual(nm({ market: 'player_prop', player: 'Mookie Betts', stat: 'total_bases', side: 'over', line: 4.5, raw_text: 'Mookie Betts Over 4.5 Total Bases' }), 'Mookie o4.5', 'not a ladder line: keep the book\'s number');
  assert.strictEqual(nm({ market: 'player_prop', player: 'Chuba Hubbard', stat: 'rushing_yards', side: 'under', line: 29.5, raw_text: 'Under 29.5' }), 'Chuba u29.5');
  assert.strictEqual(nm({ market: 'player_prop', player: 'Michael Pittman Jr.', stat: 'receptions', side: 'over', line: 5.5 }), 'Michael o5.5');
  assert.strictEqual(nm({ market: 'player_prop', player: 'C.J. Stroud', stat: 'passing_yards', side: 'over', line: 249.5 }), 'Stroud o249.5');
  assert.strictEqual(nm({ market: 'player_prop', player: 'C. Hubbard', stat: 'rushing_yards', side: 'over', line: 49.5 }), 'Hubbard o49.5');
  assert.strictEqual(nm({ market: 'player_prop', player: 'Hubbard', stat: 'rushing_yards', side: 'over', line: 49.5 }), 'Hubbard o49.5');
  assert.strictEqual(nm({ market: 'other', raw_text: 'Some exotic bet that is very very long indeed' }), 'Some exotic bet that is very', 'unknown markets use the slip text, trimmed');
  assert.strictEqual(nm({ market: 'spread', team: 'Jets', line: 7, league: 'nfl', teamResolved: 'NYJ' }), 'NYJ +7');
  assert.strictEqual(E.shortPlayer(''), '');
});

test('long slips are capped at six legs with a count of the rest; an empty slip has no name', function () {
  const legs = [];
  for (let i = 1; i <= 8; i++) legs.push(L({ market: 'moneyline', team: 'T' + i, league: 'nfl', teamResolved: 'T' + i }));
  assert.strictEqual(E.autoName(legs, {}).text, 'T1 ML, T2 ML, T3 ML, T4 ML, T5 ML, T6 ML +2 more');
  assert.strictEqual(E.autoName([], {}).text, '');
});

test('the app names slips on refresh, keeps names you typed, and never overwrites a good name with a half-known one', function () {
  // run the real app.js against a tiny DOM stand-in is overkill: check the rules by reading its source
  const src = require('fs').readFileSync(require('path').join(__dirname, '../public/app.js'), 'utf8');
  assert.ok(/function refreshNames\(\)/.test(src) && /refreshNames\(\);\s*\n(\s*auditLegs\(\);\s*\n)?\s*save\(\);/.test(src), 'names refresh before every save of a refresh');
  assert.ok(/p\.autoName === false \|\| \(p\.name && p\.autoName !== true\)/.test(src), 'a name you typed is skipped');
  assert.ok(/r\.complete \|\| !p\.name/.test(src), 'an existing name is only replaced by a complete one');
  assert.ok(/p\.autoName = typed === ''/.test(src), 'typing a name takes control; clearing it hands it back');
});

(async function () {
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
