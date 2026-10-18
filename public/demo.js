/* Demo mode: a self-contained simulation of five games so the UI can be explored without an API key or live games. */
(function (root) {
  'use strict';
  const START = 0.34;
  let t = START;
  const r = Math.round;

  const GAMES = {
    'demo-1': { away: ['NYJ', 'New York Jets'], home: ['DEN', 'Denver Broncos'], final: [24, 20] },
    'demo-2': { away: ['PIT', 'Pittsburgh Steelers'], home: ['BAL', 'Baltimore Ravens'], final: [17, 27] },
    'demo-3': { away: ['LV', 'Las Vegas Raiders'], home: ['CLE', 'Cleveland Browns'], final: [31, 27] },
    'demo-4': { away: ['NO', 'New Orleans Saints'], home: ['CAR', 'Carolina Panthers'], final: [17, 24] },
    'demo-5': { away: ['IND', 'Indianapolis Colts'], home: ['HOU', 'Houston Texans'], final: [20, 30] },
  };

  function ord(n) { return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : '4th'; }

  function players(id) {
    if (id === 'demo-2') {
      return [{ id: 'd1', name: 'Derrick Henry', team: 'BAL', stats: { rushing: { car: r(22 * t), yds: r(104 * t), td: t >= 0.45 ? 1 : 0, long: r(31 * Math.min(1, t * 1.5)) } } }];
    }
    if (id === 'demo-5') {
      return [{ id: 'd2', name: 'Nico Collins', team: 'HOU', stats: { receiving: { rec: r(8 * t), yds: r(96 * t), td: t > 0.7 ? 1 : 0, long: r(34 * Math.min(1, t * 1.6)), tgts: r(11 * t) } } }];
    }
    return [];
  }

  function getGame(id) {
    const s = GAMES[id];
    if (!s) throw new Error('Unknown demo game');
    const state = t <= 0 ? 'pre' : t >= 1 ? 'post' : 'in';
    const period = Math.min(4, 1 + Math.floor(t * 4));
    const q = t * 4 - Math.floor(t * 4);
    const secs = r((1 - q) * 900);
    const clock = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    const g = {
      id: id, date: new Date().toISOString(), name: s.away[0] + ' @ ' + s.home[0], state: state, completed: state === 'post',
      detail: state === 'post' ? 'Final' : state === 'pre' ? 'Kickoff soon' : clock + ' - ' + ord(period),
      period: state === 'in' ? period : state === 'post' ? 4 : 0, clock: state === 'in' ? clock : '',
      away: { id: s.away[0], abbr: s.away[0], name: s.away[1], score: r(s.final[0] * Math.min(1, t)), linescores: [] },
      home: { id: s.home[0], abbr: s.home[0], name: s.home[1], score: r(s.final[1] * Math.min(1, t)), linescores: [] },
      players: players(id), scoringPlays: [],
    };
    if (id === 'demo-2' && t >= 0.45) g.scoringPlays.push({ text: 'Derrick Henry 3 Yd Run (Kick)', type: 'Rushing Touchdown', team: 'BAL', period: 2, clock: '4:10', awayScore: 3, homeScore: 7 });
    return g;
  }

  function parlay() {
    const base = { raw_text: '', away_team: '', home_team: '', game_date: '', period: 'full', fantasy_system: null, notes: '', manual: null, manualValue: null, teamResolved: null, noResolve: true, player: '', stat: null, side: null, line: null };
    const L = function (o) { return Object.assign({}, base, o); };
    return {
      demo: true, name: '', sportsbook: 'DEMO · simulated games', betType: 'parlay', wager: 10, payout: 122.5, odds: '+1125', warnings: [], thumb: null,
      legs: [
        L({ raw_text: 'Jets ML', market: 'moneyline', team: 'Jets', away_team: 'Jets', home_team: 'Broncos', odds: '+110', gameId: 'demo-1' }),
        L({ raw_text: 'Derrick Henry Anytime TD', market: 'anytime_td', player: 'Derrick Henry', team: 'Ravens', side: 'yes', odds: '-105', gameId: 'demo-2' }),
        L({ raw_text: 'Raiders @ Browns Over 54.5', market: 'total', side: 'over', line: 54.5, away_team: 'Raiders', home_team: 'Browns', odds: '-110', gameId: 'demo-3' }),
        L({ raw_text: 'Saints +7.5', market: 'spread', team: 'Saints', line: 7.5, away_team: 'Saints', home_team: 'Panthers', odds: '-110', gameId: 'demo-4' }),
        L({ raw_text: 'Nico Collins Over 79.5 Receiving Yards', market: 'player_prop', player: 'Nico Collins', team: 'Texans', stat: 'receiving_yards', side: 'over', line: 79.5, odds: '-115', gameId: 'demo-5' }),
      ],
    };
  }

  root.NFLDemo = {
    getGame: getGame, parlay: parlay,
    tick: function (d) { t = Math.min(1.0, t + (d || 0.03)); return t; },
    reset: function () { t = START; },
    done: function () { return t >= 1; },
    isDemoId: function (id) { return String(id).indexOf('demo-') === 0; },
  };
  if (typeof module === 'object' && module.exports) module.exports = root.NFLDemo;
})(typeof self !== 'undefined' ? self : this);
