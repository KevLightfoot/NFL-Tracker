#!/usr/bin/env node
'use strict';
/*
 * Parlay Tracker server — zero dependencies (Node 18+).
 *   POST /api/parse    screenshot(s) -> structured bet (OpenAI vision)
 *   GET  /api/config   {hasServerKey, model}
 *   GET  /api/games    NFL games (scoreboard, ~3 weeks window)
 *   GET  /api/game/:id live box score + scoring plays for one game
 *   POST /api/resolve  find the game (and team) for each leg
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const Teams = require('./public/lib/teams.js');
const Stats = require('./public/lib/stats.js');

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
const APP_PASSWORD = process.env.APP_PASSWORD || ''; 
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const ESPN_ALT = 'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl';
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
    const urls = [ESPN + '/scoreboard?limit=100', ESPN + '/scoreboard?dates=' + day(-10) + '-' + day(14) + '&limit=300'];
    const rs = await Promise.allSettled(urls.map(getJSON));
    const byId = new Map(), thisWeek = new Set();
    rs.forEach(function (r, i) {
      if (r.status !== 'fulfilled') return;
      (r.value.events || []).forEach(function (ev) {
        const g = Stats.normalizeEvent(ev);
        if (!g.away || !g.home) return;
        byId.set(g.id, g);
        if (i === 0) thisWeek.add(g.id);
      });
    });
    if (!byId.size) throw new Error('Could not reach the ESPN scoreboard (' + (rs[0].reason && rs[0].reason.message || 'no data') + ')');
    return Array.from(byId.values())
      .map(function (g) { g.thisWeek = thisWeek.has(g.id); return g; })
      .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
  });
}

async function getGame(id) {
  id = String(id).replace(/[^0-9a-zA-Z_-]/g, '');
  const hit = cache.get('g' + id);
  if (hit && hit.exp > Date.now()) return hit.val;
  let j;
  try { j = await getJSON(ESPN + '/summary?event=' + id); }
  catch (e) { j = await getJSON(ESPN_ALT + '/summary?event=' + id); }
  const g = Stats.normalizeSummary(j, id);
  // The summary header sometimes lacks period/clock/linescores; backfill from the (cached) scoreboard.
  try {
    const sb = (await getGames()).find(function (x) { return x.id === g.id; });
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

async function getRoster(teamId) {
  return cached('roster' + teamId, 12 * 3600 * 1000, async function () {
    const j = await getJSON(ESPN + '/teams/' + teamId + '/roster');
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
      const d = new Date(g.date);
      const et = new Date(d.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10); // rough ET
      return d.toISOString().slice(0, 10) === want || et === want;
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
  const abbrs = [leg.away_team, leg.home_team].map(Teams.matchTeam).filter(Boolean);
  const teamHint = Teams.matchTeam(leg.team);
  let cands = [];
  if (abbrs.length === 2) cands = games.filter(function (g) { return abbrs.every(function (a) { return a === g.away.abbr || a === g.home.abbr; }); });
  if (!cands.length && teamHint) cands = games.filter(function (g) { return g.away.abbr === teamHint || g.home.abbr === teamHint; });
  if (!cands.length && abbrs.length) cands = games.filter(function (g) { return abbrs.some(function (a) { return a === g.away.abbr || a === g.home.abbr; }); });
  let game = pickGame(cands, leg);
  let team = teamHint || null;

  if (!game && leg.player) {
    // search by player: box scores of live/final games, rosters of upcoming games
    const order = games.filter(function (g) { return g.thisWeek; }).concat(games.filter(function (g) { return !g.thisWeek; }));
    for (let i = 0; i < order.length && !game; i++) {
      const g = order[i];
      try {
        if (g.state === 'pre') {
          for (const side of [g.away, g.home]) {
            const roster = await getRoster(side.id);
            if (Stats.findPlayer(roster, leg.player)) { game = g; team = side.abbr; break; }
          }
        } else {
          const full = await getGame(g.id);
          const p = Stats.findPlayer(full.players, leg.player);
          if (p) { game = g; team = p.team; }
        }
      } catch (e) { /* skip this game */ }
    }
  }
  if (game && !team && leg.player && game.state !== 'pre') {
    try { const full = await getGame(game.id); const p = Stats.findPlayer(full.players, leg.player); if (p) team = p.team; } catch (e) { /* ignore */ }
  }
  return { id: leg.id, gameId: game ? game.id : null, team: team };
}

/* ---------------- OpenAI vision parsing ---------------- */
const STATS = ['passing_yards', 'passing_tds', 'passing_attempts', 'passing_completions', 'interceptions_thrown', 'longest_completion',
  'rushing_yards', 'rushing_attempts', 'rushing_tds', 'longest_rush', 'receiving_yards', 'receptions', 'receiving_tds',
  'longest_reception', 'receiving_targets', 'rush_rec_yards', 'pass_rush_yards', 'rush_rec_tds', 'total_tds', 'fantasy_points',
  'fg_made', 'fg_attempted', 'longest_fg', 'xp_made', 'kicking_points', 'tackles_assists', 'solo_tackles', 'sacks',
  'def_interceptions', 'other'];

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
            market: { type: 'string', enum: ['moneyline', 'spread', 'total', 'team_total', 'player_prop', 'anytime_td', 'first_td', 'last_td', 'other'] },
            team: Object.assign({ description: 'moneyline/spread/team_total: the team bet on. player_prop/td: the player\'s team if shown or certain. Else null.' }, STR_OR_NULL),
            player: Object.assign({ description: 'Full player name as shown (keep initials if that is all the slip shows).' }, STR_OR_NULL),
            stat: { type: ['string', 'null'], enum: STATS.concat([null]), description: 'player_prop only. Use "other" if the stat is not in the list.' },
            side: { type: ['string', 'null'], enum: ['over', 'under', 'yes', null] },
            line: Object.assign({ description: 'Spread: signed number for the team bet on (+7.5, -3). Total/prop: the number. For "N+" ladder lines use over with line N-0.5.' }, NUM_OR_NULL),
            odds: Object.assign({ description: 'American odds for this leg if shown.' }, STR_OR_NULL),
            away_team: Object.assign({ description: 'Away team of the game this leg is in, if the matchup is shown.' }, STR_OR_NULL),
            home_team: Object.assign({ description: 'Home team of the game this leg is in, if the matchup is shown.' }, STR_OR_NULL),
            game_date: Object.assign({ description: 'ISO date (YYYY-MM-DD) of the game if the slip shows a date or day, else null.' }, STR_OR_NULL),
            period: { type: 'string', enum: ['full', '1h', '2h', 'q1', 'q2', 'q3', 'q4'], description: 'Default full. 1st-half / quarter markets use the matching value.' },
            fantasy_system: { type: ['string', 'null'], enum: ['dk', 'fd', 'ppr', 'half', 'std', null], description: 'fantasy_points only: DraftKings->dk, FanDuel->fd, otherwise ppr.' },
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
    'You read screenshots of NFL betting slips from ANY sportsbook or app (DraftKings, FanDuel, BetMGM, Caesars, ESPN BET, bet365, Hard Rock, Fanatics, PrizePicks/Underdog-style cards, paper tickets, etc.) in any layout, and return every leg through the submit_bet tool.',
    'Today is ' + today + '.',
    'Rules:',
    '- Extract EVERY leg. Never invent legs. If the slip states a leg count (e.g. "5 Leg Parlay") make sure you return that many; otherwise add a warning.',
    '- Same-game parlays / bet builders: list each selection as its own leg, with the matchup on every leg.',
    '- Markets: moneyline; spread (line is signed for the team bet on); total = game over/under; team_total = one team\'s points over/under; player_prop for every player stat (passing, rushing, receiving, receptions, fantasy points, kicking, defense, combined stats); anytime_td / first_td / last_td for scorer markets; period = 1h/2h/q1..q4 for half or quarter markets. Use "other" only when nothing fits and explain in notes.',
    '- Ladder / alt lines like "100+ Receiving Yards" or "To Record 3+ Receptions": side=over, line=N-0.5 (99.5, 2.5). "To score 2+ TDs": player_prop, stat=total_tds, over 1.5.',
    '- "Anytime Touchdown Scorer" => market anytime_td, side yes. "Player to score 2+ touchdowns" => total_tds over 1.5.',
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

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (p === '/api/config' && req.method === 'GET') return send(res, 200, { hasServerKey: !!process.env.OPENAI_API_KEY, model: MODEL });
  if (p === '/api/games' && req.method === 'GET') return send(res, 200, { games: await getGames() });
  if (p.startsWith('/api/game/') && req.method === 'GET') return send(res, 200, { game: await getGame(p.slice('/api/game/'.length)) });
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
    // Optional HTTP Basic Auth protects a public personal deployment and its paid API key.
    const requestPath = new URL(req.url, 'http://localhost').pathname;
    if (requestPath === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); return res.end('ok'); }
    if (APP_PASSWORD) {
      const auth = req.headers.authorization || '';
      const match = auth.match(/^Basic\s+(.+)$/i);
      let supplied = '';
      try { supplied = match ? Buffer.from(match[1], 'base64').toString('utf8').split(':').slice(1).join(':') : ''; } catch (e) { supplied = ''; }
      const a = Buffer.from(supplied), b = Buffer.from(APP_PASSWORD);
      const crypto = require('crypto');
      if (!match || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm=\"Parlay Tracker\", charset=\"UTF-8\"', 'Cache-Control': 'no-store' });
        return res.end('Password required');
      }
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
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
    console.log('  Access password: ' + (APP_PASSWORD ? 'enabled' : 'disabled (set APP_PASSWORD when publicly hosted)') + '\n');
  });
}

module.exports = { server: server, resolveLeg: resolveLeg, pickGame: pickGame, parseSlip: parseSlip, TOOL: TOOL };
