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
const BAT_STATS = ['hits', 'runs', 'rbis', 'home_runs', 'walks', 'batter_strikeouts', 'total_bases', 'singles', 'doubles', 'triples', 'stolen_bases', 'hits_runs_rbis'];
const PIT_STATS = ['pitcher_strikeouts', 'pitching_outs', 'earned_runs', 'hits_allowed', 'walks_allowed', 'pitches_thrown'];
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
  // ESPN rejects date ranges on these scoreboards (HTTP 400), so the site asks for one day at a time: same here
  const seen = new Map(), failed = []; let okDays = 0;
  for (let off = -2; off <= 3; off++) {
    try { ((await getJSON(BASE + PATHS[league] + '/scoreboard?dates=' + ymd(off), f)).events || []).forEach(function (e) { seen.set(String(e.id), e); }); okDays++; }
    catch (e) { failed.push(ymd(off) + ': ' + e.message.replace(/ for https?:.*/, '')); }
  }
  const events = Array.from(seen.values());
  log('scoreboard: ' + events.length + ' games over ' + okDays + ' of 6 days asked (' + ymd(-2) + '–' + ymd(3) + ')' + (failed.length ? '\n  ⚠ failed: ' + failed.join('; ') : ''));
  if (!okDays) throw new Error('every scoreboard request failed (' + failed[0] + ')');
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
  const show = function (label, p, stats) {
    if (!p) return;
    log('  ' + label + ': ' + p.name + ' (' + p.team + ')  ' + Stats.statLine(p));
    log('    ' + stats.map(function (k) { const r = Stats.statValue(g, p.name, k, {}); return k + '=' + (r.status === 'ok' ? r.value : r.status === 'unsupported' ? 'MANUAL' : r.status); }).join('  '));
  };
  if (league === 'nba') {
    show('sample player', g.players.slice().sort(function (a, b) { return ((b.stats.box || {}).pts || 0) - ((a.stats.box || {}).pts || 0); })[0], SAMPLE_STATS.nba);
  } else {
    const bat = function (p) { return p.stats.batting || {}; }, pit = function (p) { return p.stats.pitching || {}; };
    show('best hitter', g.players.filter(bat).sort(function (a, b) { return (bat(b).h || 0) * 4 + (bat(b).hr || 0) * 3 + (bat(b).rbi || 0) - ((bat(a).h || 0) * 4 + (bat(a).hr || 0) * 3 + (bat(a).rbi || 0)); })[0], BAT_STATS);
    show('best pitcher', g.players.filter(function (p) { return p.stats.pitching; }).sort(function (a, b) { return (pit(b).outs || 0) - (pit(a).outs || 0); })[0], PIT_STATS);
    // play types ESPN uses, and whether the play-by-play explains every hit
    const types = new Map();
    (sum.plays || []).forEach(function (pl) { const t = pl.type ? (pl.type.text || pl.type.type || '?') : '(no type)'; const e = types.get(t) || { n: 0, ex: '' }; e.n++; if (!e.ex || (pl.text && e.ex.length > pl.text.length && pl.text.length > 12)) e.ex = pl.text || ''; types.set(t, e); });
    log('  play types seen:');
    Array.from(types.entries()).sort(function (a, b) { return b[1].n - a[1].n; }).slice(0, 40).forEach(function (kv) { log('    ' + String(kv[1].n).padStart(3) + ' × ' + kv[0] + '   e.g. "' + String(kv[1].ex).slice(0, 80) + '"'); });
    const hitters = g.players.filter(function (p) { return bat(p).h > 0; }), off = [];
    hitters.forEach(function (p) { const e = p.ev || { s: 0, d: 0, t: 0 }; if (e.s + e.d + e.t !== bat(p).h - (bat(p).hr || 0)) off.push(p.name + ': ' + bat(p).h + ' H / ' + (bat(p).hr || 0) + ' HR but plays show ' + e.s + ' 1B ' + e.d + ' 2B ' + e.t + ' 3B'); });
    log('  hit-type check: ' + (hitters.length - off.length) + ' of ' + hitters.length + ' hitters\' hits are fully explained by the play-by-play' + (off.length ? '\n    ⚠ ' + off.join('\n    ⚠ ') : '  ✓'));
    const sb = g.players.reduce(function (a, p) { return a + ((p.ev && p.ev.sb) || 0); }, 0);
    log('  stolen bases counted from plays: ' + sb);
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