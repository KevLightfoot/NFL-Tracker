'use strict';
// ESPN-shaped payloads (scoreboard event + summary) used by the tests.
function team(id, abbr, name) { return { id: String(id), abbreviation: abbr, displayName: name }; }

function summary(o) {
  const away = team(o.awayId || 1, o.away, o.awayName || o.away), home = team(o.homeId || 2, o.home, o.homeName || o.home);
  return {
    header: {
      id: String(o.id),
      competitions: [{
        date: o.date || '2026-10-18T17:00Z',
        status: { period: o.period || 0, displayClock: o.clock || '0:00', type: { state: o.state, completed: o.state === 'post', shortDetail: o.detail || (o.state === 'post' ? 'Final' : o.state === 'in' ? '5:12 - 3rd' : '10/18 - 1:00 PM EDT') } },
        competitors: [
          { homeAway: 'home', team: home, score: String(o.homeScore || 0), linescores: (o.homeLs || []).map(function (v) { return { displayValue: String(v) }; }) },
          { homeAway: 'away', team: away, score: String(o.awayScore || 0), linescores: (o.awayLs || []).map(function (v) { return { displayValue: String(v) }; }) },
        ],
      }],
    },
    boxscore: { players: o.boxPlayers || [] },
    scoringPlays: o.scoringPlays || [],
  };
}

function box(teamObj, cats) {
  return { team: teamObj, statistics: cats };
}
const cat = function (name, labels, athletes) {
  return { name: name, labels: labels, athletes: athletes.map(function (a) { return { athlete: { id: a[0], displayName: a[1] }, stats: a[2] }; }) };
};

const HOU = team(2, 'HOU', 'Houston Texans'), IND = team(1, 'IND', 'Indianapolis Colts');

const liveGame = summary({
  id: 401, state: 'in', period: 3, clock: '5:12', away: 'IND', home: 'HOU', awayScore: 17, homeScore: 24, awayLs: [7, 10, 0], homeLs: [10, 7, 7],
  boxPlayers: [
    box(HOU, [
      cat('passing', ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'], [['10', 'C.J. Stroud', ['20/28', '260', '9.3', '2', '1', '2-14', '70.1', '101.2']]]),
      cat('rushing', ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], [['11', 'Joe Mixon', ['14', '61', '4.4', '1', '17']]]),
      cat('receiving', ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'], [['12', 'Nico Collins', ['6', '88', '14.7', '1', '34', '9']], ['13', 'Tank Dell', ['3', '31', '10.3', '0', '15', '4']]]),
      cat('fumbles', ['FUM', 'LOST', 'REC'], [['12', 'Nico Collins', ['1', '1', '0']]]),
      cat('kicking', ['FG', 'PCT', 'LONG', 'XP', 'PTS'], [['14', 'Ka\'imi Fairbairn', ['2/3', '66.7', '48', '3/3', '9']]]),
      cat('defensive', ['TOT', 'SOLO', 'SACKS', 'TFL', 'PD', 'QB HITS', 'TD'], [['15', 'Will Anderson Jr.', ['5', '4', '1.5', '2', '0', '3', '0']]]),
    ]),
    box(IND, [
      cat('passing', ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'], [['20', 'Anthony Richardson', ['15/25', '180', '7.2', '1', '0', '1-8', '55.0', '88.0']]]),
      cat('rushing', ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], [['21', 'Jonathan Taylor', ['18', '95', '5.3', '2', '41']]]),
      cat('receiving', ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'], [['22', 'Michael Pittman Jr.', ['5', '60', '12.0', '0', '22', '7']]]),
    ]),
  ],
  scoringPlays: [
    { text: 'Jonathan Taylor 4 Yd Run (Matt Gay Kick)', type: { text: 'Rushing Touchdown' }, team: { id: '1' }, period: { number: 1 }, clock: { displayValue: '9:00' }, awayScore: 7, homeScore: 0 },
    { text: 'Nico Collins 12 Yd pass from C.J. Stroud (Ka\'imi Fairbairn Kick)', type: { text: 'Passing Touchdown' }, team: { id: '2' }, period: { number: 1 }, clock: { displayValue: '2:10' }, awayScore: 7, homeScore: 7 },
  ],
});

function ev(id, away, home, state, awayScore, homeScore, date) {
  return {
    id: String(id), date: date || '2026-10-18T17:00Z', shortName: away.abbreviation + ' @ ' + home.abbreviation,
    status: { period: state === 'in' ? 3 : 0, displayClock: '5:12', type: { state: state, completed: state === 'post', shortDetail: state === 'post' ? 'Final' : state === 'in' ? '5:12 - 3rd' : '10/18 - 1:00 PM' } },
    competitions: [{ competitors: [
      { homeAway: 'home', team: home, score: String(homeScore), linescores: [] },
      { homeAway: 'away', team: away, score: String(awayScore), linescores: [] },
    ] }],
  };
}

module.exports = { summary: summary, box: box, cat: cat, liveGame: liveGame, ev: ev, HOU: HOU, IND: IND, team: team };
