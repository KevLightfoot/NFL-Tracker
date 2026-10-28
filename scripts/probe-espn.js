#!/usr/bin/env node
'use strict';
/*
 * Checks the REAL ESPN NBA / MLB data against this project's parsers.   Run:   node scripts/probe-espn.js
 *
 * For each league it fetches the scoreboard, picks a game that has started (or the next one), loads its box score, runs the same
 * code the server uses, and prints what it understood. If something looks off (0 players for a finished game, a stat marked
 * "manual", missing labels), copy the whole output and send it to whoever maintains the site: it shows the real label names.
 *
 *   node scripts/probe-espn.js            both leagues
 *   node scripts/probe-espn.js nba        one league
 *   node scripts/probe-espn.js mlb 401234 a specific ESPN event id
 */
const Stats = require('../public/lib/stats.js');
const Teams = require('../public/lib/teams.js');

const PATHS = { nba: 'basketball/nba', mlb: 'baseball/mlb' };
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/';
const SAMPLE_STATS = {
  nba: ['points', 'rebounds', 'assists', 'three_pointers_made', 'steals', 'blocks', 'turnovers', 'pts_reb_ast', 'double_double', 'fantasy_points'],
  mlb: ['hits', 'runs', 'rbis', 'home_runs', 'walks', 'batter_strikeouts', 'total_bases', 'singles', 'doubles', 'stolen_bases', 'hits_runs_rbis', 'pitcher_strikeouts', 'pitching_outs', 'earned_runs', 'hits_allowed', 'walks_allowed', 'pitches_thrown'],
};

async function getJSON(url, f) {
  const res = await f(url, { headers: { 'user-agent': 'Mozilla/5.0 ParlayTracker', accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return res.json();
}
const ymd = function (off) { return new Date(Date.now() + off * 864e5).toISOString().slice(0, 10).replace(/-/g, ''); };
const trim = function (v, n) { const s = JSON.stringify(v); return s && s.length > (n || 300) ? s.slice(0, n || 300) + '…' : s; };

async function probe(league, eventId, f, out) {
  const log = function (s) { out.push(s || ''); };
  log('════════ ' + league.toUpperCase() + ' ════════');
  const sb = await getJSON(BASE + PATHS[league] + '/scoreboard?dates=' + ymd(-3) + '-' + ymd(4) + '&limit=200', f);
  const events = sb.events || [];
  log('scoreboard: ' + events.length + ' games in the window (' + ymd(-3) + '–' + ymd(4) + ')');
  if (!events.length) { log('  nothing on the schedule (off-season?): nothing more to check for ' + league); return; }
  const games = events.map(function (e) { return Stats.normalizeEvent(e, league); });
  log('  e.g. ' + games.slice(0, 3).map(function (g) { return g.away.abbr + ' @ ' + g.home.abbr + ' [' + g.state + (g.detail ? ': ' + g.detail : '') + ']'; }).join('   '));
  const unknown = []; games.forEach(function (g) { [g.away, g.home].forEach(function (t) { if (!Teams[league === 'nba' ? 'NBA_INFO' : 'MLB_INFO'][t.abbr]) unknown.push(t.abbr); }); });
  log(unknown.length ? '  ⚠ team abbreviations not in our table (they register themselves, but check names): ' + unknown.join(', ') : '  ✓ every team abbreviation is in our table');

  const pick = eventId ? games.find(function (g) { return g.id === String(eventId); }) || { id: String(eventId) }
    : games.find(function (g) { return g.state === 'in'; }) || games.filter(function (g) { return g.state === 'post'; }).pop() || games[0];
  log('box score for event ' + pick.id + (pick.away ? ' (' + pick.away.abbr + ' @ ' + pick.home.abbr + ', ' + pick.state + ')' : ''));
  const sum = await getJSON(BASE + PATHS[league] + '/summary?event=' + pick.id, f);
  const cats = ((sum.boxscore || {}).players || []).reduce(function (a, tb) { return a.concat(tb.statistics || []); }, []);
  log('  summary keys: ' + Object.keys(sum).join(', '));
  log('  box score categories: ' + (cats.length ? cats.map(function (c) { return (c.type || c.name || '(unnamed)') + ' [' + (c.labels || c.names || c.keys || []).join(' | ') + ']'; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join('\n                        ') : 'NONE (game not started yet?)'));
  const sample = cats.length && (cats[0].athletes || [])[0];
  if (sample) log('  first athlete: ' + trim({ athlete: sample.athlete && sample.athlete.displayName, stats: sample.stats, didNotPlay: sample.didNotPlay }, 260));
  log('  plays: ' + (Array.isArray(sum.plays) ? sum.plays.length + ' (first: ' + trim(sum.plays[0] && { text: sum.plays[0].text, type: sum.plays[0].type, scoringPlay: sum.plays[0].scoringPlay, participants: sum.plays[0].participants && sum.plays[0].participants.length }, 260) + ')' : 'none'));

  const g = Stats.normalizeSummary(sum, pick.id, league);
  log('parsed: ' + (g.away && g.away.abbr) + ' ' + (g.away && g.away.score) + ' @ ' + (g.home && g.home.abbr) + ' ' + (g.home && g.home.score) + ', status ' + g.state + ' "' + g.detail + '" period ' + g.period + ' clock "' + g.clock + '"');
  log('  players found: ' + g.players.length + (g.players.length ? '' : '   ⚠ none: props can\'t track'));
  if (league === 'nba') log('  scoring plays kept for "first basket": ' + g.scoringPlays.length + (g.scoringPlays[0] ? ' (first: ' + g.scoringPlays[0].text + ')' : ''));
  if (league === 'mlb') log('  play-by-play available for singles/doubles/total bases/steals: ' + (g.hasPlays ? 'yes' : 'NO (those stats will ask for manual entry)'));
  const star = g.players.slice().sort(function (a, b) { return JSON.stringify(b.stats).length - JSON.stringify(a.stats).length; })[0];
  if (star) {
    log('  sample player: ' + star.name + ' (' + star.team + ')  ' + Stats.statLine(star));
    SAMPLE_STATS[league].forEach(function (k) {
      const r = Stats.statValue(g, star.name, k, {});
      log('    ' + k.padEnd(22) + (r.status === 'ok' ? String(r.value) : '— ' + r.status + (r.status === 'unsupported' ? ' (manual entry)' : '')));
    });
  }
}

async function main(argv, f, out) {
  const want = argv.filter(function (a) { return PATHS[a]; });
  const id = argv.find(function (a) { return /^\d{6,}$/.test(a); });
  for (const lg of (want.length ? want : ['nba', 'mlb'])) {
    try { await probe(lg, id, f, out); } catch (e) { out.push('✗ ' + lg + ': ' + e.message); }
    out.push('');
  }
  return out;
}

if (require.main === module) {
  if (typeof fetch !== 'function') { console.log('Needs Node 18 or newer.'); process.exit(1); }
  main(process.argv.slice(2), fetch, []).then(function (lines) { console.log(lines.join('\n')); console.log('Copy everything above if something looks wrong.'); });
}
module.exports = { main: main, probe: probe };
