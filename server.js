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
const LEAGUES = { nfl: { sport: 'football', path: 'nfl' }, cfb: { sport: 'football', path: 'college-football' }, nba: { sport: 'basketball', path: 'nba' }, mlb: { sport: 'baseball', path: 'mlb' } };
const LEAGUE_IDS = Object.keys(LEAGUES);
const isLeague = function (x) { return typeof x === 'string' && Object.prototype.hasOwnProperty.call(LEAGUES, x); };
const leagueUrl = function (base, lg) { return base + '/' + LEAGUES[lg].sport + '/' + LEAGUES[lg].path; };
const DAILY = { nba: true, mlb: true };     // leagues that play every day: "this week" means roughly yesterday to day after tomorrow
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

/* ---------------- leg -> game resolution ---------------- */
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

async function resolveLeg(leg, games) {
  const hint = isLeague(leg.league) ? leg.league : null;
  let res = await resolveIn(leg, games, hint);
  if (!res.gameId && hint) res = await resolveIn(leg, games, null, true);   // the league hint can be wrong — retry across every league, but only on exact names
  return res;
}

async function resolveIn(leg, games, hint, strict) {
  const pool = hint ? games.filter(function (g) { return g.league === hint; }) : games;
  // does this name refer to one of the two teams in game g? (matching is done in the game's own league)
  const refers = function (name, g) { const a = name ? Teams.matchTeam(name, g.league, strict) : null; return !!a && (a === g.away.abbr || a === g.home.abbr); };
  const matchup = [leg.away_team, leg.home_team].filter(Boolean);
  let cands = [];
  if (matchup.length === 2) cands = pool.filter(function (g) { return matchup.every(function (n) { return refers(n, g); }); });
  if (!cands.length && leg.team) cands = pool.filter(function (g) { return refers(leg.team, g); });
  if (!cands.length && matchup.length) cands = pool.filter(function (g) { return matchup.some(function (n) { return refers(n, g); }); });
  let game = pickGame(cands, leg);
  let team = game && leg.team ? (Teams.matchTeam(leg.team, game.league, strict) || null) : null;

  if (!game && leg.player) {
    // Find the player when the slip shows no matchup: box scores of live/final games, rosters of upcoming ones.
    // College has ~60 games a week, so only the current week is scanned, a few games at a time.
    const order = pool.filter(function (g) { return g.thisWeek; }).slice(0, 160);
    const check = async function (g) {
      if (g.state === 'pre') {
        for (const side of [g.away, g.home]) {
          const roster = await getRoster(side.id, g.league);
          if (Stats.findPlayer(roster, leg.player)) return { game: g, team: side.abbr };
        }
        return null;
      }
      const full = await getGame(g.id, g.league);
      const p = Stats.findPlayer(full.players, leg.player);
      return p ? { game: g, team: p.team } : null;
    };
    for (let i = 0; i < order.length && !game; i += 8) {
      const found = await Promise.all(order.slice(i, i + 8).map(function (g) { return check(g).catch(function () { return null; }); }));
      const hitOne = found.find(Boolean);
      if (hitOne) { game = hitOne.game; team = hitOne.team; }
    }
  }
  if (game && !team && leg.player && game.state !== 'pre') {
    try { const full = await getGame(game.id, game.league); const p = Stats.findPlayer(full.players, leg.player); if (p) team = p.team; } catch (e) { /* ignore */ }
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
            league: { type: ['string', 'null'], enum: ['nfl', 'cfb', 'nba', 'mlb', null], description: 'nfl = pro football. cfb = college football (NCAAF): college teams like Georgia, Ohio State, Notre Dame, rankings like "#5", or NCAAF/CFB labels. nba = pro basketball (Lakers, Celtics, ...). mlb = pro baseball (Yankees, Dodgers, ...). null if you cannot tell or the sport is not one of these. A slip usually stays in one league unless it is a mixed-sport parlay: if the other legs are clearly college, mark ambiguous ones (e.g. "S Carolina", "Texas") cfb too.' },
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
    '- If a field is not on the slip use null. Put anything uncertain in warnings.',
  ].join('\n');
}

async function parseSlip(images, userKey) {
  const key = userKey || process.env.OPENAI_API_KEY;
  if (!key) { const e = new Error('No OpenAI API key. Add OPENAI_API_KEY to the server environment or paste one in Settings.'); e.status = 401; throw e; }
  const content = [];
  images.forEach(function (im, i) {
    if (images.length > 1) content.push({ type: 'text', text: 'Image ' + (i + 1) + ' of ' + images.length + ' (overlapping slice of the same slip, top to bottom):' });
    content.push({ type: 'image_url', image_url: { url: 'data:' + im.mediaType + ';base64,' + im.data, detail: 'high' } });
  });
  content.push({ type: 'text', text: 'Extract this bet slip with the submit_bet function.' });
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
    res.setHeader('retry-after', String(Math.max(1, Math.ceil((b.reset - now) / 1000))));
    send(res, 429, { error: 'Too many requests. Please wait a bit and try again.' });
    return false;
  }
  return true;
}

/* Push notifications (needs SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY on the server; otherwise inert). */
const notifier = Notify.create({ env: process.env, getGames: getGames, getGame: getGame, E: Evaluate });

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (p === '/api/parse' && req.method === 'POST' && !rateLimit(req, res, 'parse', 12, 60 * 60 * 1000)) return;
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
  if (p === '/api/games' && req.method === 'GET') return send(res, 200, { games: await getGames() });
  if (p.startsWith('/api/game/') && req.method === 'GET') return send(res, 200, { game: await getGame(p.slice('/api/game/'.length), url.searchParams.get('league')) });
  if (p === '/api/resolve' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req, 2e6) || '{}');
    const games = await getGames();
    const out = [];
    for (const leg of (body.legs || []).slice(0, 40)) out.push(await resolveLeg(leg, games));
    return send(res, 200, { results: out });
  }
  if (p === '/api/parse' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req, 30e6) || '{}');
    const images = (body.images || []).slice(0, 12).filter(function (im) { return im && /^image\/(jpeg|png|webp)$/.test(im.mediaType) && im.data; });
    if (!images.length) return send(res, 400, { error: 'No usable image. Use a PNG, JPG or WebP screenshot.' });
    const bet = await parseSlip(images, req.headers['x-api-key']);
    const extra = Array.isArray(bet.additional_bets) ? bet.additional_bets : [];
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

module.exports = { notifier: notifier, server: server, resolveLeg: resolveLeg, pickGame: pickGame, parseSlip: parseSlip, TOOL: TOOL };