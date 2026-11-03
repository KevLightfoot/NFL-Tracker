#!/usr/bin/env node
'use strict';
/*
 * Parlay Tracker server — zero dependencies (Node 18+).
 *   POST /api/parse    screenshot(s) -> structured bet (OpenAI vision)
 *   GET  /api/config   {hasServerKey, model}
 *   GET  /api/games    NFL, college football, NBA and MLB games (scoreboards: ~3 weeks of football, about a week of NBA / MLB)
 *   GET  /api/game/:id live box score + scoring plays for one game
 *   POST /api/resolve  find the game (and team) for each leg
 *   GET  /api/cron/check   run the push-notification checker now (CRON_SECRET)
 *   POST /api/push/test    send a test notification to one registered device
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const Teams = require('./public/lib/teams.js');
const Stats = require('./public/lib/stats.js');
const Evaluate = require('./public/lib/evaluate.js');
const Notify = require('./notify.js');

// minimal .env loader
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
} catch (e) { /* no .env — fine */ }

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://kevlightfoot.github.io';
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_ALT_BASE = 'https://site.web.api.espn.com/apis/site/v2/sports';
const LEAGUES = { nfl: { sport: 'football', path: 'nfl' }, cfb: { sport: 'football', path: 'college-football' }, nba: { sport: 'basketball', path: 'nba' }, mlb: { sport: 'baseball', path: 'mlb' }, cbb: { sport: 'basketball', path: 'mens-college-basketball' } };
const LEAGUE_IDS = Object.keys(LEAGUES);
const isLeague = function (x) { return typeof x === 'string' && Object.prototype.hasOwnProperty.call(LEAGUES, x); };
const leagueUrl = function (base, lg) { return base + '/' + LEAGUES[lg].sport + '/' + LEAGUES[lg].path; };
const DAILY = { nba: true, mlb: true, cbb: true };     // leagues that play every day: "this week" means roughly yesterday to day after tomorrow
// ESPN college scoreboards only list every game when a conference group is given: 80 = FBS, 81 = FCS (set CFB_GROUPS=80,81 to include FCS).
const CFB_GROUPS = (process.env.CFB_GROUPS || '80').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
const PUBLIC = path.join(__dirname, 'public');

/* ---------------- tiny cache ---------------- */
const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.exp > now) return hit.val;
  const p = Promise.resolve().then(fn);
  cache.set(key, { exp: now + ttl, val: p });
  try { return await p; } catch (e) { cache.delete(key); throw e; }
}

async function getJSON(url) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 ParlayTracker', accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + new URL(url).host);
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* ---------------- ESPN ---------------- */
async function getGames() {
  return cached('games', 20000, async function () {
    const day = function (off) { return new Date(Date.now() + off * 864e5).toISOString().slice(0, 10).replace(/-/g, ''); };
    const range = day(-10) + '-' + day(14);
    const jobs = [
      { league: 'nfl', week: true, url: leagueUrl(ESPN_BASE, 'nfl') + '/scoreboard?limit=100' },
      { league: 'nfl', week: false, url: leagueUrl(ESPN_BASE, 'nfl') + '/scoreboard?dates=' + range + '&limit=300' },
    ];
    // NBA / MLB play daily and ESPN rejects date ranges on their scoreboards (HTTP 400), so ask for one day at a time
    [['nba', -2, 3], ['mlb', -2, 3]].forEach(function (x) {
      for (let off = x[1]; off <= x[2]; off++) jobs.push({ league: x[0], week: false, url: leagueUrl(ESPN_BASE, x[0]) + '/scoreboard?dates=' + day(off) });
    });
    // men's college basketball: one day at a time too, and only group 50 (all of Division I) lists every game, not just the featured ones
    for (let off = -2; off <= 3; off++) jobs.push({ league: 'cbb', week: false, url: leagueUrl(ESPN_BASE, 'cbb') + '/scoreboard?dates=' + day(off) + '&groups=50&limit=400' });
    CFB_GROUPS.forEach(function (grp) {
      jobs.push({ league: 'cfb', week: true, url: leagueUrl(ESPN_BASE, 'cfb') + '/scoreboard?groups=' + grp + '&limit=400' });
      jobs.push({ league: 'cfb', week: false, url: leagueUrl(ESPN_BASE, 'cfb') + '/scoreboard?dates=' + range + '&groups=' + grp + '&limit=600' });
    });
    const rs = await Promise.allSettled(jobs.map(function (j) { return getJSON(j.url); }));
    const byKey = new Map(), thisWeek = new Set();
    let firstErr = null;
    rs.forEach(function (r, i) {
      if (r.status !== 'fulfilled') { if (!firstErr) firstErr = r.reason; return; }
      (r.value.events || []).forEach(function (ev) {
        const g = Stats.normalizeEvent(ev, jobs[i].league);
        if (!g.away || !g.home) return;
        const key = g.league + ':' + g.id;
        byKey.set(key, g);
        if (jobs[i].week) thisWeek.add(key);
      });
    });
    if (!byKey.size) throw new Error('Could not reach the ESPN scoreboard (' + (firstErr && firstErr.message || 'no data') + ')');
    const now = Date.now();
    return Array.from(byKey.entries())
      .map(function (kv) {
        const g = kv[1], t = Date.parse(g.date);
        g.thisWeek = thisWeek.has(kv[0]) || (!!DAILY[g.league] && !isNaN(t) && t > now - 30 * 36e5 && t < now + 54 * 36e5);
        return g;
      })
      .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
  });
}

/* Which league(s) could this game id belong to? A hint wins; otherwise look it up on the scoreboard; otherwise try both. */
async function leaguesFor(id, hint) {
  if (isLeague(hint)) return [hint];
  try { const g = (await getGames()).find(function (x) { return x.id === id; }); if (g) return [g.league]; } catch (e) { /* scoreboard down */ }
  return LEAGUE_IDS.slice();
}

async function getGame(id, hint) {
  id = String(id).replace(/[^0-9a-zA-Z_-]/g, '');
  const hit = cache.get('g' + id);
  if (hit && hit.exp > Date.now()) return hit.val;
  let j = null, league = null, lastErr = null;
  for (const lg of await leaguesFor(id, hint)) {
    for (const base of [ESPN_BASE, ESPN_ALT_BASE]) {
      try {
        const r = await getJSON(leagueUrl(base, lg) + '/summary?event=' + id);
        if (r && (r.header || r.boxscore)) { j = r; league = lg; break; }
      } catch (e) { lastErr = e; }
    }
    if (j) break;
  }
  if (!j) throw lastErr || new Error('Game ' + id + ' not found');
  const g = Stats.normalizeSummary(j, id, league);
  // The summary header sometimes lacks period/clock/linescores; backfill from the (cached) scoreboard.
  try {
    const sb = (await getGames()).find(function (x) { return x.id === g.id && x.league === league; });
    if (sb) {
      if (!g.hasStatus) { g.state = sb.state; g.completed = sb.completed; g.detail = sb.detail; g.period = sb.period; g.clock = sb.clock; }
      if (!g.period && sb.period && g.state === 'in') g.period = sb.period;
      if (!g.clock && sb.clock && g.state === 'in') g.clock = sb.clock;
      if (!g.detail) g.detail = sb.detail;
      if (!g.date) g.date = sb.date;
      if (g.state === 'in' && !g.sit && sb.sit && sb.state === 'in') g.sit = sb.sit;
      if (g.state !== 'in') delete g.sit;
      ['away', 'home'].forEach(function (side) {
        if (g[side] && sb[side]) {
          if (!g[side].linescores.length) g[side].linescores = sb[side].linescores;
          if (!g[side].score && sb[side].score) g[side].score = sb[side].score;
        }
      });
    }
  } catch (e) { /* scoreboard unavailable — the summary alone is fine */ }
  const ttl = g.state === 'in' ? 8000 : g.state === 'post' ? 10 * 60000 : 45000;
  cache.set('g' + id, { exp: Date.now() + ttl, val: g });
  return g;
}

async function getRoster(teamId, league) {
  league = isLeague(league) ? league : 'nfl';
  return cached('roster' + league + teamId, 12 * 3600 * 1000, async function () {
    const j = await getJSON(leagueUrl(ESPN_BASE, league) + '/teams/' + teamId + '/roster');
    const out = [];
    (j.athletes || []).forEach(function (grp) {
      (grp.items || [grp]).forEach(function (a) { const nm = a.displayName || a.fullName; if (nm) out.push({ name: nm }); });
    });
    return out;
  });
}

/* ---------------- structured logs (Render → Logs; one JSON object per line, no screenshots, no keys) ---------------- */
function log(ev, data) {
  try { console.log(JSON.stringify(Object.assign({ t: new Date().toISOString(), ev: ev }, data || {}))); } catch (e) { /* never let logging break a request */ }
}
const legBrief = function (l) {
  return { player: l.player || undefined, team: l.team || undefined, market: l.market, stat: l.stat || undefined, side: l.side || undefined,
    line: l.line == null ? null : l.line, league: l.league || undefined, away: l.away_team || undefined, home: l.home_team || undefined,
    date: l.game_date || undefined, raw: l.raw_text ? String(l.raw_text).slice(0, 80) : undefined };
};

/* ---------------- leg -> game resolution ---------------- */
/* "Seattle" vs "Seattle U", "Miami" vs "Miami (OH)": the same school written shorter or longer, word by word. */
function looseName(text, side) {
  const t = Teams.norm(text || '');
  if (!t || t.length < 3 || !side) return false;
  const tw = t.split(' ');
  return [side.name, side.short, side.location, side.abbr].some(function (x) {
    const s = Teams.norm(x || '');
    if (!s) return false;
    if (s === t || s.startsWith(t + ' ') || t.startsWith(s + ' ')) return true;
    // every word written is the start of the school's word in the same place: "san fran" / "san francisco", "radf" / "radford"
    const sw = s.split(' ');
    return tw.length <= sw.length && tw.every(function (w, i) { return w.length >= (tw.length === 1 ? 4 : 3) && sw[i].startsWith(w); });
  });
}
/* What sport a leg is, from what it bets on (not the model's league label, which can be wrong): a points prop or a 145.5 total is basketball,
   a TD scorer or a 47.5 total is football. null when the leg itself doesn't say. */
const HOOPS_STATS = new Set(['points', 'rebounds', 'assists', 'three_pointers_made', 'three_pointers_attempted', 'field_goals_made', 'field_goals_attempted', 'free_throws_made',
  'free_throws_attempted', 'steals', 'blocks', 'turnovers', 'steals_blocks', 'pts_reb', 'pts_ast', 'reb_ast', 'pts_reb_ast', 'offensive_rebounds', 'defensive_rebounds',
  'personal_fouls', 'minutes', 'double_double', 'triple_double']);
const BASE_STATS = new Set(['hits', 'runs', 'rbis', 'home_runs', 'walks', 'batter_strikeouts', 'at_bats', 'hits_runs_rbis', 'singles', 'doubles', 'triples', 'total_bases',
  'stolen_bases', 'pitcher_strikeouts', 'pitching_outs', 'earned_runs', 'hits_allowed', 'walks_allowed', 'runs_allowed', 'pitches_thrown']);
function legSport(leg) {
  if (!leg) return null;
  const m = leg.market, st = leg.stat, line = Math.abs(Number(leg.line));
  if (m === 'anytime_td' || m === 'first_td' || m === 'last_td') return 'football';
  if (m === 'first_basket') return 'basketball';
  if (m === 'player_prop' && st && st !== 'other' && st !== 'fantasy_points') return HOOPS_STATS.has(st) ? 'basketball' : BASE_STATS.has(st) ? 'baseball' : 'football';
  if (leg.line != null && isFinite(line) && line > 0) {
    if (m === 'total') return line >= 100 ? 'basketball' : line < 20 ? 'baseball' : 'football';
    if (m === 'team_total') return line >= 50 ? 'basketball' : line < 9 ? 'baseball' : 'football';
  }
  return null;
}
/* The leagues worth searching for a leg: its league label when that fits the sport the leg is, otherwise every league of that sport. */
function leaguesForLeg(leg, hint) {
  const sp = legSport(leg);
  if (hint && (!sp || LEAGUES[hint].sport === sp)) return [hint];
  if (sp) return LEAGUE_IDS.filter(function (l) { return LEAGUES[l].sport === sp; });
  return null;    // anything
}

function pickGame(cands, leg) {
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0];
  if (leg.game_date) {
    const want = String(leg.game_date).slice(0, 10);
    const byDate = cands.filter(function (g) {
      if (!g.date) return false;
      const t = new Date(g.date).getTime();
      // the slip shows the game's local date: accept it in UTC and in the US time zones (a 10pm Pacific game is already "tomorrow" in UTC)
      return [0, 4, 5, 6, 7, 8].some(function (h) { return new Date(t - h * 3600 * 1000).toISOString().slice(0, 10) === want; });
    });
    if (byDate.length) cands = byDate;
    if (cands.length === 1) return cands[0];
  }
  const week = cands.filter(function (g) { return g.thisWeek; });
  if (week.length) cands = week;
  const now = Date.now();
  const live = cands.filter(function (g) { return g.state === 'in'; });
  if (live.length) return live[0];
  return cands.slice().sort(function (a, b) {
    const da = new Date(a.date) - now, db = new Date(b.date) - now;
    return (da < 0 ? -da * 1.5 : da) - (db < 0 ? -db * 1.5 : db);
  })[0];
}

async function resolveLeg(leg, games, lean) {
  const hint = isLeague(leg.league) ? leg.league : null;
  let res = await resolveIn(leg, games, hint, false, lean);
  if (!res.gameId && hint) res = await resolveIn(leg, games, null, true, lean);   // the league hint can be wrong — retry across every league, but only on exact names
  return res;
}

/* The team a player is actually on in game g (box score once started, rosters before), or null. */
async function playerTeamIn(g, name) {
  if (g.state === 'pre') {
    for (const side of [g.away, g.home]) {
      const roster = await getRoster(side.id, g.league);
      if (Stats.findPlayer(roster, name)) return side.abbr;
    }
    return null;
  }
  const full = await getGame(g.id, g.league);
  const p = Stats.findPlayer(full.players, name);
  return p ? p.team : null;
}

/* All legs of one slip together. Legs that name a team or matchup are resolved on their own; a prop that shows no matchup first looks in
   the games the rest of the slip is in (a 7-leg Panthers–Packers slip is about one game), and only then searches the week's games. */
async function resolveSlip(legs, games) {
  const out = {}, deferred = [];
  for (const leg of legs) {
    if (!leg.team && !leg.away_team && !leg.home_team && leg.player) deferred.push(leg);
    else out[leg.id] = await resolveLeg(leg, games);
  }
  const sib = []; const seen = new Set();
  const addSib = function (id) { if (id && !seen.has(id)) { const g = games.find(function (x) { return x.id === id; }); if (g) { seen.add(id); sib.push(g); } } };
  Object.keys(out).forEach(function (k) { addSib(out[k].gameId); });
  // the league most of this slip's games are in: breaks ties between a pro player and his college namesake
  const leanOf = function () { const c = {}; sib.forEach(function (g) { c[g.league] = (c[g.league] || 0) + 1; }); return Object.keys(c).sort(function (x, y) { return c[y] - c[x]; })[0] || null; };
  for (const leg of deferred) {
    let hit = null, hitPost = null;
    for (const g of sib) {
      const team = await playerTeamIn(g, leg.player).catch(function () { return null; });
      if (!team) continue;
      const h = { id: leg.id, gameId: g.id, team: team, league: g.league, via: 'slip' };
      if (g.state !== 'post') { hit = h; break; }
      if (!hitPost) hitPost = h;
    }
    if (!hit && hitPost) {
      // only a finished slip-mate game has him. If the slip still has open games, a live/upcoming game he is in is far likelier than a finished namesake.
      const open = sib.some(function (g) { return g.state !== 'post'; });
      if (open) {
        const r = await resolveLeg(leg, games, leanOf());
        const rg = r && r.gameId && games.find(function (x) { return x.id === r.gameId; });
        hit = rg && rg.state !== 'post' ? r : hitPost;
      } else hit = hitPost;
    }
    out[leg.id] = hit || await resolveLeg(leg, games, leanOf());
    // a leg placed by search tells the next ones where this slip is
    addSib(out[leg.id] && out[leg.id].gameId);
  }
  return legs.map(function (l) { return out[l.id]; });
}

/* Which game is a prop in when the slip shows no team or matchup? The same name often exists in the pros and in college (Derrick Henry, Lamar Jackson,
   Michael Wilson), so the games are searched in tiers, nearest to "now" first, and the best hit in the first tier that has one wins:
     0. games on the date printed on the slip (if any)
     1. games in progress, starting within 36 hours, or that ended within the last 18 hours
     2. everything else this week, closest to now first (upcoming before finished)
   Inside a tier: the league most of the slip is in, then pro football, then college, then the game closest to now. */
async function findPlayerGame(leg, games, hint, lean) {
  const now = Date.now();
  const when = function (g) { const t = Date.parse(g.date); return isNaN(t) ? null : t; };
  let pool = games.filter(function (g) { return g.thisWeek; });
  const sp = legSport(leg) || (hint ? LEAGUES[hint].sport : null);
  // the model's pro/college label is often wrong (a pro prop on a slip with college legs gets "cfb"), so every league of the sport is searched;
  // baseball is MLB only. Without any clue, everything is searched.
  if (sp) pool = pool.filter(function (g) { return LEAGUES[g.league].sport === sp; });
  const dist = function (g) { const t = when(g); if (t == null) return 9e12; const d = t - now; return d < 0 ? -d * 1.5 : d; };
  const check = async function (g) { const team = await playerTeamIn(g, leg.player); return team ? { game: g, team: team } : null; };
  const scan = async function (list, firstBatchOnly) {
    const hits = [];
    for (let i = 0; i < list.length; i += 8) {
      const found = await Promise.all(list.slice(i, i + 8).map(function (g) { return check(g).catch(function () { return null; }); }));
      found.forEach(function (h) { if (h) hits.push(h); });
      if (firstBatchOnly && hits.length) break;
    }
    return hits;
  };
  const rank = function (a, b) {
    const ORDER = { nfl: 1, nba: 1, mlb: 1, cfb: 2, cbb: 2 };   // pros before college when the same name is in both
    const lg = function (h) { return h.game.league === lean ? 0 : (ORDER[h.game.league] || 3); };
    return lg(a) - lg(b) || (a.game.state === 'in' ? 0 : 1) - (b.game.state === 'in' ? 0 : 1) || dist(a.game) - dist(b.game);
  };
  const tiers = [];
  if (leg.game_date) {
    const want = String(leg.game_date).slice(0, 10);
    tiers.push(pool.filter(function (g) { const t = when(g); return t != null && [0, 4, 5, 6, 7, 8].some(function (h) { return new Date(t - h * 3600 * 1000).toISOString().slice(0, 10) === want; }); }));
  }
  const near = function (g) { const t = when(g); return g.state === 'in' || (g.state === 'pre' && t != null && t - now < 36 * 36e5) || (g.state === 'post' && t != null && now - t < 18 * 36e5); };
  tiers.push(pool.filter(near).sort(function (a, b) { return dist(a) - dist(b); }).slice(0, 200));
  tiers.push(pool.filter(function (g) { return !near(g); }).sort(function (a, b) { return dist(a) - dist(b); }).slice(0, 160));
  for (let i = 0; i < tiers.length; i++) {
    if (!tiers[i].length) continue;
    const hits = await scan(tiers[i], i === tiers.length - 1);
    if (hits.length) return hits.sort(rank)[0];
  }
  return null;
}

async function resolveIn(leg, games, hint, strict, lean) {
  const lgs = leaguesForLeg(leg, hint);
  if (hint && lgs && lgs.indexOf(hint) < 0) hint = null;   // e.g. labelled cfb but it is a 141.5 total: that's basketball
  const pool = lgs ? games.filter(function (g) { return lgs.indexOf(g.league) >= 0; }) : games;
  // does this name refer to one of the two teams in game g? (matching is done in the game's own league)
  const refers = function (name, g) { const a = name ? Teams.matchTeam(name, g.league, strict) : null; return !!a && (a === g.away.abbr || a === g.home.abbr); };
  const matchup = [leg.away_team, leg.home_team].filter(Boolean);
  let cands = [];
  if (matchup.length === 2) cands = pool.filter(function (g) { return matchup.every(function (n) { return refers(n, g); }); });
  // Both teams of the printed matchup in one game is the strongest clue there is. If no game in the labelled league has both
  // ("Ohio State @ BYU" labelled college football, but it is a basketball game), look in every league before settling for a game
  // that only has the one team (that is how BYU's basketball ML ended up in BYU–Utah football).
  if (!cands.length && matchup.length === 2) {
    cands = games.filter(function (g) { return matchup.every(function (n) { return refers(n, g); }); });
    // still nothing: one team matches and the other is a looser spelling of the opponent ("Seattle" for ESPN's "Seattle U")
    if (!cands.length) cands = games.filter(function (g) {
      // each printed name must point at a different team of the game, by its name or a looser spelling of it
      const sideOf = function (n) {
        const a = Teams.matchTeam(n, g.league, false);
        if (a === g.away.abbr || looseName(n, g.away)) return a === g.home.abbr ? 'both' : 'away';
        if (a === g.home.abbr || looseName(n, g.home)) return 'home';
        return null;
      };
      const x = sideOf(matchup[0]), y = sideOf(matchup[1]);
      return !!x && !!y && (x !== y || x === 'both');
    });
    if (cands.length && hint && cands.every(function (g) { return g.league !== hint; })) hint = null;
  }
  if (!cands.length && leg.team) cands = pool.filter(function (g) { return refers(leg.team, g); });
  if (!cands.length && matchup.length) cands = pool.filter(function (g) { return matchup.some(function (n) { return refers(n, g); }); });
  let game = pickGame(cands, leg);
  let team = game && leg.team ? (Teams.matchTeam(leg.team, game.league, strict) || null) : null;
  if (game && leg.team && (!team || (team !== game.away.abbr && team !== game.home.abbr))) {
    team = looseName(leg.team, game.away) ? game.away.abbr : looseName(leg.team, game.home) ? game.home.abbr : team;
  }

  if (!game && leg.player) {
    const hit = await findPlayerGame(leg, games, hint, lean);
    if (hit) { game = hit.game; team = hit.team; }
  }
  if (game && !team && leg.player && game.state !== 'pre') {
    try { const full = await getGame(game.id, game.league); const p = Stats.findPlayer(full.players, leg.player); if (p) team = p.team; } catch (e) { /* ignore */ }
  }
  if (game && leg.player) {   // the roster knows which side he is on better than the slip text does
    try { const actual = await playerTeamIn(game, leg.player); if (actual) team = actual; } catch (e) { /* keep the slip's team */ }
  }
  return { id: leg.id, gameId: game ? game.id : null, team: team, league: game ? game.league : null };
}

/* ---------------- OpenAI vision parsing ---------------- */
const STATS = ['passing_yards', 'passing_tds', 'passing_attempts', 'passing_completions', 'interceptions_thrown', 'longest_completion',
  'rushing_yards', 'rushing_attempts', 'rushing_tds', 'longest_rush', 'receiving_yards', 'receptions', 'receiving_tds',
  'longest_reception', 'receiving_targets', 'rush_rec_yards', 'pass_rush_yards', 'rush_rec_tds', 'total_tds', 'fantasy_points',
  'fg_made', 'fg_attempted', 'longest_fg', 'xp_made', 'kicking_points', 'tackles_assists', 'solo_tackles', 'sacks',
  'def_interceptions',
  'points', 'rebounds', 'assists', 'three_pointers_made', 'three_pointers_attempted', 'field_goals_made', 'field_goals_attempted', 'free_throws_made',
  'free_throws_attempted', 'steals', 'blocks', 'turnovers', 'steals_blocks', 'pts_reb', 'pts_ast', 'reb_ast', 'pts_reb_ast', 'offensive_rebounds',
  'defensive_rebounds', 'personal_fouls', 'minutes', 'double_double', 'triple_double',
  'hits', 'runs', 'rbis', 'home_runs', 'walks', 'batter_strikeouts', 'at_bats', 'hits_runs_rbis', 'singles', 'doubles', 'triples', 'total_bases', 'stolen_bases',
  'pitcher_strikeouts', 'pitching_outs', 'earned_runs', 'hits_allowed', 'walks_allowed', 'runs_allowed', 'pitches_thrown',
  'other'];

const NUM_OR_NULL = { type: ['number', 'null'] };
const STR_OR_NULL = { type: ['string', 'null'] };

const TOOL = {
  name: 'submit_bet',
  description: 'Submit the structured contents of the betting slip.',
  input_schema: {
    type: 'object',
    properties: {
      sportsbook: STR_OR_NULL,
      bet_type: { type: 'string', enum: ['parlay', 'same_game_parlay', 'single', 'round_robin', 'teaser', 'other'] },
      wager: Object.assign({ description: 'Stake/risk amount in dollars, number only.' }, NUM_OR_NULL),
      payout: Object.assign({ description: 'TOTAL return if the bet wins, including the stake (labels like Payout, Total Payout, To Pay, Returns). Null if the slip only shows profit.' }, NUM_OR_NULL),
      to_win: Object.assign({ description: 'Profit if the bet wins (label "To Win"/"Profit"). Null if not shown.' }, NUM_OR_NULL),
      total_odds: Object.assign({ description: 'Combined American odds as shown, e.g. "+1125".' }, STR_OR_NULL),
      slip_status: Object.assign({ description: 'open / won / lost / cashed out / void, as shown on the slip, else null.' }, STR_OR_NULL),
      warnings: { type: 'array', items: { type: 'string' }, description: 'Anything unreadable, ambiguous or possibly missing.' },
      legs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            raw_text: { type: 'string', description: 'The leg exactly as printed on the slip (one line).' },
            market: { type: 'string', enum: ['moneyline', 'spread', 'total', 'team_total', 'player_prop', 'anytime_td', 'first_td', 'last_td', 'first_basket', 'other'] },
            team: Object.assign({ description: 'moneyline/spread/team_total: the team bet on. player_prop/td: the player\'s team if shown or certain. Else null.' }, STR_OR_NULL),
            player: Object.assign({ description: 'Full player name as shown (keep initials if that is all the slip shows).' }, STR_OR_NULL),
            stat: { type: ['string', 'null'], enum: STATS.concat([null]), description: 'player_prop only. Use "other" if the stat is not in the list.' },
            side: { type: ['string', 'null'], enum: ['over', 'under', 'yes', null] },
            line: Object.assign({ description: 'Spread / run line: signed number for the team bet on (+7.5, -3, -1.5). Total/prop: the number. For "N+" ladder lines use over with line N-0.5.' }, NUM_OR_NULL),
            odds: Object.assign({ description: 'American odds for this leg if shown.' }, STR_OR_NULL),
            league: { type: ['string', 'null'], enum: ['nfl', 'cfb', 'nba', 'mlb', 'cbb', null], description: 'nfl = pro football. cfb = college football (NCAAF): college teams like Georgia, Ohio State, Notre Dame, rankings like "#5", or NCAAF/CFB labels. nba = pro basketball (Lakers, Celtics, ...). cbb = men\'s college basketball (NCAAB / NCAAM / CBB): college teams (Duke, Kansas, Gonzaga, UConn) in a basketball bet: game totals around 120-170, points/rebounds/assists props, "1st Half" markets, NCAAB labels. mlb = pro baseball (Yankees, Dodgers, ...). null if you cannot tell or the sport is not one of these. A slip usually stays in one league unless it is a mixed-sport parlay: if the other legs are clearly college, mark ambiguous ones (e.g. "S Carolina", "Texas") with that same college league (cfb for football, cbb for basketball).' },
            away_team: Object.assign({ description: 'Away team of the game this leg is in, if the matchup is shown.' }, STR_OR_NULL),
            home_team: Object.assign({ description: 'Home team of the game this leg is in, if the matchup is shown.' }, STR_OR_NULL),
            game_date: Object.assign({ description: 'ISO date (YYYY-MM-DD) of the game if the slip shows a date or day, else null.' }, STR_OR_NULL),
            period: { type: 'string', enum: ['full', '1h', '2h', 'q1', 'q2', 'q3', 'q4', 'f3', 'f5', 'f7', 'i1'], description: 'Default full. Football / basketball: 1st-half and quarter markets use the matching value. Baseball: "First 5 Innings" = f5 (also f3, f7), "1st Inning" (incl. NRFI / YRFI) = i1.' },
            fantasy_system: { type: ['string', 'null'], enum: ['dk', 'fd', 'ppr', 'half', 'std', null], description: 'fantasy_points only: DraftKings->dk, FanDuel->fd, otherwise ppr (basketball: anything that is not dk is scored the FanDuel / PrizePicks way).' },
            notes: STR_OR_NULL,
          },
          required: ['raw_text', 'market'],
        },
      },
    },
    required: ['bet_type', 'legs'],
  },
};

// Allow several separate bets in one screenshot (open-bets lists): same schema, nested once.
(function () {
  const single = JSON.parse(JSON.stringify(TOOL.input_schema));
  TOOL.input_schema.properties.additional_bets = {
    type: 'array', items: single,
    description: 'Other separate bets visible in the same screenshot, each with its own wager/payout/legs. Empty if there is only one bet.',
  };
})();

function systemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return [
    'You read screenshots of sports betting slips — NFL, college football (NCAAF / CFB), NBA and MLB — from ANY sportsbook or app (DraftKings, FanDuel, BetMGM, Caesars, ESPN BET, bet365, Hard Rock, Fanatics, PrizePicks/Underdog-style cards, paper tickets, etc.) in any layout, and return every leg through the submit_bet tool.',
    'Today is ' + today + '.',
    'Rules:',
    '- Extract EVERY leg. Never invent legs. If the slip states a leg count (e.g. "5 Leg Parlay") make sure you return that many; otherwise add a warning.',
    '- Set league on every leg: "cfb" for college football (college teams such as Georgia, Ohio State, Alabama; rankings like #5; NCAAF/CFB labels), "nfl" for pro football, "nba" for NBA basketball, "mlb" for MLB baseball. A slip can mix leagues. Use team names exactly as printed, without the ranking number. Sports we cannot track (NHL, college basketball, soccer, tennis, UFC, ...): still return the leg with league null and market "other", and add a warning.',
    '- College basketball (cbb) vs college football (cfb): the same schools play both (Duke, Texas, Kansas, Michigan). Decide by the bet itself: a total in the 100s, points / rebounds / assists / threes props or an NCAAB label is cbb; a total in the 30s-70s, TDs or yards is cfb. College basketball has two halves: "1st Half" = period 1h, "2nd Half" = 2h; there are no quarters.',
    '- Same-game parlays / bet builders: list each selection as its own leg, with the matchup on every leg.',
    '- Markets: moneyline; spread (point spread, or MLB run line — the line is signed for the team bet on); total = game over/under (points, or runs in baseball); team_total = one team\'s points/runs over/under; player_prop for every player stat; anytime_td / first_td / last_td for football scorer markets; first_basket for NBA "First Basket / First Field Goal" (player, side yes); period = 1h/2h/q1..q4 for half or quarter markets (football and basketball). Baseball: "First 5 Innings" / "1st 5" = period f5 (also f3, f7); "1st Inning" markets = period i1, and "Run in the 1st Inning" / YRFI = total over 0.5 with period i1, NRFI = total under 0.5 with period i1 (fill away_team and home_team if shown). Use "other" only when nothing fits and explain in notes.',
    '- Football player props: passing / rushing / receiving yards, TDs, receptions, kicking, defense, combined stats, fantasy points.',
    '- Basketball player props: points, rebounds, assists, three_pointers_made, steals, blocks, turnovers, pts_reb, pts_ast, reb_ast, pts_reb_ast (PRA), steals_blocks, field goals / free throws made or attempted, minutes, fantasy_points. "To record a double-double" => player_prop stat double_double, side yes (triple_double likewise).',
    '- Baseball hitter props: hits, runs, rbis, home_runs, walks, batter_strikeouts, total_bases, singles, doubles, triples, stolen_bases, hits_runs_rbis (Hits + Runs + RBIs). "To Hit a Home Run" => player_prop stat home_runs, side over, line 0.5. Pitcher props: pitcher_strikeouts, pitching_outs ("Outs Recorded"), earned_runs, hits_allowed, walks_allowed, runs_allowed, pitches_thrown. Never mix up a hitter\'s hits / walks / strikeouts with a pitcher\'s hits / walks allowed / strikeouts.',
    '- Ladder / alt lines like "100+ Receiving Yards", "25+ Points", "To Record 3+ Hits": side=over, line=N-0.5 (99.5, 24.5, 2.5). "To score 2+ TDs": player_prop, stat=total_tds, over 1.5.',
    '- "Anytime Touchdown Scorer" => market anytime_td, side yes. "Player to score 2+ touchdowns" => total_tds over 1.5.',
    '- When the slip shows when the game is (a date, "Today", "Tomorrow", a weekday, a start time), set game_date as YYYY-MM-DD from today\'s date. This matters in baseball and basketball, where the same teams can play on several days in a row.',
    '- Fix obvious OCR damage but never change numbers. Use full team names or nicknames exactly as shown.',
    '- Money: numbers only, no currency symbols. wager = stake/risk. payout = TOTAL return including stake. If the slip only gives "To Win" profit, put it in to_win and leave payout null.',
    '- Pick\'em / DFS cards (PrizePicks, Underdog, etc.): each pick is a leg; More/Higher = over, Less/Lower = under; wager = entry amount, payout = the payout/"to win" total shown.',
    '- Several images are consecutive, OVERLAPPING slices of one long screenshot (or different screenshots of the same slip). Never count a leg twice because it appears in the overlap; read the header (wager/payout) from whichever slice shows it.',
    '- If the screenshot shows several SEPARATE bets (e.g. an "Open Bets" list), put the first in the top-level fields and every other one in additional_bets. Legs of one parlay always stay together in one bet.',
    '- Totals: when a game total shows the matchup ("Raiders @ Browns" or "LV vs CLE"), fill away_team and home_team. Alternate spreads / alternate totals are ordinary spread / total legs with their own line.',
    '- DraftKings Predictions / "Pick Combo" and trade slips print each leg with the THRESHOLD as a big heading ("30+", "2+", "1+"), then the matchup, then "Player Stat" (e.g. "Jalen Coker Receiving Yards"). The heading is the line: raw_text = "30+ Jalen Coker Receiving Yards", side over, line 29.5. A heading with the player and stat below it is ONE leg, never two. Never leave the line empty on a prop; if a number is printed anywhere in the leg, it is the line.',
    '- Ticket-list / open-bets rows from offshore and book sites (a ticket id like "G14556079", a red amount, then another amount, and legs written "Football - Cleveland Browns vs Pittsburgh Steelers / Game / total player touchdowns / Jaylen Warren Over 0.5 +114"): the RED amount is the RISK (wager) and the amount after it is what it pays TO WIN (profit, put it in to_win and leave payout null). The names before "/ Game" are the matchup, away team first: away_team and home_team on that leg. The last number on the leg (+114, -126) is that leg\'s odds. Each ticket id is its own bet; one ticket can list several legs (a parlay). Never mix up the two money columns, even when the column headers are cut off.',
    '- "total player touchdowns" with "Over 0.5" is an anytime touchdown: market anytime_td, side yes, line null (raw_text keeps the printed text). "Over 1.5 total player touchdowns" is player_prop, stat total_tds, side over, line 1.5.',
    '- Team logos printed next to a name tell you which school or league it is: "Seattle" with a college logo (e.g. a red "SU") is Seattle U basketball, not the Seahawks. Set league from the logo when the text alone is ambiguous.',
    '- Live score boxes printed under a leg ("2nd Half 0:52", H1 / H2 / T columns, a running score) show how the game is going, NOT what was bet: period comes only from the market name ("1st Half Spread", "2nd Half Total"); a plain spread or "To Win" is period full.',
    '- Short team names on cards ("SAN FRAN", "RADF", "OSU") are abbreviations of the schools printed next to them; copy them as shown, and if the card also shows the full school name, use that.',
    '- If a field is not on the slip use null. Put anything uncertain in warnings.',
  ].join('\n');
}

/* Legs that need a number (a prop, total or spread line) but came back without one. */
function legsMissingLine(bet) {
  const out = [];
  const all = [bet].concat(Array.isArray(bet.additional_bets) ? bet.additional_bets : []);
  all.forEach(function (b) {
    ((b && b.legs) || []).forEach(function (l) {
      const needs = ['total', 'team_total', 'player_prop'].indexOf(l.market) >= 0 && l.side !== 'yes' && (l.line == null || l.line === 0);
      if (needs) out.push(l);
    });
  });
  return out;
}

/* The bettor's own note about a slip ("Seattle is college basketball vs Hawaii"): plain text, one paragraph, 300 characters at most. */
function cleanNote(n) { return String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300); }

async function parseSlip(images, userKey, userNote) {
  userNote = cleanNote(userNote);
  const first = await callModel(images, userKey, '', userNote);
  const missing = legsMissingLine(first);
  if (!missing.length) return first;
  // One more look, pointing at exactly what was missed: the line is the single most important number on a leg.
  log('parse_retry', { missing: missing.map(legBrief) });
  const note = 'Your previous answer left the line empty on these legs: ' + missing.map(function (l) { return (l.player || l.team || l.raw_text || 'leg') + (l.stat ? ' ' + l.stat : ''); }).join('; ') +
    '. Look at the screenshot again. Every leg prints its number: on DraftKings Predictions it is the big heading of the leg ("30+", "2+", "1+"), above the game and the "Player Stat" line, and "N+" means line N-0.5 with side over. Return the complete slip again with every line filled in.';
  try {
    const second = await callModel(images, userKey, note, userNote);
    if (legsMissingLine(second).length < missing.length) { log('parse_retry_better', { before: missing.length, after: legsMissingLine(second).length }); return second; }
  } catch (e) { log('parse_retry_failed', { error: String(e.message || e).slice(0, 200) }); }
  return first;
}

async function callModel(images, userKey, extraNote, userNote) {
  const key = userKey || process.env.OPENAI_API_KEY;
  if (!key) { const e = new Error('No OpenAI API key. Add OPENAI_API_KEY to the server environment or paste one in Settings.'); e.status = 401; throw e; }
  const content = [];
  images.forEach(function (im, i) {
    if (images.length > 1) content.push({ type: 'text', text: 'Image ' + (i + 1) + ' of ' + images.length + ' (overlapping slice of the same slip, top to bottom):' });
    content.push({ type: 'image_url', image_url: { url: 'data:' + im.mediaType + ';base64,' + im.data, detail: 'high' } });
  });
  if (userNote) content.push({ type: 'text', text: 'The bettor wrote this note about the slip. It is about THIS slip and comes from the person who placed it, so trust it over your own guesses for leagues, teams, matchups, dates or players the image leaves unclear (fill league, away_team, home_team and game_date from it where it applies). Never add legs that are not on the slip because of it. Note: "' + userNote.replace(/"/g, "'") + '"' });
  content.push({ type: 'text', text: 'Extract this bet slip with the submit_bet function.' + (extraNote ? ' ' + extraNote : '') });
  const openAITool = { type: 'function', function: { name: TOOL.name, description: TOOL.description, parameters: TOOL.input_schema, strict: false } };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: MODEL, max_tokens: 4096,
      messages: [{ role: 'system', content: systemPrompt() }, { role: 'user', content: content }],
      tools: [openAITool], tool_choice: { type: 'function', function: { name: TOOL.name } },
    }),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch (e) { j = null; }
  if (!res.ok) {
    const e = new Error((j && j.error && j.error.message) || ('OpenAI API error ' + res.status));
    e.status = res.status === 401 ? 401 : 502;
    throw e;
  }
  const choice = j && j.choices && j.choices[0];
  const call = choice && choice.message && (choice.message.tool_calls || []).find(function (c) { return c.type === 'function' && c.function && c.function.name === TOOL.name; });
  if (!call) throw new Error('The model did not return structured bet data. Try a clearer screenshot.');
  try { return JSON.parse(call.function.arguments); }
  catch (e) { throw new Error('OpenAI returned invalid structured bet data. Please retry the screenshot.'); }
}

/* ---------------- http plumbing ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on('data', function (c) { size += c.length; if (size > limit) { reject(Object.assign(new Error('Upload too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

// One slip image is one paid model call. 12 an hour was too low once a few people shared a wifi network (and a retry counts as a call), so the default is 80.
const PARSE_PER_HOUR = Math.max(5, parseInt(process.env.PARSE_PER_HOUR, 10) || 80);
// Lightweight in-memory limits to reduce accidental/public API abuse. These reset on restart.
const rateBuckets = new Map();
function rateLimit(req, res, key, max, windowMs) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.socket.remoteAddress || 'unknown';
  const id = key + ':' + ip;
  const now = Date.now();
  let b = rateBuckets.get(id);
  if (!b || now >= b.reset) b = { count: 0, reset: now + windowMs };
  b.count += 1; rateBuckets.set(id, b);
  if (b.count > max) {
    const secs = Math.max(1, Math.ceil((b.reset - now) / 1000));
    res.setHeader('retry-after', String(secs));
    log('rate_limited', { key: key, max: max, count: b.count, retry_s: secs });
    const what = key === 'parse' ? 'You have uploaded a lot of slips in the last hour. ' : 'Too many requests. ';
    send(res, 429, { error: what + 'Try again in about ' + Math.max(1, Math.ceil(secs / 60)) + ' min.' });
    return false;
  }
  return true;
}
// forget finished windows so the map cannot grow forever
setInterval(function () { const now = Date.now(); rateBuckets.forEach(function (b, k) { if (now >= b.reset) rateBuckets.delete(k); }); }, 10 * 60 * 1000).unref();

/* Push notifications (needs SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY on the server; otherwise inert). */
const notifier = Notify.create({ env: process.env, getGames: getGames, getGame: getGame, E: Evaluate });

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (p === '/api/parse' && req.method === 'POST' && !rateLimit(req, res, 'parse', PARSE_PER_HOUR, 60 * 60 * 1000)) return;
  if (p === '/api/resolve' && req.method === 'POST' && !rateLimit(req, res, 'resolve', 120, 60 * 60 * 1000)) return;
  if (p === '/api/config' && req.method === 'GET') return send(res, 200, { hasServerKey: !!process.env.OPENAI_API_KEY, model: MODEL, vapidPublicKey: notifier.publicKey });
  if (p === '/api/cron/check' && req.method === 'GET') {
    const secret = process.env.CRON_SECRET || '';
    if (!secret) return send(res, 403, { error: 'Set CRON_SECRET on the server to use this endpoint.' });
    if (url.searchParams.get('key') !== secret && req.headers['x-cron-key'] !== secret) return send(res, 403, { error: 'Wrong key.' });
    return send(res, 200, await notifier.tick());
  }
  if (p === '/api/push/test' && req.method === 'POST') {
    if (!rateLimit(req, res, 'pushtest', 10, 60 * 60 * 1000)) return;
    const body = JSON.parse(await readBody(req, 20e3) || '{}');
    if (!body.endpoint || typeof body.endpoint !== 'string') return send(res, 400, { error: 'Missing endpoint.' });
    const r = await notifier.sendTest(body.endpoint);
    return send(res, r.ok ? 200 : (r.status === 404 ? 404 : 502), r.ok ? { ok: true } : { error: r.text || 'Could not send.' });
  }
  if (p === '/api/log' && req.method === 'POST') {
    if (!rateLimit(req, res, 'clientlog', 120, 60 * 60 * 1000)) return;
    let b = {}; try { b = JSON.parse(await readBody(req, 12e3) || '{}'); } catch (e) { /* ignore */ }
    const ev = String(b.ev || '').replace(/[^a-z0-9_]/gi, '').slice(0, 40) || 'client';
    log('client_' + ev, { uid: String(b.uid || '').slice(0, 12) || undefined, ua: String(req.headers['user-agent'] || '').slice(0, 80), data: b.data });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/games' && req.method === 'GET') return send(res, 200, { games: await getGames() });
  if (p.startsWith('/api/game/') && req.method === 'GET') return send(res, 200, { game: await getGame(p.slice('/api/game/'.length), url.searchParams.get('league')) });
  if (p === '/api/resolve' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req, 2e6) || '{}');
    const games = await getGames();
    const legs = (body.legs || []).slice(0, 40), groups = new Map();
    legs.forEach(function (l) { const k = String(l.slip || ''); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); });
    const byId = {};
    for (const g of groups.values()) {
      let rs; try { rs = await resolveSlip(g, games); } catch (e) { log('resolve_error', { error: String(e.message || e).slice(0, 200) }); rs = []; for (const l of g) rs.push(await resolveLeg(l, games)); }
      rs.forEach(function (r) { byId[r.id] = r; });
    }
    const out = legs.map(function (l) { return byId[l.id]; });
    out.forEach(function (r, i) { log(r.gameId ? 'resolve' : 'resolve_miss', { leg: legBrief(legs[i]), gameId: r.gameId, team: r.team, league: r.league, via: r.via }); });
    return send(res, 200, { results: out });
  }
  if (p === '/api/parse' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req, 30e6) || '{}');
    const images = (body.images || []).slice(0, 12).filter(function (im) { return im && /^image\/(jpeg|png|webp)$/.test(im.mediaType) && im.data; });
    if (!images.length) return send(res, 400, { error: 'No usable image. Use a PNG, JPG or WebP screenshot.' });
    const t0 = Date.now();
    let bet;
    const note = cleanNote(body.note);
    try { bet = await parseSlip(images, req.headers['x-api-key'], note); }
    catch (e) { log('parse_error', { ms: Date.now() - t0, images: images.length, error: String(e.message || e).slice(0, 300) }); throw e; }
    const extra = Array.isArray(bet.additional_bets) ? bet.additional_bets : [];
    const allBets = [bet].concat(extra);
    allBets.forEach(function (b) {
      const legs = (b && b.legs) || [];
      const noLine = legs.filter(function (l) { return ['spread', 'total', 'team_total', 'player_prop'].indexOf(l.market) >= 0 && l.side !== 'yes' && (l.line == null || l.line === 0) && l.market !== 'spread'; }).length;
      log(noLine ? 'parse_missing_lines' : 'parse', { ms: Date.now() - t0, images: images.length, legs: legs.length, noLine: noLine, wager: b && b.wager, payout: b && b.payout, odds: b && b.total_odds, warnings: (b && b.warnings || []).slice(0, 4), legsDetail: legs.map(legBrief) });
    });
    delete bet.additional_bets;
    const bets = [bet].concat(extra.filter(function (b) { return b && Array.isArray(b.legs) && b.legs.length; }));
    return send(res, 200, { bet: bet, bets: bets });
  }
  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async function (req, res) {
  try {
    const requestOrigin = req.headers.origin || '';
    if (requestOrigin === ALLOWED_ORIGIN) {
      res.setHeader('access-control-allow-origin', ALLOWED_ORIGIN);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type, x-api-key');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const requestPath = new URL(req.url, 'http://localhost').pathname;
    if (requestPath === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); return res.end('ok'); }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (requestOrigin && requestOrigin !== ALLOWED_ORIGIN) return send(res, 403, { error: 'Origin not allowed' });
      return await handleApi(req, res, url);
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(file, function (err, data) {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || 'Server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, function () {
    console.log('\n  Parlay Tracker running →  http://localhost:' + PORT);
    console.log('  Model: ' + MODEL + '   OpenAI API key: ' + (process.env.OPENAI_API_KEY ? 'found in environment/.env' : 'NOT SET (paste one in Settings or add it to .env)'));
    console.log('  CORS origin: ' + ALLOWED_ORIGIN);
    console.log('  Push notifications: ' + (notifier.enabled ? 'ON (checking every minute)' : 'off (set SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)') + '\n');
    if (notifier.enabled) setInterval(function () { notifier.tick().then(function (r) { if (r && r.errors && r.errors.length) console.log('[push]', r.errors.join(' | ')); }); }, 60000).unref();
  });
}

module.exports = { notifier: notifier, server: server, resolveLeg: resolveLeg, resolveSlip: resolveSlip, pickGame: pickGame, parseSlip: parseSlip, TOOL: TOOL };
