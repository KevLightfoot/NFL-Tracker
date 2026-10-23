/* Leg evaluation: turns (leg, live game data) into a display-ready result. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./teams.js'), require('./stats.js'));
  else root.NFLEval = factory(root.NFLTeams, root.NFLStats);
})(typeof self !== 'undefined' ? self : this, function (Teams, Stats) {
  const STAT_LABEL = {
    passing_yards: 'Passing Yards', passing_tds: 'Passing TDs', passing_attempts: 'Pass Attempts',
    passing_completions: 'Completions', interceptions_thrown: 'Interceptions Thrown', longest_completion: 'Longest Completion',
    rushing_yards: 'Rushing Yards', rushing_attempts: 'Rush Attempts', rushing_tds: 'Rushing TDs', longest_rush: 'Longest Rush',
    receiving_yards: 'Receiving Yards', receptions: 'Receptions', receiving_tds: 'Receiving TDs', longest_reception: 'Longest Reception',
    receiving_targets: 'Targets', rush_rec_yards: 'Rush + Rec Yards', pass_rush_yards: 'Pass + Rush Yards', rush_rec_tds: 'Rush + Rec TDs',
    total_tds: 'Touchdowns', fantasy_points: 'Fantasy Points', fg_made: 'FGs Made', fg_attempted: 'FG Attempts', longest_fg: 'Longest FG',
    xp_made: 'XPs Made', kicking_points: 'Kicking Points', tackles_assists: 'Tackles + Assists', solo_tackles: 'Solo Tackles',
    sacks: 'Sacks', def_interceptions: 'Interceptions', other: 'Prop',
  };
  const STAT_UNIT = {
    passing_yards: 'pass yds', passing_tds: 'pass TD', passing_attempts: 'att', passing_completions: 'cmp', interceptions_thrown: 'INT',
    longest_completion: 'yds', rushing_yards: 'rush yds', rushing_attempts: 'car', rushing_tds: 'rush TD', longest_rush: 'yds',
    receiving_yards: 'rec yds', receptions: 'rec', receiving_tds: 'rec TD', longest_reception: 'yds', receiving_targets: 'tgt',
    rush_rec_yards: 'rush+rec yds', pass_rush_yards: 'pass+rush yds', rush_rec_tds: 'TD', total_tds: 'TD', fantasy_points: 'fpts',
    fg_made: 'FG', fg_attempted: 'FGA', longest_fg: 'yds', xp_made: 'XP', kicking_points: 'pts', tackles_assists: 'tkl', solo_tackles: 'solo',
    sacks: 'sacks', def_interceptions: 'INT', other: '',
  };
  const PERIOD_LABEL = { full: '', '1h': '1H ', '2h': '2H ', q1: '1Q ', q2: '2Q ', q3: '3Q ', q4: '4Q ' };

  function fmt(x) {
    if (x == null || !isFinite(x)) return '–';
    const r = Math.round(x * 100) / 100;
    return Number.isInteger(r) ? String(r) : String(r);
  }
  function signed(x) { return (x > 0 ? '+' : '') + fmt(x); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function sideWord(side) { return side === 'under' ? 'Under' : side === 'yes' ? '' : 'Over'; }

  function teamLabel(t, league) {
    const a = Teams.matchTeam(t, league);
    return a ? Teams.name(a, league) : (t || '');
  }

  function describeLeg(leg) {
    const lg = leg.league || undefined;
    const per = PERIOD_LABEL[leg.period || 'full'] || '';
    switch (leg.market) {
      case 'moneyline': return per + teamLabel(leg.team, lg) + ' ML';
      case 'spread': return per + teamLabel(leg.team, lg) + ' ' + (leg.line != null ? signed(leg.line) : '');
      case 'total': {
        const m = leg.away_team && leg.home_team ? teamLabel(leg.away_team, lg) + ' @ ' + teamLabel(leg.home_team, lg) + ' ' : '';
        return m + per + sideWord(leg.side) + ' ' + fmt(leg.line);
      }
      case 'team_total': return teamLabel(leg.team, lg) + ' ' + per + 'Team Total ' + sideWord(leg.side) + ' ' + fmt(leg.line);
      case 'anytime_td': return leg.player + ' Anytime TD';
      case 'first_td': return leg.player + ' First TD';
      case 'last_td': return leg.player + ' Last TD';
      case 'player_prop': {
        const lbl = STAT_LABEL[leg.stat] || 'Prop';
        if (leg.side === 'yes') return leg.player + ' ' + lbl;
        return leg.player + ' ' + sideWord(leg.side) + ' ' + fmt(leg.line) + ' ' + lbl;
      }
      default: return leg.raw_text || leg.notes || 'Bet';
    }
  }

  function gameStatusText(g) {
    if (!g) return '';
    if (g.state === 'post') return g.detail && /final/i.test(g.detail) ? g.detail : 'Final';
    if (g.state === 'pre') return g.detail || 'Not started';
    return g.detail || ('Q' + g.period + ' ' + g.clock);
  }
  function matchupText(g) {
    return g ? g.away.abbr + ' ' + fmt(g.away.score) + ' – ' + g.home.abbr + ' ' + fmt(g.home.score) : '';
  }

  /* how many whole periods are in the books (handles halftime and "End of 1st") */
  function completedPeriods(g) {
    if (g.state === 'post') return 99;
    if (g.state !== 'in') return 0;
    const detail = String(g.detail || ''), period = g.period || 0;
    if (/half/i.test(detail)) return Math.max(2, period);
    const zero = /^0?:00(\.\d+)?$/.test(String(g.clock || '').trim()) || /end of/i.test(detail);
    return zero ? period : Math.max(0, period - 1);
  }

  /* fraction of regulation played, 0..1 (OT counts as 1) */
  function elapsedFrac(g) {
    if (!g || g.state === 'pre') return 0;
    if (g.state === 'post') return 1;
    if (/half/i.test(String(g.detail || ''))) return 0.5;
    const p = g.period || 0;
    if (p > 4) return 1;
    const m = String(g.clock || '').match(/^(\d+):(\d{2})/);
    const left = m ? (+m[1]) * 60 + (+m[2]) : 900;
    return Math.min(1, Math.max(0, ((p - 1) * 900 + (900 - left)) / 3600));
  }

  function scopedScore(g, scope) {
    scope = scope || 'full';
    const a = g.away, h = g.home, post = g.state === 'post', period = g.period || 0, done = completedPeriods(g);
    const ls = function (t, i) { return t.linescores[i] == null ? 0 : t.linescores[i]; };
    if (scope === 'full') return { away: a.score, home: h.score, final: post, started: g.state !== 'pre' };
    if (scope === '1h') return { away: ls(a, 0) + ls(a, 1), home: ls(h, 0) + ls(h, 1), final: done >= 2, started: g.state !== 'pre' };
    if (scope === '2h') {
      return { away: a.score - (ls(a, 0) + ls(a, 1)), home: h.score - (ls(h, 0) + ls(h, 1)), final: post, started: post || done >= 2 || period >= 3 };
    }
    const q = parseInt(scope.slice(1), 10);
    return { away: ls(a, q - 1), home: ls(h, q - 1), final: done >= q, started: post || period >= q };
  }

  /* "on pace for N" suffix for live numeric markets */
  function paceText(g, value, line, side) {
    const f = elapsedFrac(g);
    if (!g || g.state !== 'in' || f < 0.15 || f >= 1 || !(value > 0)) return '';
    const proj = value / f;
    return ' · pace ' + fmt(Math.round(proj * 10) / 10) + (side === 'under' ? '' : proj > line ? ' ✓' : '');
  }

  function blank(leg, g) {
    return {
      legId: leg.id, title: describeLeg(leg), kind: 'none', state: 'unresolved', onTrack: null,
      progress: 0, current: null, target: null, valueText: '', targetText: '', scoreText: '', detail: '',
      gameText: g ? (g.away.abbr + ' @ ' + g.home.abbr + ' · ' + gameStatusText(g)) : '', source: 'auto', playerLine: '',
    };
  }

  /* shared over/under resolution for numeric things */
  function resolveOU(r, side, line, value, final, started) {
    if (side === 'yes') { side = 'over'; }
    if (side === 'under') {
      if (value > line) { r.state = 'miss'; r.onTrack = false; }
      else if (final) { r.state = value === line ? 'push' : 'hit'; r.onTrack = true; }
      else { r.state = started ? 'live' : 'pending'; r.onTrack = true; }
    } else {
      if (value > line) { r.state = 'hit'; r.onTrack = true; }
      else if (final) { r.state = value === line ? 'push' : 'miss'; r.onTrack = false; }
      else { r.state = started ? 'live' : 'pending'; r.onTrack = value > 0 || null; }
    }
  }

  function evaluateLeg(leg, game) {
    if (game) Teams.registerGame(game); // college teams register themselves from game data
    const r = blank(leg, game);
    compute(leg, game, r);
    if (leg.manual && leg.manual.state) {
      r.state = leg.manual.state;
      r.source = 'manual';
      if (r.state === 'hit') r.onTrack = true;
      if (r.state === 'miss') r.onTrack = false;
    }
    return r;
  }

  function compute(leg, g, r) {
    const market = leg.market;
    const lg = (g && g.league) || leg.league || undefined; // 'nfl' | 'cfb' | undefined
    const manualVal = leg.manualValue != null && leg.manualValue !== '' ? Number(leg.manualValue) : null;

    // markets that need a game
    if (!g && manualVal == null) {
      r.state = 'unresolved';
      r.detail = leg.gameId ? 'Loading game…' : 'Finding this game…';
      if (market === 'other') r.detail = 'Not auto-trackable — mark it yourself';
      return;
    }

    if (market === 'moneyline' || market === 'spread') {
      const abbr = Teams.matchTeam(leg.team, lg);
      if (!abbr || (abbr !== g.away.abbr && abbr !== g.home.abbr)) { r.detail = 'Team not found in this game — edit the leg'; return; }
      const sc = scopedScore(g, leg.period);
      const mine = abbr === g.away.abbr ? sc.away : sc.home;
      const opp = abbr === g.away.abbr ? sc.home : sc.away;
      const diff = mine - opp;
      r.kind = 'score';
      r.scoreText = (leg.period && leg.period !== 'full' ? (PERIOD_LABEL[leg.period] + '· ') : '') + g.away.abbr + ' ' + fmt(sc.away) + ' – ' + g.home.abbr + ' ' + fmt(sc.home);
      if (market === 'moneyline') {
        if (!sc.started) { r.state = 'pending'; r.detail = ''; return; }
        if (sc.final) { r.state = diff > 0 ? 'hit' : diff < 0 ? 'miss' : 'push'; r.onTrack = diff > 0; r.detail = diff > 0 ? 'Won by ' + fmt(diff) : diff < 0 ? 'Lost by ' + fmt(-diff) : 'Tied'; return; }
        r.state = 'live'; r.onTrack = diff > 0 ? true : diff < 0 ? false : null;
        r.detail = diff > 0 ? Teams.name(abbr, lg) + ' leading by ' + fmt(diff) : diff < 0 ? Teams.name(abbr, lg) + ' trailing by ' + fmt(-diff) : 'Tied';
      } else {
        const line = Number(leg.line) || 0;
        const cover = diff + line;
        if (!sc.started) { r.state = 'pending'; r.detail = ''; return; }
        const coverTxt = cover > 0 ? 'Covering by ' + fmt(cover) : cover < 0 ? 'Needs ' + fmt(-cover) + ' more to cover' : 'Right on the number';
        if (sc.final) { r.state = cover > 0 ? 'hit' : cover < 0 ? 'miss' : 'push'; r.onTrack = cover > 0; r.detail = cover > 0 ? 'Covered by ' + fmt(cover) : cover < 0 ? 'Missed by ' + fmt(-cover) : 'Push'; return; }
        r.state = 'live'; r.onTrack = cover > 0 ? true : cover < 0 ? false : null; r.detail = coverTxt;
      }
      return;
    }

    if (market === 'total' || market === 'team_total') {
      const sc = scopedScore(g, leg.period);
      let total = sc.away + sc.home;
      if (market === 'team_total') {
        const abbr = Teams.matchTeam(leg.team, lg);
        if (!abbr || (abbr !== g.away.abbr && abbr !== g.home.abbr)) { r.detail = 'Team not found in this game — edit the leg'; return; }
        total = abbr === g.away.abbr ? sc.away : sc.home;
      }
      const line = Number(leg.line) || 0;
      r.kind = 'total';
      r.current = total; r.target = line;
      r.valueText = fmt(total); r.targetText = fmt(line);
      r.progress = line > 0 ? Math.min(1, total / line) : 0;
      r.scoreText = (market === 'team_total' ? Teams.name(Teams.matchTeam(leg.team, lg), lg) + ' ' : 'Current total ') + fmt(total);
      resolveOU(r, leg.side, line, total, sc.final, sc.started);
      if (r.state === 'live' || r.state === 'pending') {
        if (leg.side === 'under') r.detail = 'Room for ' + fmt(Math.max(0, Math.ceil(line) - 1 - total)) + ' more pts';
        else r.detail = 'Needs ' + fmt(Math.max(0, Math.floor(line) + 1 - total)) + ' more pts';
        if (r.state === 'live' && (!leg.period || leg.period === 'full')) r.detail += paceText(g, total, line, leg.side);
      } else if (r.state === 'hit') r.detail = leg.side === 'under' ? 'Stayed under' : 'Over cashed';
      else if (r.state === 'miss') r.detail = leg.side === 'under' ? 'Went over' : 'Finished under';
      else r.detail = 'Push';
      return;
    }

    if (market === 'first_td' || market === 'last_td') {
      const kind = market === 'first_td' ? 'first' : 'last';
      r.kind = 'check';
      const res = g ? Stats.tdScorer(g, leg.player, kind) : { decided: false };
      if (!g) return;
      if (kind === 'first') {
        if (res.decided) {
          r.state = res.match ? 'hit' : 'miss'; r.onTrack = res.match;
          r.detail = 'First TD: ' + res.play.text.replace(/\s*\([^)]*\)\s*$/, '');
        } else if (g.state === 'post') { r.state = 'miss'; r.detail = 'No touchdowns scored'; }
        else { r.state = g.state === 'in' ? 'live' : 'pending'; r.detail = g.state === 'in' ? 'No TD scored yet' : ''; }
      } else {
        if (g.state === 'post') {
          if (res.decided) { r.state = res.match ? 'hit' : 'miss'; r.onTrack = res.match; r.detail = 'Last TD: ' + res.play.text.replace(/\s*\([^)]*\)\s*$/, ''); }
          else { r.state = 'miss'; r.detail = 'No touchdowns scored'; }
        } else {
          r.state = g.state === 'in' ? 'live' : 'pending';
          r.detail = res.decided ? 'Latest TD: ' + res.play.text.replace(/\s*\([^)]*\)\s*$/, '') : 'Decided at the final whistle';
        }
      }
      return;
    }

    if (market === 'anytime_td' || market === 'player_prop') {
      const stat = market === 'anytime_td' ? 'total_tds' : leg.stat;
      const side = market === 'anytime_td' ? 'yes' : leg.side;
      let line = market === 'anytime_td' ? 0.5 : Number(leg.line);
      if (side === 'yes' && (leg.line == null || market === 'anytime_td')) line = 0.5;
      if (!isFinite(line)) line = 0;
      const final = g ? g.state === 'post' : false;
      const started = g ? g.state !== 'pre' : true;
      r.kind = 'bar';
      let value = null;

      if (manualVal != null) { value = manualVal; r.source = 'manual'; r.detail = 'Value entered manually'; }
      else if (g) {
        const res = Stats.statValue(g, leg.player, stat, { team: Teams.matchTeam(leg.team, lg) || leg.teamResolved, fantasy: leg.fantasy_system });
        if (res.status === 'unsupported') {
          r.kind = 'bar'; r.state = 'unresolved'; r.target = line; r.targetText = fmt(line);
          r.detail = 'Live data isn’t available for this stat — tap to enter the value yourself';
          return;
        }
        value = res.value;
        if (res.player) r.playerLine = Stats.statLine(res.player);
        else if (g.state !== 'pre') r.detail = 'Not in the box score yet' + (final ? ' (if he didn’t play, the book will void this leg)' : '');
      }
      if (value == null) value = 0;

      r.current = value; r.target = line;
      r.valueText = fmt(value); r.targetText = side === 'yes' && line === 0.5 ? '1' : fmt(line);
      if (side === 'yes' && line === 0.5) { r.current = Math.min(value, 1); r.valueText = String(Math.min(Math.round(value), 99)); }
      r.progress = line > 0 ? Math.min(1, value / line) : (value > 0 ? 1 : 0);
      r.unit = STAT_UNIT[stat] || '';
      resolveOU(r, side, line, value, final, started);
      if (r.state === 'live' || r.state === 'pending') {
        if (side === 'under') r.detail = r.detail || 'Room for ' + fmt(Math.max(0, line - value)) + ' more';
        else if (!r.detail) r.detail = fmt(Math.max(0, Math.floor(line) + 1 - value)) + ' to go';
        if (r.state === 'live' && g && !/^longest_/.test(stat || '') && side !== 'yes' && manualVal == null) r.detail += paceText(g, value, line, side);
      } else if (r.state === 'hit' && !r.detail) r.detail = side === 'under' ? 'Stayed under' : 'Cleared the line';
      else if (r.state === 'miss' && !r.detail) r.detail = side === 'under' ? 'Went over' : 'Finished short';
      return;
    }

    r.kind = 'none'; r.state = 'unresolved';
    r.detail = 'Not auto-trackable — mark it yourself';
  }

  /* parlay-level summary */
  function summarize(results) {
    const c = { hit: 0, miss: 0, push: 0, void: 0, live: 0, pending: 0, unresolved: 0 };
    results.forEach(function (r) { c[r.state] = (c[r.state] || 0) + 1; });
    const total = results.length;
    const settled = c.hit + c.miss + c.push + c.void;
    let status;
    if (c.miss > 0) status = 'lost';
    else if (total > 0 && settled === total) status = c.hit > 0 ? 'won' : 'void';
    else if (c.live > 0 || c.hit > 0 || c.push > 0) status = 'live';
    else status = 'pending';
    return { counts: c, total: total, hits: c.hit, status: status, alive: c.miss === 0 };
  }

  return { evaluateLeg: evaluateLeg, describeLeg: describeLeg, summarize: summarize, scopedScore: scopedScore, STAT_LABEL: STAT_LABEL, fmt: fmt, gameStatusText: gameStatusText };
});
