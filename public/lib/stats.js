/* ESPN payload normalisation, player-name matching and stat extraction (NFL, college football, NBA, MLB). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./teams.js'));
  else root.NFLStats = factory(root.NFLTeams);
})(typeof self !== 'undefined' ? self : this, function (Teams) {
  function n(x) {
    if (x == null) return 0;
    const v = typeof x === 'number' ? x : parseFloat(String(x).replace(/,/g, ''));
    return isFinite(v) ? v : 0;
  }

  /* ---------- player names ---------- */
  function normName(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[.'’`]/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function lev(a, b) {
    const m = a.length, k = b.length;
    if (!m) return k;
    if (!k) return m;
    let prev = new Array(k + 1), cur = new Array(k + 1);
    for (let j = 0; j <= k; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= k; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[k];
  }

  /* items: array of objects with a .name. Returns best match or null. */
  function findPlayer(items, query, teamAbbr) {
    const q = normName(query);
    if (!q || !items || !items.length) return null;
    let pool = items;
    if (teamAbbr) {
      const t = pool.filter(function (p) { return p.team === teamAbbr; });
      if (t.length) pool = t;
    }
    const withNorm = pool.map(function (p) { return { p: p, nn: normName(p.name) }; });
    let hit = withNorm.filter(function (x) { return x.nn === q; });
    if (hit.length) return hit[0].p;

    const qt = q.split(' ');
    const qLast = qt[qt.length - 1];
    const qFirst = qt.length > 1 ? qt[0] : '';

    // last name + first initial ("N. Collins", "Nico Collins")
    if (qFirst) {
      hit = withNorm.filter(function (x) {
        const t = x.nn.split(' ');
        return t[t.length - 1] === qLast && t[0][0] === qFirst[0];
      });
      if (hit.length === 1) return hit[0].p;
      if (hit.length > 1) {
        const sameFirst = hit.filter(function (x) { return x.nn.split(' ')[0] === qFirst; });
        if (sameFirst.length === 1) return sameFirst[0].p;
      }
    } else {
      hit = withNorm.filter(function (x) { const t = x.nn.split(' '); return t[t.length - 1] === qLast; });
      if (hit.length === 1) return hit[0].p;
    }

    // typo tolerance on the whole name
    if (q.length >= 6) {
      let best = null, bestD = 99, tie = false;
      withNorm.forEach(function (x) {
        const d = lev(q, x.nn);
        if (d < bestD) { best = x.p; bestD = d; tie = false; } else if (d === bestD) tie = true;
      });
      if (best && bestD <= 2 && !tie) return best;
    }
    return null;
  }

  /* ---------- ESPN parsing ---------- */
  const LEAGUES = ['nfl', 'cfb', 'nba', 'mlb'];
  const SPORT = { nfl: 'football', cfb: 'football', nba: 'basketball', mlb: 'baseball' };
  function cleanLeague(l) { return LEAGUES.indexOf(l) >= 0 ? l : 'nfl'; }
  // Pro abbreviations are normalised to our tables (WAS->WSH, GSW->GS); college abbreviations are used exactly as ESPN sends them.
  function canonAbbr(a, league) {
    if (league === 'cfb') return a || '';
    if (league === 'nba' || league === 'mlb') return Teams.matchTeam(a, league, true) || a || '';
    return Teams.matchTeam(a, 'nfl') || a || '';
  }

  /* ---- basketball / baseball box-score lines (labels differ from football; "10-20" means made-attempted) ---- */
  const HOOPS_KEY = {
    min: 'min', minutes: 'min', pts: 'pts', points: 'pts', fg: 'fg', fieldgoals: 'fg', fieldgoalsmadefieldgoalsattempted: 'fg',
    '3pt': 'tp', threepointfieldgoalsmadethreepointfieldgoalsattempted: 'tp', threepointers: 'tp', ft: 'ft', freethrows: 'ft', freethrowsmadefreethrowsattempted: 'ft',
    reb: 'reb', rebounds: 'reb', ast: 'ast', assists: 'ast', to: 'to', tov: 'to', turnovers: 'to', stl: 'stl', steals: 'stl', blk: 'blk', blocks: 'blk',
    oreb: 'oreb', offensiverebounds: 'oreb', dreb: 'dreb', defensiverebounds: 'dreb', pf: 'pf', fouls: 'pf', personalfouls: 'pf', '+/-': 'pm', plusminus: 'pm',
  };
  function num0(s) { const v = parseFloat(String(s == null ? '' : s).replace(/[^0-9.\-]/g, '')); return isFinite(v) ? v : 0; }
  function parseHoops(labels, stats) {
    const o = {};
    (labels || []).forEach(function (label, i) {
      const raw = stats ? stats[i] : null; if (raw == null) return;
      const key = HOOPS_KEY[String(label).toLowerCase().replace(/\s+/g, '')] || HOOPS_KEY[String(label).toLowerCase().replace(/[^a-z0-9+\/-]/g, '')];
      if (!key) return;
      const s = String(raw).trim(); let m;
      if ((m = s.match(/^(\d+)\s*[-\/]\s*(\d+)$/))) { o[key + '_m'] = +m[1]; o[key + '_a'] = +m[2]; }
      else o[key] = num0(s);
    });
    return o;
  }
  function parseBase(labels, stats) {
    const o = {};
    (labels || []).forEach(function (label, i) {
      const raw = stats ? stats[i] : null; if (raw == null) return;
      const lab = String(label).toLowerCase().replace(/[^a-z0-9#-]+/g, ''), s = String(raw).trim(); let m;
      if (lab === 'h-ab') { if ((m = s.match(/^(\d+)\s*-\s*(\d+)$/))) { if (o.h == null) o.h = +m[1]; if (o.ab == null) o.ab = +m[2]; } return; }
      if (lab === 'pc-st') { if ((m = s.match(/^(\d+)\s*-\s*(\d+)$/))) { if (o.pc == null) o.pc = +m[1]; o.st = +m[2]; } return; }
      const key = lab === 'so' ? 'k' : lab === '#p' ? 'p' : lab.replace(/[^a-z0-9]/g, '');
      if (!key) return;
      if (key === 'ip') { const parts = s.split('.'); o.ip = num0(s); o.outs = (parseInt(parts[0], 10) || 0) * 3 + (parseInt(parts[1], 10) || 0); }
      else o[key] = num0(s);
    });
    return o;
  }
  function baseCat(cat, labels) {
    const nm = String(cat.type || cat.name || '').toLowerCase();
    if (/pitch/.test(nm)) return 'pitching';
    if (/bat/.test(nm)) return 'batting';
    return (labels || []).some(function (l) { return String(l).toUpperCase() === 'IP'; }) ? 'pitching' : 'batting';
  }

  function parseStatLine(labels, stats) {
    const o = {};
    (labels || []).forEach(function (label, i) {
      const raw = stats ? stats[i] : null;
      if (raw == null) return;
      const key = String(label).toLowerCase().replace(/[^a-z0-9/]+/g, '_').replace(/^_|_$/g, '');
      const s = String(raw).trim();
      let m;
      if ((m = s.match(/^(\d+)\/(\d+)$/))) { o[key + '_made'] = +m[1]; o[key + '_att'] = +m[2]; }
      else if ((m = s.match(/^(\d+)-(\d+)$/))) { o[key + '_n'] = +m[1]; o[key + '_yds'] = +m[2]; }
      else if ((m = s.match(/^(-?\d+(?:\.\d+)?)%?$/))) o[key] = +m[1];
      else o[key] = s;
    });
    return o;
  }

  function teamBlock(c, league) {
    const t = c.team || {};
    const ls = (c.linescores || []).map(function (l) { return n(l.displayValue != null ? l.displayValue : l.value); });
    return {
      id: String(t.id == null ? '' : t.id),
      abbr: canonAbbr(t.abbreviation, league),
      name: t.displayName || t.name || '',
      short: t.shortDisplayName || '', nick: t.name || '', location: t.location || '',
      score: n(c.score != null && typeof c.score === 'object' ? c.score.displayValue : c.score),
      linescores: ls,
    };
  }

  function statusBlock(status) {
    status = status || {};
    const type = status.type || {};
    return {
      state: type.state || 'pre',
      completed: !!type.completed,
      detail: type.shortDetail || type.detail || '',
      period: n(status.period),
      clock: status.displayClock || '',
    };
  }

  /* scoreboard event -> game (no players) */
  function normalizeEvent(ev, league) {
    league = cleanLeague(league);
    const comp = (ev.competitions || [])[0] || {};
    const st = statusBlock(ev.status || comp.status);
    const g = { id: String(ev.id), league: league, date: ev.date || comp.date || null, name: ev.shortName || ev.name || '', players: [], scoringPlays: [] };
    Object.assign(g, st);
    (comp.competitors || []).forEach(function (c) { g[c.homeAway] = teamBlock(c, league); });
    Teams.registerGame(g);
    return g;
  }

  /* Singles / doubles / triples / steals aren't columns in ESPN's MLB box score, so they're counted from the play-by-play.
     ESPN lists each of them twice: a pitch-level play (type "Single", text "Pitch 3 : Ball In Play", with the batter attached) and a
     "Play Result" sentence ("Yelich singled to left."). Both are read separately and, per player, the one that adds up to the box
     score's hit count wins, so nothing is ever counted twice. g.hasPlays stays false when the feed has no plays at all, and those
     stats then fall back to manual entry. */
  function attachBaseEvents(g, j) {
    const plays = Array.isArray(j.plays) ? j.plays : [];
    g.hasPlays = plays.length > 0;
    if (!g.hasPlays) return;
    const byId = {}, A = {}, B = {}, seen = {}, NAME = /^(.+?)\s+(?:singled|doubled|tripled|stole|hit\b|ground)/i;
    let typedSteals = 0;
    g.players.forEach(function (p) { if (p.id) byId[p.id] = p; });
    const keyOf = function (p) { return p.team + '|' + (p.id || p.name); };
    const add = function (bag, p, kind) { if (!p) return; const o = (bag[keyOf(p)] = bag[keyOf(p)] || { s: 0, d: 0, t: 0, sb: 0 }); o[kind]++; };
    plays.forEach(function (pl) {
      if (!pl) return;
      if (pl.id != null) { if (seen[pl.id]) return; seen[pl.id] = true; }
      const text = String(pl.text || pl.shortText || '');
      const type = String((pl.type && (pl.type.text || pl.type.type)) || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const typed = { single: 's', double: 'd', triple: 't', 'stolen base': 'sb' }[type];
      if (typed) {
        const want = typed === 'sb' ? /run/i : /bat/i;
        const part = (pl.participants || []).find(function (x) { return x && want.test(String(x.type || x.role || '')); });
        const pid = part && ((part.athlete && part.athlete.id) || part.id);
        let p = pid != null ? byId[String(pid)] : null;
        if (!p) { const m = text.match(NAME); if (m) p = findPlayer(g.players, m[1].trim()); }
        if (typed === 'sb') typedSteals++;
        add(A, p, typed);
        return;
      }
      let kind = null;
      if (/\bsingled\b/i.test(text)) kind = 's';
      else if (/\bdoubled\b/i.test(text) && !/doubled off/i.test(text)) kind = 'd';
      else if (/\btripled\b/i.test(text)) kind = 't';
      else if (/\bstole\b/i.test(text) && !/caught stealing/i.test(text)) kind = 'sb';
      if (!kind) return;
      const m = text.match(NAME);
      add(B, m ? findPlayer(g.players, m[1].trim()) : null, kind);
    });
    const zero = { s: 0, d: 0, t: 0, sb: 0 };
    g.players.forEach(function (p) {
      const a = A[keyOf(p)] || zero, b = B[keyOf(p)] || zero, bat = (p.stats && p.stats.batting) || {}, need = n(bat.h) - n(bat.hr);
      const fits = function (x) { return x.s + x.d + x.t === need; };
      const pick = fits(a) ? a : fits(b) ? b : a;
      p.ev = { s: pick.s, d: pick.d, t: pick.t, sb: typedSteals ? a.sb : b.sb };
    });
  }

  /* summary payload -> game with players + scoring plays */
  function normalizeSummary(j, idHint, league) {
    league = cleanLeague(league);
    const sport = SPORT[league];
    const hdr = j.header || {};
    const comp = (hdr.competitions || [])[0] || {};
    const st = statusBlock(comp.status);
    const g = { id: String(hdr.id || idHint || ''), league: league, date: comp.date || null, name: '', players: [], scoringPlays: [] };
    Object.assign(g, st);
    // lets the server backfill status from the scoreboard when the summary header omits it
    g.hasStatus = !!(comp.status && comp.status.type && comp.status.type.state);
    const byTeamId = {};
    (comp.competitors || []).forEach(function (c) {
      const tb = teamBlock(c, league);
      g[c.homeAway] = tb;
      byTeamId[tb.id] = tb.abbr;
    });
    if (g.away && g.home) g.name = g.away.abbr + ' @ ' + g.home.abbr;
    Teams.registerGame(g);

    const idx = {};
    ((j.boxscore || {}).players || []).forEach(function (tb) {
      const t = tb.team || {};
      const abbr = canonAbbr(t.abbreviation, league) || byTeamId[String(t.id)] || '';
      (tb.statistics || []).forEach(function (cat) {
        const labels = cat.labels && cat.labels.length ? cat.labels : (cat.names || cat.keys);
        const catName = sport === 'football' ? cat.name : sport === 'basketball' ? 'box' : baseCat(cat, labels);
        const parse = sport === 'football' ? parseStatLine : sport === 'basketball' ? parseHoops : parseBase;
        (cat.athletes || []).forEach(function (a) {
          const ath = a.athlete || {};
          const nm = ath.displayName || ath.fullName || ath.shortName;
          if (!nm) return;
          if (sport !== 'football' && (a.didNotPlay || !a.stats || !a.stats.length)) return;   // bench players who haven't played
          const key = abbr + '|' + (ath.id || normName(nm));
          if (!idx[key]) { idx[key] = { id: String(ath.id || ''), name: nm, team: abbr, stats: {} }; g.players.push(idx[key]); }
          idx[key].stats[catName] = parse(labels, a.stats);
        });
      });
    });
    if (sport === 'baseball') attachBaseEvents(g, j);

    if (sport === 'basketball') {
      // only the first few baskets matter ("first basket" markets); keep the payload small
      (j.plays || []).filter(function (pl) { return pl && pl.scoringPlay; }).slice(0, 4).forEach(function (pl) {
        const tid = pl.team && pl.team.id != null ? String(pl.team.id) : '';
        g.scoringPlays.push({
          text: pl.text || '', type: (pl.type && (pl.type.text || pl.type.abbreviation)) || '', team: byTeamId[tid] || '',
          period: pl.period && pl.period.number != null ? pl.period.number : n(pl.period),
          clock: pl.clock && pl.clock.displayValue ? pl.clock.displayValue : '', awayScore: n(pl.awayScore), homeScore: n(pl.homeScore),
        });
      });
    }
    (j.scoringPlays || []).forEach(function (sp) {
      const tid = sp.team && sp.team.id != null ? String(sp.team.id) : '';
      g.scoringPlays.push({
        text: sp.text || '',
        type: (sp.type && (sp.type.text || sp.type.abbreviation)) || '',
        team: byTeamId[tid] || canonAbbr(sp.team && sp.team.abbreviation, league) || '',
        period: sp.period && sp.period.number != null ? sp.period.number : n(sp.period),
        clock: sp.clock && sp.clock.displayValue ? sp.clock.displayValue : '',
        awayScore: n(sp.awayScore),
        homeScore: n(sp.homeScore),
      });
    });
    return g;
  }

  /* ---------- stat extraction ---------- */
  function cat(p, name) { return (p && p.stats && p.stats[name]) || {}; }

  function returnTds(p) { return n(cat(p, 'kickReturns').td) + n(cat(p, 'puntReturns').td); }
  function totalTds(p) {
    return n(cat(p, 'rushing').td) + n(cat(p, 'receiving').td) + returnTds(p) + n(cat(p, 'interceptions').td) + n(cat(p, 'defensive').td);
  }

  function fantasyPoints(p, sys) {
    const pa = cat(p, 'passing'), ru = cat(p, 'rushing'), re = cat(p, 'receiving'), fu = cat(p, 'fumbles');
    sys = sys || 'ppr';
    const ppr = sys === 'half' || sys === 'fd' ? 0.5 : sys === 'std' ? 0 : 1;
    const pY = n(pa.yds), rY = n(ru.yds), cY = n(re.yds);
    let pts = pY * 0.04 + n(pa.td) * 4 - n(pa.int);
    pts += rY * 0.1 + n(ru.td) * 6;
    pts += cY * 0.1 + n(re.rec) * ppr + n(re.td) * 6;
    pts += returnTds(p) * 6;
    pts -= n(fu.lost) * (sys === 'fd' ? 2 : 1);
    if (sys === 'dk') {
      if (pY >= 300) pts += 3;
      if (rY >= 100) pts += 3;
      if (cY >= 100) pts += 3;
    }
    return Math.round(pts * 100) / 100;
  }

  const STAT_FN = {
    passing_yards: function (p) { return n(cat(p, 'passing').yds); },
    passing_tds: function (p) { return n(cat(p, 'passing').td); },
    passing_attempts: function (p) { return n(cat(p, 'passing')['c/att_att']); },
    passing_completions: function (p) { return n(cat(p, 'passing')['c/att_made']); },
    interceptions_thrown: function (p) { return n(cat(p, 'passing').int); },
    rushing_yards: function (p) { return n(cat(p, 'rushing').yds); },
    rushing_attempts: function (p) { return n(cat(p, 'rushing').car); },
    rushing_tds: function (p) { return n(cat(p, 'rushing').td); },
    longest_rush: function (p) { return n(cat(p, 'rushing').long); },
    receiving_yards: function (p) { return n(cat(p, 'receiving').yds); },
    receptions: function (p) { return n(cat(p, 'receiving').rec); },
    receiving_tds: function (p) { return n(cat(p, 'receiving').td); },
    longest_reception: function (p) { return n(cat(p, 'receiving').long); },
    receiving_targets: function (p) { return n(cat(p, 'receiving').tgts); },
    rush_rec_yards: function (p) { return n(cat(p, 'rushing').yds) + n(cat(p, 'receiving').yds); },
    pass_rush_yards: function (p) { return n(cat(p, 'passing').yds) + n(cat(p, 'rushing').yds); },
    rush_rec_tds: function (p) { return n(cat(p, 'rushing').td) + n(cat(p, 'receiving').td); },
    total_tds: totalTds,
    fg_made: function (p) { return n(cat(p, 'kicking').fg_made); },
    fg_attempted: function (p) { return n(cat(p, 'kicking').fg_att); },
    longest_fg: function (p) { return n(cat(p, 'kicking').long); },
    xp_made: function (p) { return n(cat(p, 'kicking').xp_made); },
    kicking_points: function (p) { return n(cat(p, 'kicking').pts); },
    tackles_assists: function (p) { return n(cat(p, 'defensive').tot); },
    solo_tackles: function (p) { return n(cat(p, 'defensive').solo); },
    sacks: function (p) { return n(cat(p, 'defensive').sacks); },
    def_interceptions: function (p) { return n(cat(p, 'interceptions').int); },
  };

  /* ---- basketball ---- */
  function bx(p) { return (p && p.stats && p.stats.box) || {}; }
  function ddCount(p) { const b = bx(p); return [b.pts, b.reb, b.ast, b.stl, b.blk].filter(function (v) { return n(v) >= 10; }).length; }
  function nbaFantasy(p, sys) {
    const b = bx(p), dd = ddCount(p);
    if (sys === 'dk') return n(b.pts) + n(b.tp_m) * 0.5 + n(b.reb) * 1.25 + n(b.ast) * 1.5 + n(b.stl) * 2 + n(b.blk) * 2 - n(b.to) * 0.5 + (dd >= 2 ? 1.5 : 0) + (dd >= 3 ? 3 : 0);
    return n(b.pts) + n(b.reb) * 1.2 + n(b.ast) * 1.5 + n(b.stl) * 3 + n(b.blk) * 3 - n(b.to);      // FanDuel / PrizePicks / Underdog
  }
  const NBA_FN = {
    points: function (p) { return n(bx(p).pts); }, rebounds: function (p) { return n(bx(p).reb); }, assists: function (p) { return n(bx(p).ast); },
    three_pointers_made: function (p) { return n(bx(p).tp_m); }, three_pointers_attempted: function (p) { return n(bx(p).tp_a); },
    field_goals_made: function (p) { return n(bx(p).fg_m); }, field_goals_attempted: function (p) { return n(bx(p).fg_a); },
    free_throws_made: function (p) { return n(bx(p).ft_m); }, free_throws_attempted: function (p) { return n(bx(p).ft_a); },
    steals: function (p) { return n(bx(p).stl); }, blocks: function (p) { return n(bx(p).blk); }, turnovers: function (p) { return n(bx(p).to); },
    steals_blocks: function (p) { return n(bx(p).stl) + n(bx(p).blk); },
    pts_reb: function (p) { return n(bx(p).pts) + n(bx(p).reb); }, pts_ast: function (p) { return n(bx(p).pts) + n(bx(p).ast); },
    reb_ast: function (p) { return n(bx(p).reb) + n(bx(p).ast); }, pts_reb_ast: function (p) { return n(bx(p).pts) + n(bx(p).reb) + n(bx(p).ast); },
    offensive_rebounds: function (p) { return n(bx(p).oreb); }, defensive_rebounds: function (p) { return n(bx(p).dreb); },
    personal_fouls: function (p) { return n(bx(p).pf); }, minutes: function (p) { return n(bx(p).min); },
    double_double: function (p) { return ddCount(p) >= 2 ? 1 : 0; }, triple_double: function (p) { return ddCount(p) >= 3 ? 1 : 0; },
  };

  /* ---- baseball ---- */
  function bt(p) { return (p && p.stats && p.stats.batting) || {}; }
  function pt(p) { return (p && p.stats && p.stats.pitching) || {}; }
  // singles/doubles/triples come from the play-by-play; null (-> enter it yourself) when that isn't there or doesn't add up to the hit count
  function hitTypes(p, g) {
    const b = bt(p);
    if (n(b.h) === 0 && !(p.ev && (p.ev.s || p.ev.d || p.ev.t))) return { s: 0, d: 0, t: 0 };
    if (!g || !g.hasPlays || !p.ev) return null;
    if (p.ev.s + p.ev.d + p.ev.t !== n(b.h) - n(b.hr)) return null;
    return p.ev;
  }
  const MLB_FN = {
    hits: function (p) { return n(bt(p).h); }, runs: function (p) { return n(bt(p).r); }, rbis: function (p) { return n(bt(p).rbi); },
    home_runs: function (p) { return n(bt(p).hr); }, walks: function (p) { return n(bt(p).bb); }, batter_strikeouts: function (p) { return n(bt(p).k); },
    at_bats: function (p) { return n(bt(p).ab); },
    hits_runs_rbis: function (p) { return n(bt(p).h) + n(bt(p).r) + n(bt(p).rbi); },
    singles: function (p, g) { const e = hitTypes(p, g); return e ? e.s : null; },
    doubles: function (p, g) { const e = hitTypes(p, g); return e ? e.d : null; },
    triples: function (p, g) { const e = hitTypes(p, g); return e ? e.t : null; },
    total_bases: function (p, g) { if (bt(p).tb != null) return n(bt(p).tb); const e = hitTypes(p, g); return e ? e.s + e.d * 2 + e.t * 3 + n(bt(p).hr) * 4 : null; },
    stolen_bases: function (p, g) { if (bt(p).sb != null) return n(bt(p).sb); return g && g.hasPlays && p.ev ? p.ev.sb : null; },
    pitcher_strikeouts: function (p) { return n(pt(p).k); }, pitching_outs: function (p) { return n(pt(p).outs); },
    earned_runs: function (p) { return n(pt(p).er); }, hits_allowed: function (p) { return n(pt(p).h); }, walks_allowed: function (p) { return n(pt(p).bb); },
    runs_allowed: function (p) { return n(pt(p).r); }, pitches_thrown: function (p) { const x = pt(p); return n(x.pc != null ? x.pc : x.p); },
  };

  function tableFor(game) { const sp = SPORT[game && game.league] || 'football'; return sp === 'basketball' ? NBA_FN : sp === 'baseball' ? MLB_FN : STAT_FN; }
  function supportedStat(stat, game) {
    if (game) { const t = tableFor(game); return !!t[stat] || (stat === 'fantasy_points' && t !== MLB_FN); }
    return stat === 'fantasy_points' || !!STAT_FN[stat] || !!NBA_FN[stat] || !!MLB_FN[stat];
  }

  /* returns {status:'ok'|'noplayer'|'unsupported', value, player} */
  function statValue(game, playerName, stat, opts) {
    opts = opts || {};
    if (!supportedStat(stat, game)) return { status: 'unsupported', value: null, player: null };
    const p = findPlayer(game.players || [], playerName, opts.team);
    if (!p) return { status: 'noplayer', value: 0, player: null };
    const sport = SPORT[game.league] || 'football';
    let value;
    if (stat === 'fantasy_points') value = sport === 'basketball' ? nbaFantasy(p, opts.fantasy) : fantasyPoints(p, opts.fantasy);
    else value = tableFor(game)[stat](p, game);
    if (value == null) return { status: 'unsupported', value: null, player: p };
    return { status: 'ok', value: Math.round(value * 100) / 100, player: p };
  }

  /* short human stat line for the details panel */
  function statLine(p) {
    if (!p) return '';
    const out = [];
    if (p.stats && p.stats.box) {
      const b = p.stats.box;
      return n(b.pts) + ' pts, ' + n(b.reb) + ' reb, ' + n(b.ast) + ' ast, ' + n(b.tp_m) + ' 3PM, ' + n(b.stl) + ' stl, ' + n(b.blk) + ' blk, ' + n(b.to) + ' TO · ' + n(b.min) + ' min';
    }
    if (p.stats && (p.stats.batting || p.stats.pitching)) {
      const b = p.stats.batting, q = p.stats.pitching;
      if (b && b.ab != null) out.push(n(b.h) + '-for-' + n(b.ab) + ', ' + n(b.r) + ' R, ' + n(b.hr) + ' HR, ' + n(b.rbi) + ' RBI, ' + n(b.bb) + ' BB, ' + n(b.k) + ' K');
      if (q && q.ip != null) out.push(String(q.ip) + ' IP, ' + n(q.h) + ' H, ' + n(q.er) + ' ER, ' + n(q.k) + ' K, ' + n(q.bb) + ' BB');
      return out.join(' · ');
    }
    const pa = cat(p, 'passing'), ru = cat(p, 'rushing'), re = cat(p, 'receiving'), k = cat(p, 'kicking'), d = cat(p, 'defensive');
    if (pa['c/att_att'] != null) out.push(n(pa['c/att_made']) + '/' + n(pa['c/att_att']) + ' pass, ' + n(pa.yds) + ' yds, ' + n(pa.td) + ' TD, ' + n(pa.int) + ' INT');
    if (ru.car != null) out.push(n(ru.car) + ' car, ' + n(ru.yds) + ' rush yds, ' + n(ru.td) + ' TD');
    if (re.rec != null) out.push(n(re.rec) + ' rec, ' + n(re.yds) + ' rec yds, ' + n(re.td) + ' TD');
    if (k.fg_att != null || k.xp_att != null) out.push('FG ' + n(k.fg_made) + '/' + n(k.fg_att) + ', XP ' + n(k.xp_made) + '/' + n(k.xp_att));
    if (d.tot != null) out.push(n(d.tot) + ' tkl, ' + n(d.sacks) + ' sacks');
    return out.join(' · ');
  }

  /* ---------- scoring plays ---------- */
  function tdPlays(game) {
    return (game.scoringPlays || []).filter(function (sp) { return /touchdown/i.test(sp.type) || /\btouchdown\b/i.test(sp.text); });
  }

  function playScorerMatches(play, playerName) {
    const left = String(play.text || '').split(/\s+pass\s+from\s+/i)[0];
    const hay = normName(left);
    const q = normName(playerName);
    if (!q) return false;
    if (hay.indexOf(q) >= 0) return true;
    const qt = q.split(' ');
    const last = qt[qt.length - 1];
    if (qt.length > 1) {
      const re = new RegExp('(^| )' + qt[0][0] + '[a-z]* ' + last + '( |$)');
      return re.test(hay);
    }
    return new RegExp('(^| )' + last + '( |$)').test(hay);
  }

  /* kind: 'first' | 'last' */
  function tdScorer(game, playerName, kind) {
    const plays = tdPlays(game);
    if (!plays.length) return { decided: false, match: false, play: null };
    const play = kind === 'last' ? plays[plays.length - 1] : plays[0];
    return { decided: true, match: playScorerMatches(play, playerName), play: play };
  }

  /* NBA "first basket": the first made field goal (free throws don't count). Needs the first few scoring plays. */
  function firstBasket(game, playerName) {
    const plays = (game.scoringPlays || []).filter(function (sp) { return !/free throw/i.test(sp.text) && !/free throw/i.test(sp.type); });
    if (!plays.length) return { decided: false, match: false, play: null };
    const play = plays[0];
    const who = normName(String(play.text || '').split(/\s+(?:makes|made|hits)\b/i)[0]), q = normName(playerName);
    if (!q) return { decided: true, match: false, play: play };
    const qt = q.split(' '), last = qt[qt.length - 1];
    const match = who === q || who.indexOf(q) >= 0 || (qt.length > 1 ? new RegExp('(^| )' + qt[0][0] + '[a-z]* ' + last + '$').test(who) : new RegExp('(^| )' + last + '$').test(who));
    return { decided: true, match: match, play: play };
  }

  return {
    SPORT: SPORT, firstBasket: firstBasket,
    n: n, normName: normName, findPlayer: findPlayer, parseStatLine: parseStatLine,
    normalizeEvent: normalizeEvent, normalizeSummary: normalizeSummary,
    statValue: statValue, supportedStat: supportedStat, fantasyPoints: fantasyPoints,
    statLine: statLine, tdScorer: tdScorer, totalTds: totalTds,
  };
});