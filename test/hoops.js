'use strict';
// NBA + MLB support: team matching, box scores, every market type, live clocks, league-aware server lookups and push notifications.
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const Teams = require('../public/lib/teams.js');
const Stats = require('../public/lib/stats.js');
const E = require('../public/lib/evaluate.js');
const N = require('../notify.js');

let pass = 0, fail = 0; const tests = [];
function test(name, fn) { tests.push([name, fn]); }

/* ---------------- ESPN-shaped fixtures ---------------- */
const tm = function (id, abbr, name) { return { id: String(id), abbreviation: abbr, displayName: name }; };
function header(o, away, home) {
  const ls = function (a) { return (a || []).map(function (v) { return { displayValue: String(v) }; }); };
  return {
    id: String(o.id),
    competitions: [{
      date: o.date || '2026-10-28T23:00Z',
      status: { period: o.period || 0, displayClock: o.clock || '0:00', type: { state: o.state, completed: o.state === 'post' && !/postponed/i.test(o.detail || ''), shortDetail: o.detail || (o.state === 'post' ? 'Final' : 'x') } },
      competitors: [
        { homeAway: 'home', team: home, score: String(o.homeScore || 0), linescores: ls(o.homeLs) },
        { homeAway: 'away', team: away, score: String(o.awayScore || 0), linescores: ls(o.awayLs) },
      ],
    }],
  };
}
const athletes = function (rows) { return rows.map(function (r) { return Object.assign({ athlete: { id: r[0], displayName: r[1] }, stats: r[2] }, r[3] || {}); }); };

/* ---- NBA: Lakers @ Celtics, 5:12 left in the 3rd, LAL 78 - BOS 85 ---- */
const LAL = tm(13, 'LAL', 'Los Angeles Lakers'), BOS = tm(2, 'BOS', 'Boston Celtics');
const NBA_LABELS = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-'];
function nbaSummary(o) {
  o = o || {};
  return {
    header: header(Object.assign({ id: 5001, state: 'in', period: 3, clock: '5:12', detail: '5:12 - 3rd', awayScore: 78, homeScore: 85, awayLs: [25, 22, 31], homeLs: [30, 25, 30] }, o), LAL, BOS),
    boxscore: { players: [
      { team: LAL, statistics: [{ labels: NBA_LABELS, athletes: athletes([
        ['1', 'LeBron James', ['28', '24', '9-17', '2-5', '4-5', '7', '9', '3', '1', '0', '1', '6', '2', '-5']],
        ['2', 'Anthony Davis', ['30', '22', '8-14', '0-0', '6-8', '11', '2', '1', '1', '3', '3', '8', '3', '-7']],
        ['3', 'Bench Guy', [], { didNotPlay: true }],
      ]) }] },
      { team: BOS, statistics: [{ labels: NBA_LABELS, athletes: athletes([
        ['4', 'Jayson Tatum', ['31', '30', '10-19', '4-9', '6-6', '8', '5', '2', '2', '1', '1', '7', '1', '+9']],
        ['5', 'Jaylen Brown', ['29', '17', '6-13', '1-4', '4-4', '4', '3', '1', '0', '0', '0', '4', '2', '+6']],
      ]) }] },
    ] },
    plays: [
      { id: '1', scoringPlay: true, text: 'Anthony Davis makes free throw 1 of 2', type: { text: 'Free Throw' }, team: { id: '13' }, period: { number: 1 }, clock: { displayValue: '11:40' }, awayScore: 1, homeScore: 0 },
      { id: '2', scoringPlay: true, text: 'Jayson Tatum makes 26-foot three point jumper (Jrue Holiday assists)', type: { text: 'Jump Shot' }, team: { id: '2' }, period: { number: 1 }, clock: { displayValue: '11:20' }, awayScore: 1, homeScore: 3 },
      { id: '3', scoringPlay: false, text: 'LeBron James misses 12-foot jumper', type: { text: 'Jump Shot' } },
    ],
  };
}

/* ---- MLB: Dodgers @ Yankees, top of the 6th, LAD 3 - NYY 2 ---- */
const LAD = tm(19, 'LAD', 'Los Angeles Dodgers'), NYY = tm(10, 'NYY', 'New York Yankees');
const BAT = ['H-AB', 'AB', 'R', 'H', 'RBI', 'HR', 'BB', 'K', '#P', 'AVG', 'OBP', 'SLG'], PIT = ['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'PC-ST', 'ERA', 'PC'];
function mlbSummary(o, withPlays) {
  o = o || {};
  const s = {
    header: header(Object.assign({ id: 6001, state: 'in', period: 6, detail: 'Top 6th', awayScore: 3, homeScore: 2, awayLs: [0, 1, 0, 2, 0], homeLs: [0, 0, 2, 0, 0] }, o), LAD, NYY),
    boxscore: { players: [
      { team: LAD, statistics: [
        { type: 'batting', labels: BAT, athletes: athletes([
          ['b1', 'Mookie Betts', ['2-4', '4', '1', '2', '1', '1', '0', '1', '17', '.300', '.380', '.520']],
          ['b2', 'Freddie Freeman', ['1-3', '3', '0', '1', '0', '0', '1', '0', '14', '.310', '.400', '.510']],
          ['b3', 'Teoscar Hernandez', ['1-4', '4', '0', '1', '1', '0', '0', '2', '15', '.250', '.300', '.450']],
        ]) },
        { type: 'pitching', labels: PIT, athletes: athletes([['p1', 'Yoshinobu Yamamoto', ['5.1', '4', '2', '2', '1', '7', '1', '88-58', '3.20', '88']]]) },
      ] },
      { team: NYY, statistics: [
        { type: 'batting', labels: BAT, athletes: athletes([['b4', 'Aaron Judge', ['1-3', '3', '1', '1', '2', '1', '0', '2', '14', '.290', '.400', '.600']]]) },
        { type: 'pitching', labels: PIT, athletes: athletes([['p2', 'Gerrit Cole', ['5.0', '3', '3', '3', '2', '6', '1', '90-60', '4.10', '90']]]) },
      ] },
    ] },
  };
  // ESPN lists every hit twice: a pitch-level play (typed, with the batter attached) and a "Play Result" sentence that uses last names
  if (withPlays !== false) s.plays = [
    { id: 'n1', type: { text: 'Ball' }, text: 'Pitch 1 : Ball 1' },
    { id: 'a1', type: { text: 'Home Run' }, text: 'Pitch 3 : Ball In Play', participants: [{ athlete: { id: 'b1' }, type: 'batter' }, { athlete: { id: 'p2' }, type: 'pitcher' }] },
    { id: 'a2', type: { text: 'Play Result' }, text: 'Betts homered to left (400 feet).' },
    { id: 'b1', type: { text: 'Single' }, text: 'Pitch 2 : Ball In Play', participants: [{ athlete: { id: 'b1' }, type: 'batter' }, { athlete: { id: 'p2' }, type: 'pitcher' }] },
    { id: 'b2', type: { text: 'Play Result' }, text: 'Betts singled to center.' },
    { id: 'c1', type: { text: 'Double' }, text: 'Pitch 4 : Ball In Play' },                               // no batter attached: the sentence below supplies it
    { id: 'c2', type: { text: 'Play Result' }, text: 'Freeman doubled to right, Betts to third.' },
    { id: 'd1', type: { text: 'Home Run' }, text: 'Pitch 1 : Ball In Play', participants: [{ athlete: { id: 'b4' }, type: 'batter' }] },
    { id: 'd2', type: { text: 'Play Result' }, text: 'Judge homered to center, Volpe scored.' },
    { id: 'e1', type: { text: 'Stolen Base' }, text: 'Betts stole second.' },
    { id: 'e2', type: { text: 'Play Result' }, text: 'Betts stole second.' },
    { id: 'e2', type: { text: 'Play Result' }, text: 'Betts stole second.' },                              // same id twice: ignored
    { id: 'g1', type: { text: 'Caught Stealing' }, text: 'Freeman caught stealing second, catcher to second.' },
    { id: 'g2', type: { text: 'Play Result' }, text: 'Freeman caught stealing second.' },
    { id: 'h1', type: { text: 'Double' }, text: 'Pitch 2 : Ball In Play', participants: [{ athlete: { id: 'b4' }, type: 'batter' }] },   // an extra typed double for Judge that his box score doesn't have
    { id: 'f', type: { text: 'Play Result' }, text: 'Hernandez struck out swinging.' },
  ];
  return s;
}

const nba = function (o) { return Stats.normalizeSummary(nbaSummary(o), '5001', 'nba'); };
const mlb = function (o, wp) { return Stats.normalizeSummary(mlbSummary(o, wp), '6001', 'mlb'); };
const leg = function (o) { return Object.assign({ id: 'x', period: 'full', manual: null, manualValue: null }, o); };
const ev = function (l, g) { return E.evaluateLeg(leg(l), g); };

/* ---------------- teams ---------------- */
test('NBA and MLB team names, nicknames, cities and abbreviations all match; football lookups are unchanged', function () {
  const nbaCases = { 'Lakers': 'LAL', 'LA Lakers': 'LAL', 'Los Angeles Clippers': 'LAC', 'Warriors': 'GS', 'GSW': 'GS', 'Knicks': 'NY', 'New York': 'NY', '76ers': 'PHI',
    'Trail Blazers +3.5': 'POR', 'Celtics': 'BOS', 'Boston': 'BOS', 'Jazz': 'UTAH', 'Thunder': 'OKC', 'Wizards': 'WSH', 'San Antonio': 'SA', 'Cavs': 'CLE', 'Timberwolves': 'MIN' };
  Object.keys(nbaCases).forEach(function (k) { assert.strictEqual(Teams.matchTeam(k, 'nba'), nbaCases[k], 'nba ' + k); });
  const mlbCases = { 'Yankees': 'NYY', 'NY Mets': 'NYM', 'Red Sox ML': 'BOS', 'White Sox': 'CHW', 'Chicago Cubs': 'CHC', 'A\'s': 'ATH', 'Athletics': 'ATH', 'St. Louis Cardinals': 'STL',
    'Cardinals': 'STL', 'Giants': 'SF', 'Blue Jays -1.5': 'TOR', 'Diamondbacks': 'ARI', 'AZ': 'ARI', 'Padres': 'SD', 'Dodgers': 'LAD', 'Angels': 'LAA', 'Nationals': 'WSH', 'Guardians': 'CLE' };
  Object.keys(mlbCases).forEach(function (k) { assert.strictEqual(Teams.matchTeam(k, 'mlb'), mlbCases[k], 'mlb ' + k); });
  assert.strictEqual(Teams.matchTeam('Cardinals', 'nfl'), 'ARI');                  // same word, different league
  assert.strictEqual(Teams.matchTeam('Giants', 'nfl'), 'NYG');
  assert.strictEqual(Teams.matchTeam('NY'), null);                                  // no league: still football only, still ambiguous
  assert.strictEqual(Teams.matchTeam('Lakers'), null, 'NBA / MLB names need an explicit league');
  assert.strictEqual(Teams.matchTeam('Sox', 'mlb'), null, 'ambiguous: Red Sox or White Sox');
  assert.strictEqual(Teams.name('LAL', 'nba'), 'Lakers'); assert.strictEqual(Teams.name('NYY', 'mlb'), 'Yankees'); assert.strictEqual(Teams.name('NYG', 'nfl'), 'Giants');
});

test('ESPN abbreviations are normalised so the slip and the game always agree (GSW/GS, WAS/WSH); an unknown team registers itself', function () {
  const ev1 = { id: '1', date: '2026-10-28T23:00Z', status: { period: 0, type: { state: 'pre' } }, competitions: [{ competitors: [
    { homeAway: 'away', team: { id: '9', abbreviation: 'GSW', displayName: 'Golden State Warriors' }, score: '0' }, { homeAway: 'home', team: { id: '27', abbreviation: 'WAS', displayName: 'Washington Wizards' }, score: '0' }] }] };
  const g = Stats.normalizeEvent(ev1, 'nba');
  assert.strictEqual(g.away.abbr, 'GS'); assert.strictEqual(g.home.abbr, 'WSH'); assert.strictEqual(g.league, 'nba');
  assert.strictEqual(Teams.matchTeam('Warriors', 'nba'), g.away.abbr);
  const expansion = { id: '2', date: '2026-10-28T23:00Z', status: { period: 0, type: { state: 'pre' } }, competitions: [{ competitors: [
    { homeAway: 'away', team: { id: '99', abbreviation: 'SEA', displayName: 'Seattle SuperSonics', name: 'SuperSonics', location: 'Seattle', shortDisplayName: 'SuperSonics' }, score: '0' },
    { homeAway: 'home', team: { id: '27', abbreviation: 'WAS', displayName: 'Washington Wizards' }, score: '0' }] }] };
  const g2 = Stats.normalizeEvent(expansion, 'nba');
  assert.strictEqual(Teams.matchTeam('SuperSonics', 'nba'), 'SEA'); assert.strictEqual(g2.away.abbr, 'SEA');
});

/* ---------------- NBA ---------------- */
test('NBA box score: labels parse, made-attempted splits, DNP players are skipped, props compute', function () {
  const g = nba();
  assert.strictEqual(g.league, 'nba'); assert.strictEqual(g.players.length, 4, 'the DNP player is left out');
  const v = function (name, stat, opts) { const r = Stats.statValue(g, name, stat, opts); assert.strictEqual(r.status, 'ok', name + ' ' + stat); return r.value; };
  assert.strictEqual(v('LeBron James', 'points'), 24); assert.strictEqual(v('LeBron James', 'rebounds'), 7); assert.strictEqual(v('LeBron James', 'assists'), 9);
  assert.strictEqual(v('LeBron James', 'three_pointers_made'), 2); assert.strictEqual(v('LeBron James', 'three_pointers_attempted'), 5);
  assert.strictEqual(v('LeBron James', 'field_goals_made'), 9); assert.strictEqual(v('LeBron James', 'free_throws_attempted'), 5);
  assert.strictEqual(v('LeBron James', 'pts_reb_ast'), 40); assert.strictEqual(v('LeBron James', 'pts_ast'), 33); assert.strictEqual(v('LeBron James', 'reb_ast'), 16);
  assert.strictEqual(v('Anthony Davis', 'steals_blocks'), 4); assert.strictEqual(v('Anthony Davis', 'double_double'), 1); assert.strictEqual(v('Anthony Davis', 'triple_double'), 0);
  assert.strictEqual(v('LeBron James', 'double_double'), 0);
  assert.strictEqual(v('L. James', 'points'), 24, 'initial + last name');
  assert.strictEqual(v('Tatum', 'points'), 30, 'last name only');
  assert.strictEqual(v('LeBron James', 'fantasy_points', { fantasy: 'fd' }), 45.9);
  assert.strictEqual(v('LeBron James', 'fantasy_points', { fantasy: 'dk' }), 47.75);
  assert.strictEqual(v('LeBron James', 'fantasy_points'), 45.9, 'default scoring is the FanDuel / PrizePicks style');
  assert.strictEqual(Stats.statValue(g, 'Bench Guy', 'points').status, 'noplayer');
  assert.strictEqual(Stats.statValue(g, 'LeBron James', 'passing_yards').status, 'unsupported', 'football stat on a basketball game');
  assert.ok(/24 pts, 7 reb, 9 ast/.test(Stats.statLine(g.players[0])), Stats.statLine(g.players[0]));
});

test('NBA game markets: moneyline, spread, totals, team totals, halves and quarters, with the 12-minute clock', function () {
  const g = nba();
  let r = ev({ market: 'moneyline', team: 'Lakers', league: 'nba' }, g);
  assert.strictEqual(r.state, 'live'); assert.strictEqual(r.onTrack, false); assert.strictEqual(r.title, 'Lakers ML'); assert.ok(/trailing by 7/.test(r.detail), r.detail);
  r = ev({ market: 'moneyline', team: 'Boston Celtics', league: 'nba' }, g); assert.strictEqual(r.onTrack, true); assert.ok(/leading by 7/.test(r.detail));
  r = ev({ market: 'spread', team: 'Celtics', line: -6.5, league: 'nba' }, g); assert.strictEqual(r.onTrack, true); assert.ok(/Covering by 0\.5/.test(r.detail), r.detail);
  r = ev({ market: 'spread', team: 'Lakers', line: 7.5, league: 'nba' }, g); assert.strictEqual(r.onTrack, true); assert.strictEqual(r.title, 'Lakers +7.5');
  r = ev({ market: 'total', side: 'over', line: 200.5, league: 'nba' }, g);
  assert.strictEqual(r.state, 'live'); assert.strictEqual(r.current, 163); assert.ok(/Needs 38 more pts/.test(r.detail), r.detail);
  assert.ok(/pace 254/.test(r.detail), 'pace uses 12-minute quarters: ' + r.detail);
  r = ev({ market: 'total', side: 'over', line: 160.5, league: 'nba' }, g); assert.strictEqual(r.state, 'hit');
  r = ev({ market: 'total', side: 'under', line: 160.5, league: 'nba' }, g); assert.strictEqual(r.state, 'miss');
  r = ev({ market: 'team_total', team: 'Celtics', side: 'over', line: 100.5, league: 'nba' }, g); assert.strictEqual(r.current, 85); assert.strictEqual(r.state, 'live');
  r = ev({ market: 'total', side: 'over', line: 100.5, period: '1h', league: 'nba' }, g); assert.strictEqual(r.current, 102); assert.strictEqual(r.state, 'hit');
  r = ev({ market: 'total', side: 'under', line: 110.5, period: '1h', league: 'nba' }, g); assert.strictEqual(r.state, 'hit', '1st half is over (we are in the 3rd): an under that held is settled');
  r = ev({ market: 'moneyline', team: 'Lakers', period: 'q1', league: 'nba' }, g); assert.strictEqual(r.state, 'miss', '1st quarter went 25-30');
  r = ev({ market: 'spread', team: 'Lakers', line: 0.5, period: 'q2', league: 'nba' }, g); assert.strictEqual(r.state, 'miss', 'Q2 25-22 for Boston? LAL 22, BOS 25 -> LAL +0.5 loses by 2.5');
  r = ev({ market: 'moneyline', team: 'Lakers', period: 'q3', league: 'nba' }, g); assert.strictEqual(r.state, 'live', '3rd quarter is still being played');
  // final + overtime
  const fin = nba({ state: 'post', period: 5, clock: '0:00', detail: 'Final/OT', awayScore: 120, homeScore: 118, awayLs: [25, 22, 31, 30, 12], homeLs: [30, 25, 30, 21, 12] });
  r = ev({ market: 'moneyline', team: 'Lakers', league: 'nba' }, fin); assert.strictEqual(r.state, 'hit');
  r = ev({ market: 'total', side: 'over', line: 237.5, league: 'nba' }, fin); assert.strictEqual(r.state, 'hit', 'overtime counts toward the total (238)');
});

test('NBA props through the evaluator: over / under / ladder / double-double / fantasy', function () {
  const g = nba();
  let r = ev({ market: 'player_prop', player: 'LeBron James', stat: 'points', side: 'over', line: 23.5, league: 'nba' }, g);
  assert.strictEqual(r.state, 'hit'); assert.strictEqual(r.title, 'LeBron James Over 23.5 Points');
  r = ev({ market: 'player_prop', player: 'Jayson Tatum', stat: 'pts_reb_ast', side: 'over', line: 45.5, league: 'nba' }, g);
  assert.strictEqual(r.state, 'live'); assert.strictEqual(r.current, 43); assert.ok(/3 to go/.test(r.detail), r.detail); assert.ok(/pace/.test(r.detail), 'basketball props show a pace: ' + r.detail);
  r = ev({ market: 'player_prop', player: 'LeBron James', stat: 'rebounds', side: 'under', line: 9.5, league: 'nba' }, g); assert.strictEqual(r.state, 'live'); assert.strictEqual(r.onTrack, true);
  r = ev({ market: 'player_prop', player: 'LeBron James', stat: 'rebounds', side: 'under', line: 6.5, league: 'nba' }, g); assert.strictEqual(r.state, 'miss');
  r = ev({ market: 'player_prop', player: 'Anthony Davis', stat: 'double_double', side: 'yes', league: 'nba' }, g); assert.strictEqual(r.state, 'hit'); assert.ok(/Double-Double/.test(r.title));
  r = ev({ market: 'player_prop', player: 'LeBron James', stat: 'double_double', side: 'yes', league: 'nba' }, g); assert.strictEqual(r.state, 'live');
  r = ev({ market: 'player_prop', player: 'LeBron James', stat: 'fantasy_points', side: 'over', line: 45.5, fantasy_system: 'fd', league: 'nba' }, g); assert.strictEqual(r.state, 'hit');
  r = ev({ market: 'player_prop', player: 'LeBron James', stat: 'hits', side: 'over', line: 0.5, league: 'nba' }, g); assert.strictEqual(r.state, 'unresolved', 'a baseball stat on a basketball game asks for manual entry');
  r = ev({ market: 'player_prop', player: 'Bench Guy', stat: 'points', side: 'over', line: 2.5, league: 'nba' }, g); assert.ok(/Not in the box score/.test(r.detail), r.detail);
});

test('NBA first basket: the first made field goal, free throws ignored', function () {
  const g = nba();
  let r = ev({ market: 'first_basket', player: 'Jayson Tatum', league: 'nba' }, g); assert.strictEqual(r.state, 'hit'); assert.ok(/First basket: Jayson Tatum makes 26-foot/.test(r.detail), r.detail);
  assert.strictEqual(r.title, 'Jayson Tatum First Basket');
  r = ev({ market: 'first_basket', player: 'Anthony Davis', league: 'nba' }, g); assert.strictEqual(r.state, 'miss', 'his free throw is not a basket');
  r = ev({ market: 'first_basket', player: 'Tatum', league: 'nba' }, g); assert.strictEqual(r.state, 'hit', 'last name only');
  const early = nba({ state: 'in', period: 1, clock: '11:59', awayLs: [0], homeLs: [0], awayScore: 0, homeScore: 0 }); early.scoringPlays = [];
  r = ev({ market: 'first_basket', player: 'Tatum', league: 'nba' }, early); assert.strictEqual(r.state, 'live'); assert.ok(/No basket yet/.test(r.detail));
  const pre = nba({ state: 'pre', period: 0, awayLs: [], homeLs: [], awayScore: 0, homeScore: 0 }); pre.scoringPlays = [];
  r = ev({ market: 'first_basket', player: 'Tatum', league: 'nba' }, pre); assert.strictEqual(r.state, 'pending');
  assert.strictEqual(g.scoringPlays.length, 2, 'only scoring plays are kept');
});

/* ---------------- MLB ---------------- */
test('MLB box score: hitters, pitchers, innings pitched as outs, and play-by-play derived hit types', function () {
  const g = mlb();
  assert.strictEqual(g.league, 'mlb'); assert.strictEqual(g.hasPlays, true);
  const v = function (name, stat) { const r = Stats.statValue(g, name, stat); assert.strictEqual(r.status, 'ok', name + ' ' + stat + ' ' + r.status); return r.value; };
  assert.strictEqual(v('Mookie Betts', 'hits'), 2); assert.strictEqual(v('Mookie Betts', 'home_runs'), 1); assert.strictEqual(v('Mookie Betts', 'rbis'), 1);
  assert.strictEqual(v('Mookie Betts', 'runs'), 1); assert.strictEqual(v('Mookie Betts', 'at_bats'), 4); assert.strictEqual(v('Mookie Betts', 'batter_strikeouts'), 1);
  assert.strictEqual(v('Mookie Betts', 'hits_runs_rbis'), 4);
  assert.strictEqual(v('Mookie Betts', 'singles'), 1); assert.strictEqual(v('Mookie Betts', 'doubles'), 0); assert.strictEqual(v('Mookie Betts', 'total_bases'), 5, '1 single + 1 homer');
  assert.strictEqual(v('Mookie Betts', 'stolen_bases'), 1, 'counted once even though the play appears twice');
  assert.strictEqual(v('Freddie Freeman', 'doubles'), 1); assert.strictEqual(v('Freddie Freeman', 'total_bases'), 2); assert.strictEqual(v('Freddie Freeman', 'walks'), 1);
  assert.strictEqual(v('Aaron Judge', 'total_bases'), 4); assert.strictEqual(v('Aaron Judge', 'home_runs'), 1);
  assert.strictEqual(v('Yoshinobu Yamamoto', 'pitcher_strikeouts'), 7); assert.strictEqual(v('Yoshinobu Yamamoto', 'pitching_outs'), 16, '5.1 IP = 16 outs');
  assert.strictEqual(v('Yoshinobu Yamamoto', 'earned_runs'), 2); assert.strictEqual(v('Yoshinobu Yamamoto', 'hits_allowed'), 4); assert.strictEqual(v('Yoshinobu Yamamoto', 'walks_allowed'), 1);
  assert.strictEqual(v('Yoshinobu Yamamoto', 'pitches_thrown'), 88); assert.strictEqual(v('Gerrit Cole', 'pitching_outs'), 15);
  // a hit the play-by-play can't explain -> manual entry instead of a wrong number
  assert.strictEqual(Stats.statValue(g, 'Teoscar Hernandez', 'total_bases').status, 'unsupported');
  assert.strictEqual(Stats.statValue(g, 'Teoscar Hernandez', 'hits').value, 1, 'plain hits still work');
  assert.strictEqual(Stats.statValue(g, 'Mookie Betts', 'fantasy_points').status, 'unsupported');
  const noPlays = mlb({}, false);
  assert.strictEqual(noPlays.hasPlays, false);
  assert.strictEqual(Stats.statValue(noPlays, 'Mookie Betts', 'singles').status, 'unsupported'); assert.strictEqual(Stats.statValue(noPlays, 'Mookie Betts', 'hits').value, 2);
  assert.strictEqual(Stats.statValue(noPlays, 'Mookie Betts', 'stolen_bases').status, 'unsupported');
  assert.ok(/2-for-4, 1 R, 1 HR, 1 RBI/.test(Stats.statLine(g.players[0])), Stats.statLine(g.players[0]));
  assert.ok(/5\.1 IP, 4 H, 2 ER, 7 K/.test(Stats.statLine(g.players.find(function (p) { return p.name === 'Yoshinobu Yamamoto'; }))));
});

test('MLB game markets: moneyline, run line, totals, first 5 innings, first inning (NRFI / YRFI), innings clock', function () {
  const g = mlb();
  let r = ev({ market: 'moneyline', team: 'Dodgers', league: 'mlb' }, g); assert.strictEqual(r.state, 'live'); assert.strictEqual(r.onTrack, true); assert.ok(/leading by 1/.test(r.detail), r.detail);
  r = ev({ market: 'moneyline', team: 'Yankees', league: 'mlb' }, g); assert.strictEqual(r.onTrack, false);
  r = ev({ market: 'spread', team: 'Yankees', line: 1.5, league: 'mlb' }, g); assert.strictEqual(r.onTrack, true); assert.strictEqual(r.title, 'Yankees +1.5');
  r = ev({ market: 'spread', team: 'Dodgers', line: -1.5, league: 'mlb' }, g); assert.strictEqual(r.onTrack, false); assert.ok(/Needs 0\.5 more to cover/.test(r.detail), r.detail);
  r = ev({ market: 'total', side: 'over', line: 6.5, league: 'mlb' }, g); assert.strictEqual(r.state, 'live'); assert.ok(/Needs 2 more pts/.test(r.detail), r.detail); assert.ok(/pace 8\.6/.test(r.detail), r.detail);
  r = ev({ market: 'total', side: 'over', line: 4.5, league: 'mlb' }, g); assert.strictEqual(r.state, 'hit');
  // first five innings: five innings are in the books during the top of the 6th
  r = ev({ market: 'moneyline', team: 'Dodgers', period: 'f5', league: 'mlb' }, g); assert.strictEqual(r.state, 'hit'); assert.ok(/^F5 /.test(r.title) || /F5/.test(r.title), r.title);
  r = ev({ market: 'total', side: 'under', line: 5.5, period: 'f5', league: 'mlb' }, g); assert.strictEqual(r.state, 'hit'); assert.strictEqual(r.current, 5, 'F5 total is 3 + 2');
  r = ev({ market: 'total', side: 'under', line: 4.5, period: 'f5', league: 'mlb' }, g); assert.strictEqual(r.state, 'miss');
  r = ev({ market: 'spread', team: 'Yankees', line: 0.5, period: 'f5', league: 'mlb' }, g); assert.strictEqual(r.state, 'miss', 'LAD led 3-2 after five: Yankees +0.5 loses by 0.5');
  const mid4 = mlb({ period: 4, detail: 'Mid 4th', awayScore: 1, homeScore: 2, awayLs: [0, 1, 0], homeLs: [0, 0, 2] });
  r = ev({ market: 'moneyline', team: 'Dodgers', period: 'f5', league: 'mlb' }, mid4); assert.strictEqual(r.state, 'live', 'only 3 innings done: F5 is still open');
  r = ev({ market: 'moneyline', team: 'Dodgers', league: 'mlb' }, mid4); assert.strictEqual(r.state, 'live');
  // first inning: NRFI = under 0.5, YRFI = over 0.5
  r = ev({ market: 'total', side: 'under', line: 0.5, period: 'i1', league: 'mlb' }, g); assert.strictEqual(r.state, 'hit', 'scoreless first inning'); assert.ok(/1st Inning/.test(r.title));
  r = ev({ market: 'total', side: 'over', line: 0.5, period: 'i1', league: 'mlb' }, g); assert.strictEqual(r.state, 'miss');
  const runFirst = mlb({ period: 1, detail: 'Top 1st', awayScore: 1, homeScore: 0, awayLs: [1], homeLs: [] });
  r = ev({ market: 'total', side: 'over', line: 0.5, period: 'i1', league: 'mlb' }, runFirst); assert.strictEqual(r.state, 'hit', 'a run in the top of the 1st settles YRFI at once');
  r = ev({ market: 'total', side: 'under', line: 0.5, period: 'i1', league: 'mlb' }, runFirst); assert.strictEqual(r.state, 'miss');
  const midFirst = mlb({ period: 1, detail: 'Mid 1st', awayScore: 0, homeScore: 0, awayLs: [0], homeLs: [] });
  r = ev({ market: 'total', side: 'under', line: 0.5, period: 'i1', league: 'mlb' }, midFirst); assert.strictEqual(r.state, 'live', 'bottom of the 1st still to come');
  const endFirst = mlb({ period: 1, detail: 'End 1st', awayScore: 0, homeScore: 0, awayLs: [0], homeLs: [0] });
  r = ev({ market: 'total', side: 'under', line: 0.5, period: 'i1', league: 'mlb' }, endFirst); assert.strictEqual(r.state, 'hit', 'both halves done, nobody scored');
  // final
  const fin = mlb({ state: 'post', period: 9, detail: 'Final', awayScore: 5, homeScore: 4, awayLs: [0, 1, 0, 2, 0, 1, 0, 1, 0], homeLs: [0, 0, 2, 0, 0, 1, 1, 0, 0] });
  r = ev({ market: 'moneyline', team: 'Dodgers', league: 'mlb' }, fin); assert.strictEqual(r.state, 'hit');
  r = ev({ market: 'total', side: 'over', line: 8.5, league: 'mlb' }, fin); assert.strictEqual(r.state, 'hit'); r = ev({ market: 'total', side: 'over', line: 9, league: 'mlb' }, fin); assert.strictEqual(r.state, 'push');
});

test('MLB props through the evaluator, with no misleading pace on hitters', function () {
  const g = mlb();
  let r = ev({ market: 'player_prop', player: 'Mookie Betts', stat: 'total_bases', side: 'over', line: 4.5, league: 'mlb' }, g); assert.strictEqual(r.state, 'hit'); assert.strictEqual(r.title, 'Mookie Betts Over 4.5 Total Bases');
  r = ev({ market: 'player_prop', player: 'Aaron Judge', stat: 'home_runs', side: 'over', line: 0.5, league: 'mlb' }, g); assert.strictEqual(r.state, 'hit');
  r = ev({ market: 'player_prop', player: 'Freddie Freeman', stat: 'hits', side: 'over', line: 1.5, league: 'mlb' }, g); assert.strictEqual(r.state, 'live'); assert.ok(!/pace/.test(r.detail), r.detail);
  r = ev({ market: 'player_prop', player: 'Freddie Freeman', stat: 'hits_runs_rbis', side: 'over', line: 1.5, league: 'mlb' }, g); assert.strictEqual(r.current, 1);
  r = ev({ market: 'player_prop', player: 'Yoshinobu Yamamoto', stat: 'pitcher_strikeouts', side: 'over', line: 6.5, league: 'mlb' }, g); assert.strictEqual(r.state, 'hit');
  r = ev({ market: 'player_prop', player: 'Yoshinobu Yamamoto', stat: 'pitching_outs', side: 'over', line: 17.5, league: 'mlb' }, g); assert.strictEqual(r.state, 'live'); assert.strictEqual(r.current, 16);
  r = ev({ market: 'player_prop', player: 'Gerrit Cole', stat: 'earned_runs', side: 'under', line: 2.5, league: 'mlb' }, g); assert.strictEqual(r.state, 'miss', '3 earned runs already');
  r = ev({ market: 'player_prop', player: 'Teoscar Hernandez', stat: 'total_bases', side: 'over', line: 1.5, league: 'mlb' }, g);
  assert.strictEqual(r.state, 'unresolved'); assert.ok(/enter the value yourself/.test(r.detail), r.detail);
  r = ev({ market: 'player_prop', player: 'Teoscar Hernandez', stat: 'total_bases', side: 'over', line: 1.5, manualValue: 2, league: 'mlb' }, g); assert.strictEqual(r.state, 'hit', 'a value you type in settles it');
  r = ev({ market: 'player_prop', player: 'Mookie Betts', stat: 'rushing_yards', side: 'over', line: 1.5, league: 'mlb' }, g); assert.strictEqual(r.state, 'unresolved');
});

test('a postponed or cancelled game voids its legs; suspended games stay live', function () {
  const pp = mlb({ state: 'post', period: 0, detail: 'Postponed', awayScore: 0, homeScore: 0, awayLs: [], homeLs: [] });
  const r = ev({ market: 'moneyline', team: 'Dodgers', league: 'mlb' }, pp);
  assert.strictEqual(r.state, 'void'); assert.ok(/postponed/.test(r.detail), r.detail);
  assert.strictEqual(E.summarize([r, ev({ market: 'moneyline', team: 'Dodgers', league: 'mlb' }, mlb({ state: 'post', period: 9, detail: 'Final', awayScore: 5, homeScore: 4, awayLs: [5], homeLs: [4] }))]).status, 'won');
  const cx = nba({ state: 'pre', period: 0, detail: 'Cancelled' }); assert.strictEqual(ev({ market: 'total', side: 'over', line: 200.5, league: 'nba' }, cx).state, 'void');
  const susp = mlb({ state: 'in', period: 6, detail: 'Suspended' }); assert.notStrictEqual(ev({ market: 'moneyline', team: 'Dodgers', league: 'mlb' }, susp).state, 'void');
});

test('the edit dialog lists every stat once, grouped by sport, and every label exists', function () {
  const all = [].concat.apply([], Object.keys(E.STAT_GROUPS).map(function (k) { return E.STAT_GROUPS[k]; }));
  assert.strictEqual(new Set(all).size, all.length, 'no stat listed twice');
  all.forEach(function (k) { assert.ok(E.STAT_LABEL[k], 'label for ' + k); });
  Object.keys(E.STAT_LABEL).forEach(function (k) { assert.ok(all.indexOf(k) >= 0, k + ' is missing from the dropdown'); });
  const { TOOL } = require('../server.js');
  const props = TOOL.input_schema.properties.legs.items.properties;
  assert.deepStrictEqual(props.league.enum, ['nfl', 'cfb', 'nba', 'mlb', null]);
  assert.ok(props.market.enum.indexOf('first_basket') >= 0); ['f5', 'i1'].forEach(function (p) { assert.ok(props.period.enum.indexOf(p) >= 0, p); });
  props.stat.enum.forEach(function (k) { if (k) assert.ok(E.STAT_LABEL[k], 'schema stat has a label: ' + k); });
  all.forEach(function (k) { if (k !== 'other') assert.ok(props.stat.enum.indexOf(k) >= 0, 'schema offers ' + k); });
});

/* ---------------- server ---------------- */
test('server: NBA + MLB scoreboards, league-aware game and roster lookups, resolving legs (including a wrong league guess)', async function () {
  const calls = [], realFetch = global.fetch;
  const evt = function (id, away, home, state, as, hs, date, detail, period) {
    return { id: String(id), date: date, shortName: away.abbreviation + ' @ ' + home.abbreviation, status: { period: period || 0, displayClock: '5:12', type: { state: state, completed: state === 'post', shortDetail: detail } },
      competitions: [{ competitors: [{ homeAway: 'home', team: home, score: String(hs) }, { homeAway: 'away', team: away, score: String(as) }] }] };
  };
  const soon = new Date(Date.now() + 3 * 3600e3).toISOString(), nowIso = new Date(Date.now() - 3600e3).toISOString();
  global.fetch = async function (url) {
    url = String(url); calls.push(url);
    const json = function (o, status) { return { ok: (status || 200) < 400, status: status || 200, json: async function () { return o; }, text: async function () { return JSON.stringify(o); } }; };
    if (/\/basketball\/nba\/scoreboard/.test(url)) return json({ events: [evt(5001, LAL, BOS, 'in', 78, 85, nowIso, '5:12 - 3rd', 3)] });
    if (/\/baseball\/mlb\/scoreboard/.test(url)) return json({ events: [evt(6001, LAD, NYY, 'in', 3, 2, nowIso, 'Top 6th', 6), evt(6002, tm(1, 'BAL', 'Baltimore Orioles'), tm(2, 'BOS', 'Boston Red Sox'), 'pre', 0, 0, soon, '7:05 PM', 0)] });
    if (/scoreboard/.test(url)) return json({ events: [] });
    if (/\/basketball\/nba\/summary\?event=5001/.test(url)) return json(nbaSummary());
    if (/\/baseball\/mlb\/summary\?event=6001/.test(url)) return json(mlbSummary());
    if (/\/baseball\/mlb\/teams\/1\/roster/.test(url)) return json({ athletes: [{ position: 'pitchers', items: [{ displayName: 'Corbin Burnes' }] }, { position: 'catchers', items: [{ displayName: 'Adley Rutschman' }] }] });
    if (/\/baseball\/mlb\/teams\/2\/roster/.test(url)) return json({ athletes: [{ position: 'pitchers', items: [{ displayName: 'Garrett Crochet' }] }] });
    return json({ error: 'nope' }, 404);
  };
  const { server } = require('../server.js');
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const req = function (method, p, body) {
    return new Promise(function (resolve, reject) {
      const data = body ? JSON.stringify(body) : null;
      const rq = http.request({ host: '127.0.0.1', port: port, path: p, method: method, headers: { 'content-type': 'application/json' } }, function (res) {
        let s = ''; res.on('data', function (c) { s += c; }); res.on('end', function () { let j = null; try { j = JSON.parse(s); } catch (e) { /* not json */ } resolve({ status: res.statusCode, json: j }); });
      });
      rq.on('error', reject); if (data) rq.write(data); rq.end();
    });
  };
  try {
    let r = await req('GET', '/api/games'); assert.strictEqual(r.status, 200);
    const byId = {}; r.json.games.forEach(function (g) { byId[g.id] = g; });
    assert.strictEqual(byId['5001'].league, 'nba'); assert.strictEqual(byId['6001'].league, 'mlb'); assert.strictEqual(byId['6002'].league, 'mlb');
    assert.strictEqual(byId['5001'].away.abbr, 'LAL'); assert.strictEqual(byId['6001'].thisWeek, true, 'daily leagues: games around now count as "this week"');
    ['basketball/nba', 'baseball/mlb'].forEach(function (lg) {
      const mine = calls.filter(function (u) { return u.indexOf(lg + '/scoreboard') >= 0; });
      assert.ok(mine.length >= 5 && mine.every(function (u) { return /scoreboard\?dates=\d{8}$/.test(u); }), lg + ' scoreboards are asked one day at a time (ESPN rejects ranges): ' + mine.join(' '));
    });

    r = await req('GET', '/api/game/6001?league=mlb'); assert.strictEqual(r.json.game.league, 'mlb'); assert.strictEqual(r.json.game.hasPlays, true);
    assert.ok(calls.some(function (u) { return /baseball\/mlb\/summary\?event=6001/.test(u); }));
    assert.ok(!calls.some(function (u) { return /football\/.*summary/.test(u); }), 'a league hint means no football lookups');
    r = await req('GET', '/api/game/5001'); assert.strictEqual(r.json.game.league, 'nba', 'no hint: found through the scoreboard');
    assert.strictEqual(r.json.game.players.find(function (p) { return p.name === 'LeBron James'; }).stats.box.pts, 24);
    r = await req('GET', '/api/game/5001?league=constructor'); assert.strictEqual(r.status, 200, 'a junk league value is ignored, not trusted');

    r = await req('POST', '/api/resolve', { legs: [
      { id: 'a', market: 'moneyline', team: 'Dodgers', league: 'mlb' },
      { id: 'b', market: 'moneyline', team: 'Lakers', league: 'nfl' },                                  // wrong guess: found by exact name anyway
      { id: 'c', market: 'player_prop', player: 'LeBron James', league: 'nba' },                        // no team on the slip: found in the live box score
      { id: 'd', market: 'player_prop', player: 'Adley Rutschman', league: 'mlb' },                     // game hasn't started: found through the roster
      { id: 'e', market: 'total', away_team: 'Orioles', home_team: 'Red Sox', league: 'mlb' },
      { id: 'f', market: 'moneyline', team: 'Dodgers', league: 'mlb', game_date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) },
    ] });
    const m = {}; r.json.results.forEach(function (x) { m[x.id] = x; });
    assert.strictEqual(m.a.gameId, '6001'); assert.strictEqual(m.a.league, 'mlb'); assert.strictEqual(m.a.team, 'LAD');
    assert.strictEqual(m.b.gameId, '5001'); assert.strictEqual(m.b.league, 'nba'); assert.strictEqual(m.b.team, 'LAL');
    assert.strictEqual(m.c.gameId, '5001'); assert.strictEqual(m.c.team, 'LAL');
    assert.strictEqual(m.d.gameId, '6002'); assert.strictEqual(m.d.team, 'BAL');
    assert.strictEqual(m.e.gameId, '6002');
    assert.strictEqual(m.f.gameId, '6001', 'a game date that matches nothing falls back to the closest game');
  } finally { global.fetch = realFetch; await new Promise(function (r) { server.close(r); }); }
});

test('picking among several games by the date printed on the slip works across US time zones', function () {
  const { pickGame } = require('../server.js');
  const g = function (id, iso) { return { id: id, date: iso, state: 'pre', thisWeek: true }; };
  // a 10:05pm Pacific game on Oct 27 starts at 05:05 UTC on Oct 28; a series means the same teams play the next night too
  const cands = [g('late27', '2026-10-28T05:05Z'), g('night28', '2026-10-29T02:05Z')];
  assert.strictEqual(pickGame(cands, { game_date: '2026-10-27' }).id, 'late27');
  assert.strictEqual(pickGame(cands, { game_date: '2026-10-28' }).id, 'night28');
  const east = [g('e27', '2026-10-27T23:05Z'), g('e28', '2026-10-28T23:05Z')];
  assert.strictEqual(pickGame(east, { game_date: '2026-10-28' }).id, 'e28'); assert.strictEqual(pickGame(east, { game_date: '2026-10-27' }).id, 'e27');
});

/* ---------------- push notifications ---------------- */
function memDb() {
  const t = { push_subs: [], slips: [], leg_state: [] }, keys = { leg_state: ['user_id', 'slip_id', 'leg_id'], push_subs: ['user_id', 'endpoint'] };
  const parse = function (qs) {
    const f = [];
    new URLSearchParams(qs).forEach(function (v, k) {
      if (k === 'select' || k === 'on_conflict') return;
      if (v.startsWith('eq.')) f.push(function (r) { return String(r[k]) === v.slice(3); });
      else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map(function (x) { return x.replace(/^"|"$/g, ''); }); f.push(function (r) { return set.indexOf(String(r[k])) >= 0; }); }
    });
    return function (r) { return f.every(function (x) { return x(r); }); };
  };
  return {
    t: t,
    select: async function (table, qs) { const m = parse(qs); return t[table].filter(m).map(function (r) { return JSON.parse(JSON.stringify(r)); }); },
    upsert: async function (table, rows) { rows.forEach(function (row) { const k = keys[table], i = t[table].findIndex(function (r) { return k.every(function (c) { return r[c] === row[c]; }); }); if (i >= 0) t[table][i] = Object.assign({}, t[table][i], row); else t[table].push(Object.assign({}, row)); }); },
    del: async function (table, qs) { const m = parse(qs); t[table] = t[table].filter(function (r) { return !m(r); }); },
  };
}

test('push notifications work for basketball and baseball legs (the checker asks for the right league)', async function () {
  const k = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), j = k.privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]).toString('base64url');
  const db = memDb(), sent = [], asked = []; let nbaPts = 18;
  const n = N.create({
    env: { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: j.d }, db: db, E: E,
    getGames: async function () { return [{ id: '5001', league: 'nba', state: 'in' }, { id: '6001', league: 'mlb', state: 'in' }]; },
    getGame: async function (id, league) {
      asked.push(id + ':' + league);
      if (id === '5001') { const s = nbaSummary(); s.boxscore.players[0].statistics[0].athletes[0].stats[1] = String(nbaPts); return Stats.normalizeSummary(s, id, 'nba'); }
      return Stats.normalizeSummary(mlbSummary(), id, 'mlb');
    },
    send: async function (sub, payload) { sent.push(payload); return { ok: true, status: 201 }; },
  });
  db.t.push_subs.push({ user_id: 'u1', endpoint: 'https://p/1', sub: { endpoint: 'https://p/1', keys: { p256dh: 'x', auth: 'y' } } });
  db.t.slips.push({ user_id: 'u1', id: 's1', data: { id: 's1', name: 'Tonight', wager: 10, payout: 100, legs: [
    { id: 'a', market: 'player_prop', player: 'LeBron James', stat: 'points', side: 'over', line: 23.5, gameId: '5001', league: 'nba' },
    { id: 'b', market: 'player_prop', player: 'Mookie Betts', stat: 'total_bases', side: 'over', line: 4.5, gameId: '6001', league: 'mlb' },
    { id: 'c', market: 'moneyline', team: 'Dodgers', period: 'f5', gameId: '6001', league: 'mlb' },
    { id: 'd', market: 'moneyline', team: 'Yankees', gameId: '6001', league: 'mlb' },                    // still trailing: keeps the slip alive
  ] } });
  await n.tick();                                   // first sighting: LeBron at 18 (live), Betts 5 TB already a hit, F5 already a hit, Yankees live -> all baselines
  assert.strictEqual(sent.length, 0, 'baseline is silent');
  assert.ok(asked.indexOf('5001:nba') >= 0 && asked.indexOf('6001:mlb') >= 0, 'asked for the right leagues: ' + asked.join(','));
  nbaPts = 24; await n.tick();                      // LeBron crosses 23.5
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].title, '✓ Leg hit'); assert.ok(/LeBron James Over 23\.5 Points/.test(sent[0].body), sent[0].body);
  await n.tick(); assert.strictEqual(sent.length, 1, 'never twice');
});

test('probe script: reports what it understood from a real-shaped payload', async function () {
  const { main } = require('../scripts/probe-espn.js');
  const evt = function (id, away, home, state) { return { id: String(id), date: '2026-10-28T23:00Z', status: { period: 3, displayClock: '5:12', type: { state: state, shortDetail: '5:12 - 3rd' } }, competitions: [{ competitors: [{ homeAway: 'home', team: home, score: '85' }, { homeAway: 'away', team: away, score: '78' }] }] }; };
  const f = async function (url) {
    const j = /nba\/scoreboard/.test(url) ? { events: [evt(5001, LAL, BOS, 'in')] } : /mlb\/scoreboard/.test(url) ? { events: [evt(6001, LAD, NYY, 'in')] }
      : /nba\/summary/.test(url) ? nbaSummary() : /mlb\/summary/.test(url) ? mlbSummary() : null;
    return { ok: !!j, status: j ? 200 : 404, json: async function () { return j; } };
  };
  const out = (await main([], f, [])).join('\n');
  assert.ok(/NBA/.test(out) && /MLB/.test(out)); assert.ok(/every team abbreviation is in our table/.test(out)); assert.ok(/players found: 4/.test(out));
  assert.ok(/MIN \| PTS \| FG \| 3PT/.test(out), 'prints the real labels'); assert.ok(/play-by-play available.*yes/.test(out));
  assert.ok(/pts_reb_ast=\d+/.test(out) && /total_bases=5/.test(out) && /hit-type check: 3 of 4/.test(out) && /play types seen/.test(out), out);
  const bad = (await main(['nba'], async function () { return { ok: false, status: 500, json: async function () { return {}; } }; }, [])).join('\n');
  assert.ok(/✗ nba: every scoreboard request failed \(.*HTTP 500/.test(bad), bad);
});

/* ---------------- run ---------------- */
module.exports = { nbaSummary: nbaSummary, mlbSummary: mlbSummary, LAL: LAL, BOS: BOS, LAD: LAD, NYY: NYY };
if (require.main === module) (async function () {
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e).toString().split('\n').slice(0, 5).join('\n      ')); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();