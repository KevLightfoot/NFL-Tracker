/* ESPN payload normalisation, player-name matching and stat extraction. */
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
  function canonAbbr(a) { return Teams.matchTeam(a) || a || ''; }

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

  function teamBlock(c) {
    const t = c.team || {};
    const ls = (c.linescores || []).map(function (l) { return n(l.displayValue != null ? l.displayValue : l.value); });
    return {
      id: String(t.id == null ? '' : t.id),
      abbr: canonAbbr(t.abbreviation),
      name: t.displayName || t.name || '',
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
  function normalizeEvent(ev) {
    const comp = (ev.competitions || [])[0] || {};
    const st = statusBlock(ev.status || comp.status);
    const g = { id: String(ev.id), date: ev.date || comp.date || null, name: ev.shortName || ev.name || '', players: [], scoringPlays: [] };
    Object.assign(g, st);
    (comp.competitors || []).forEach(function (c) { g[c.homeAway] = teamBlock(c); });
    return g;
  }

  /* summary payload -> game with players + scoring plays */
  function normalizeSummary(j, idHint) {
    const hdr = j.header || {};
    const comp = (hdr.competitions || [])[0] || {};
    const st = statusBlock(comp.status);
    const g = { id: String(hdr.id || idHint || ''), date: comp.date || null, name: '', players: [], scoringPlays: [] };
    Object.assign(g, st);
    // lets the server backfill status from the scoreboard when the summary header omits it
    g.hasStatus = !!(comp.status && comp.status.type && comp.status.type.state);
    const byTeamId = {};
    (comp.competitors || []).forEach(function (c) {
      const tb = teamBlock(c);
      g[c.homeAway] = tb;
      byTeamId[tb.id] = tb.abbr;
    });
    if (g.away && g.home) g.name = g.away.abbr + ' @ ' + g.home.abbr;

    const idx = {};
    ((j.boxscore || {}).players || []).forEach(function (tb) {
      const t = tb.team || {};
      const abbr = canonAbbr(t.abbreviation) || byTeamId[String(t.id)] || '';
      (tb.statistics || []).forEach(function (cat) {
        (cat.athletes || []).forEach(function (a) {
          const ath = a.athlete || {};
          const nm = ath.displayName || ath.fullName || ath.shortName;
          if (!nm) return;
          const key = abbr + '|' + (ath.id || normName(nm));
          if (!idx[key]) { idx[key] = { id: String(ath.id || ''), name: nm, team: abbr, stats: {} }; g.players.push(idx[key]); }
          idx[key].stats[cat.name] = parseStatLine(cat.labels || cat.names, a.stats);
        });
      });
    });

    (j.scoringPlays || []).forEach(function (sp) {
      const tid = sp.team && sp.team.id != null ? String(sp.team.id) : '';
      g.scoringPlays.push({
        text: sp.text || '',
        type: (sp.type && (sp.type.text || sp.type.abbreviation)) || '',
        team: byTeamId[tid] || canonAbbr(sp.team && sp.team.abbreviation) || '',
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

  function supportedStat(stat) { return stat === 'fantasy_points' || !!STAT_FN[stat]; }

  /* returns {status:'ok'|'noplayer'|'unsupported', value, player} */
  function statValue(game, playerName, stat, opts) {
    opts = opts || {};
    if (!supportedStat(stat)) return { status: 'unsupported', value: null, player: null };
    const p = findPlayer(game.players || [], playerName, opts.team);
    if (!p) return { status: 'noplayer', value: 0, player: null };
    const value = stat === 'fantasy_points' ? fantasyPoints(p, opts.fantasy) : STAT_FN[stat](p);
    return { status: 'ok', value: Math.round(value * 100) / 100, player: p };
  }

  /* short human stat line for the details panel */
  function statLine(p) {
    if (!p) return '';
    const out = [];
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

  return {
    n: n, normName: normName, findPlayer: findPlayer, parseStatLine: parseStatLine,
    normalizeEvent: normalizeEvent, normalizeSummary: normalizeSummary,
    statValue: statValue, supportedStat: supportedStat, fantasyPoints: fantasyPoints,
    statLine: statLine, tdScorer: tdScorer, totalTds: totalTds,
  };
});
