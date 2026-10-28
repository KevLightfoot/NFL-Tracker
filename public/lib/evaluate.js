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
    // basketball
    points: 'Points', rebounds: 'Rebounds', assists: 'Assists', three_pointers_made: '3-Pointers Made', three_pointers_attempted: '3-Pointers Attempted',
    field_goals_made: 'FGs Made', field_goals_attempted: 'FG Attempts', free_throws_made: 'Free Throws Made', free_throws_attempted: 'Free Throw Attempts',
    steals: 'Steals', blocks: 'Blocks', turnovers: 'Turnovers', steals_blocks: 'Steals + Blocks', pts_reb: 'Pts + Reb', pts_ast: 'Pts + Ast',
    reb_ast: 'Reb + Ast', pts_reb_ast: 'Pts + Reb + Ast', offensive_rebounds: 'Offensive Rebounds', defensive_rebounds: 'Defensive Rebounds',
    personal_fouls: 'Fouls', minutes: 'Minutes', double_double: 'Double-Double', triple_double: 'Triple-Double',
    // baseball
    hits: 'Hits', runs: 'Runs', rbis: 'RBIs', home_runs: 'Home Runs', walks: 'Walks', batter_strikeouts: 'Strikeouts (batter)', at_bats: 'At Bats',
    hits_runs_rbis: 'Hits + Runs + RBIs', singles: 'Singles', doubles: 'Doubles', triples: 'Triples', total_bases: 'Total Bases', stolen_bases: 'Stolen Bases',
    pitcher_strikeouts: 'Strikeouts (pitcher)', pitching_outs: 'Pitching Outs', earned_runs: 'Earned Runs Allowed', hits_allowed: 'Hits Allowed',
    walks_allowed: 'Walks Allowed', runs_allowed: 'Runs Allowed', pitches_thrown: 'Pitches Thrown',
  };
  /* stat dropdown in the edit-leg dialog, grouped by sport */
  const STAT_GROUPS = {
    Football: ['passing_yards', 'passing_tds', 'passing_attempts', 'passing_completions', 'interceptions_thrown', 'longest_completion', 'rushing_yards',
      'rushing_attempts', 'rushing_tds', 'longest_rush', 'receiving_yards', 'receptions', 'receiving_tds', 'longest_reception', 'receiving_targets',
      'rush_rec_yards', 'pass_rush_yards', 'rush_rec_tds', 'total_tds', 'fg_made', 'fg_attempted', 'longest_fg', 'xp_made', 'kicking_points',
      'tackles_assists', 'solo_tackles', 'sacks', 'def_interceptions'],
    Basketball: ['points', 'rebounds', 'assists', 'three_pointers_made', 'three_pointers_attempted', 'field_goals_made', 'field_goals_attempted',
      'free_throws_made', 'free_throws_attempted', 'steals', 'blocks', 'turnovers', 'steals_blocks', 'pts_reb', 'pts_ast', 'reb_ast', 'pts_reb_ast',
      'offensive_rebounds', 'defensive_rebounds', 'personal_fouls', 'minutes', 'double_double', 'triple_double'],
    Baseball: ['hits', 'runs', 'rbis', 'home_runs', 'walks', 'batter_strikeouts', 'at_bats', 'hits_runs_rbis', 'singles', 'doubles', 'triples', 'total_bases',
      'stolen_bases', 'pitcher_strikeouts', 'pitching_outs', 'earned_runs', 'hits_allowed', 'walks_allowed', 'runs_allowed', 'pitches_thrown'],
    Any: ['fantasy_points', 'other'],
  };
  const STAT_UNIT = {
    passing_yards: 'pass yds', passing_tds: 'pass TD', passing_attempts: 'att', passing_completions: 'cmp', interceptions_thrown: 'INT',
    longest_completion: 'yds', rushing_yards: 'rush yds', rushing_attempts: 'car', rushing_tds: 'rush TD', longest_rush: 'yds',
    receiving_yards: 'rec yds', receptions: 'rec', receiving_tds: 'rec TD', longest_reception: 'yds', receiving_targets: 'tgt',
    rush_rec_yards: 'rush+rec yds', pass_rush_yards: 'pass+rush yds', rush_rec_tds: 'TD', total_tds: 'TD', fantasy_points: 'fpts',
    fg_made: 'FG', fg_attempted: 'FGA', longest_fg: 'yds', xp_made: 'XP', kicking_points: 'pts', tackles_assists: 'tkl', solo_tackles: 'solo',
    sacks: 'sacks', def_interceptions: 'INT', other: '',
    points: 'pts', rebounds: 'reb', assists: 'ast', three_pointers_made: '3PM', three_pointers_attempted: '3PA', field_goals_made: 'FGM', field_goals_attempted: 'FGA',
    free_throws_made: 'FTM', free_throws_attempted: 'FTA', steals: 'stl', blocks: 'blk', turnovers: 'TO', steals_blocks: 'stl+blk', pts_reb: 'pts+reb',
    pts_ast: 'pts+ast', reb_ast: 'reb+ast', pts_reb_ast: 'PRA', offensive_rebounds: 'oreb', defensive_rebounds: 'dreb', personal_fouls: 'PF', minutes: 'min',
    double_double: '', triple_double: '',
    hits: 'H', runs: 'R', rbis: 'RBI', home_runs: 'HR', walks: 'BB', batter_strikeouts: 'K', at_bats: 'AB', hits_runs_rbis: 'H+R+RBI', singles: '1B', doubles: '2B',
    triples: '3B', total_bases: 'TB', stolen_bases: 'SB', pitcher_strikeouts: 'K', pitching_outs: 'outs', earned_runs: 'ER', hits_allowed: 'H', walks_allowed: 'BB',
    runs_allowed: 'R', pitches_thrown: 'pitches',
  };
  const PERIOD_LABEL = { full: '', '1h': '1H ', '2h': '2H ', q1: '1Q ', q2: '2Q ', q3: '3Q ', q4: '4Q ', f3: 'F3 ', f5: 'F5 ', f7: 'F7 ', i1: '1st Inning ' };
  const SPORT = { nfl: 'football', cfb: 'football', nba: 'basketball', mlb: 'baseball' };
  const sportOf = function (g) { return (g && SPORT[g.league]) || 'football'; };

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
      case 'first_basket': return leg.player + ' First Basket';
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

  /* baseball: innings completely finished ("Top 5th" / "Mid 5th" / "Bot 5th" -> 4, "End 5th" -> 5) */
  function inningsDone(g) {
    if (g.state === 'post') return 99;
    if (g.state !== 'in') return 0;
    const p = g.period || 0, d = String(g.detail || '');
    return /^end/i.test(d) ? p : Math.max(0, p - 1);
  }

  /* how many whole periods are in the books (handles halftime and "End of 1st") */
  function completedPeriods(g) {
    if (g.state === 'post') return 99;
    if (g.state !== 'in') return 0;
    if (sportOf(g) === 'baseball') return inningsDone(g);
    const detail = String(g.detail || ''), period = g.period || 0;
    if (/half/i.test(detail)) return Math.max(2, period);
    const zero = /^0?:00(\.\d+)?$/.test(String(g.clock || '').trim()) || /end of/i.test(detail);
    return zero ? period : Math.max(0, period - 1);
  }

  /* fraction of regulation played, 0..1 (OT / extra innings count as 1) */
  function elapsedFrac(g) {
    if (!g || g.state === 'pre') return 0;
    if (g.state === 'post') return 1;
    const sp = sportOf(g), p = g.period || 0;
    if (sp === 'baseball') {
      if (p > 9) return 1;
      const d = String(g.detail || '');
      const inn = /^end/i.test(d) ? p : /^mid/i.test(d) ? p - 0.5 : /^bot/i.test(d) ? p - 0.25 : p - 0.75;
      return Math.min(1, Math.max(0, inn / 9));
    }
    if (/half/i.test(String(g.detail || ''))) return 0.5;
    if (p > 4) return 1;
    const secs = sp === 'basketball' ? 720 : 900;
    const m = String(g.clock || '').match(/^(\d+):(\d{2})/);
    const left = m ? (+m[1]) * 60 + (+m[2]) : secs;
    return Math.min(1, Math.max(0, ((p - 1) * secs + (secs - left)) / (secs * 4)));
  }

  function scopedScore(g, scope) {
    scope = scope || 'full';
    const a = g.away, h = g.home, post = g.state === 'post', period = g.period || 0, done = completedPeriods(g);
    const ls = function (t, i) { return t.linescores[i] == null ? 0 : t.linescores[i]; };
    if (sportOf(g) === 'baseball' && scope !== 'full') {
      const N = scope === 'i1' ? 1 : scope === '1h' ? 5 : parseInt(String(scope).replace(/\D/g, ''), 10) || 9;   // "1st half" of a baseball slip means the first five innings
      const sum = function (t) { let x = 0; for (let i = 0; i < N; i++) x += ls(t, i); return x; };
      return { away: sum(a), home: sum(h), final: done >= N, started: g.state !== 'pre' };
    }
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

    // a postponed / cancelled game is voided by the book
    if (g && g.state !== 'in' && /postponed|cancell?ed/i.test(String(g.detail || '')) && manualVal == null) {
      r.state = 'void'; r.kind = 'none'; r.detail = 'Game ' + (/postponed/i.test(g.detail) ? 'postponed' : 'cancelled') + ' — the book will void this leg';
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

    if (market === 'first_basket') {
      r.kind = 'check';
      if (!g) return;
      const res = Stats.firstBasket(g, leg.player);
      if (res.decided) {
        r.state = res.match ? 'hit' : 'miss'; r.onTrack = res.match;
        r.detail = 'First basket: ' + res.play.text.replace(/\s*\([^)]*\)\s*$/, '');
      } else { r.state = g.state === 'in' ? 'live' : g.state === 'post' ? 'miss' : 'pending'; r.detail = g.state === 'in' ? 'No basket yet' : ''; }
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
        if (r.state === 'live' && g && sportOf(g) !== 'baseball' && !/^longest_|^double_|^triple_/.test(stat || '') && side !== 'yes' && manualVal == null) r.detail += paceText(g, value, line, side);
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

  return { evaluateLeg: evaluateLeg, describeLeg: describeLeg, summarize: summarize, scopedScore: scopedScore, STAT_LABEL: STAT_LABEL, STAT_GROUPS: STAT_GROUPS, fmt: fmt, gameStatusText: gameStatusText };
});
