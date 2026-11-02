'use strict';
// The DraftKings "Pick Combo" college basketball slips from Nov 2: the same schools have football games that week, the model labels
// the legs inconsistently (cfb / cbb / nfl / nothing), and every leg must still land in its basketball game.
const assert = require('assert'), http = require('http');
const E = require('../public/lib/evaluate.js');
const now = Date.now(), H = 36e5, iso = function (h) { return new Date(now + h * H).toISOString(); };
let nid = 1;
const T = {};
const tm = function (abbr, school, nick) { const t = { id: String(nid++), abbreviation: abbr, displayName: school + ' ' + nick, shortDisplayName: school, name: nick, location: school }; T[abbr + school] = t; return t; };
const ev = function (id, away, home, h) { const st = { period: 0, displayClock: '0:00', type: { state: 'pre', completed: false, shortDetail: '' } };
  return { id: String(id), date: iso(h), status: st, competitions: [{ date: iso(h), status: st, competitors: [{ homeAway: 'away', team: away, score: '0' }, { homeAway: 'home', team: home, score: '0' }] }] }; };
// one team object per school per sport (ESPN ids differ between sports; abbreviations can differ too)
const S = function (abbr, school, nick) { return tm(abbr, school, nick); };
const HOOPS = [
  ev(1, S('BUFF', 'Buffalo', 'Bulls'), S('MRSH', 'Marshall', 'Thundering Herd'), 3), ev(2, S('TOL', 'Toledo', 'Rockets'), S('ARST', 'Arkansas State', 'Red Wolves'), 3),
  ev(3, S('BCU', 'Bethune-Cookman', 'Wildcats'), S('FUR', 'Furman', 'Paladins'), 3), ev(4, S('OSU', 'Ohio State', 'Buckeyes'), S('BYU', 'BYU', 'Cougars'), 4),
  ev(5, S('SEA', 'Seattle U', 'Redhawks'), S('HAW', "Hawai'i", 'Rainbow Warriors'), 6), ev(6, S('WMU', 'Western Michigan', 'Broncos'), S('ODU', 'Old Dominion', 'Monarchs'), 3),
  ev(7, S('RMU', 'Robert Morris', 'Colonials'), S('NEV', 'Nevada', 'Wolf Pack'), 5), ev(8, S('RAD', 'Radford', 'Highlanders'), S('SF', 'San Francisco', 'Dons'), 5),
  ev(9, S('PEPP', 'Pepperdine', 'Waves'), S('COR', 'Cornell', 'Big Red'), 2), ev(10, S('UCLA', 'UCLA', 'Bruins'), S('ARIZ', 'Arizona', 'Wildcats'), 5),
  ev(11, S('MASS', 'UMass', 'Minutemen'), S('TROY', 'Troy', 'Trojans'), 3),
];
const FOOT = [
  ev(21, S('BYU', 'BYU', 'Cougars'), S('UTAH', 'Utah', 'Utes'), 116), ev(22, S('ODU', 'Old Dominion', 'Monarchs'), S('CCU', 'Coastal Carolina', 'Chanticleers'), 117),
  ev(23, S('ULM', 'UL Monroe', 'Warhawks'), S('ARST', 'Arkansas State', 'Red Wolves'), 119), ev(24, S('MRSH', 'Marshall', 'Thundering Herd'), S('GASO', 'Georgia Southern', 'Eagles'), 119),
  ev(25, S('HAW', "Hawai'i", 'Rainbow Warriors'), S('UTEP', 'UTEP', 'Miners'), 125), ev(26, S('UNM', 'New Mexico', 'Lobos'), S('NEV', 'Nevada', 'Wolf Pack'), 100),
  ev(27, S('BALL', 'Ball State', 'Cardinals'), S('MASS', 'Massachusetts', 'Minutemen'), 50), ev(28, S('OSU', 'Ohio State', 'Buckeyes'), S('PUR', 'Purdue', 'Boilermakers'), 116),
];
const json = function (o) { return { ok: true, status: 200, json: async function () { return o; }, text: async function () { return JSON.stringify(o); } }; };

(async function () {
  const realFetch = global.fetch;
  global.fetch = async function (url) {
    const u = String(url);
    if (/mens-college-basketball\/scoreboard/.test(u)) return json({ events: HOOPS });
    if (/college-football\/scoreboard/.test(u)) return json({ events: FOOT });
    if (/scoreboard/.test(u)) return json({ events: [] });
    return { ok: false, status: 404, json: async function () { return {}; }, text: async function () { return '{}'; } };
  };
  const { server } = require('../server.js');
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const post = function (p, body) { return new Promise(function (res, rej) { const d = JSON.stringify(body); const q = http.request({ host: '127.0.0.1', port: port, path: p, method: 'POST', headers: { 'content-type': 'application/json' } }, function (r) { let s = ''; r.on('data', function (c) { s += c; }); r.on('end', function () { res(JSON.parse(s)); }); }); q.on('error', rej); q.write(d); q.end(); }); };
  let fail = 0;
  const t = async function (name, f) { try { await f(); console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } };
  const ml = function (id, team, away, home, league, extra) { return Object.assign({ id: id, slip: 's', market: 'moneyline', team: team, away_team: away, home_team: home, league: league }, extra || {}); };
  const sp = function (id, team, line, away, home, league) { return { id: id, slip: 's2', market: 'spread', team: team, line: line, away_team: away, home_team: home, league: league }; };
  try {
    await t('every leg of the 6-pick slip lands in its basketball game, whatever league the reader guessed', async function () {
      for (const lg of ['cfb', 'cbb', 'nfl', null]) {
        const r = (await post('/api/resolve', { legs: [
          ml('a', 'Marshall', 'Buffalo', 'Marshall', lg), ml('b', 'Arkansas State', 'Toledo', 'Arkansas State', lg), ml('c', 'Furman', 'Bethune-Cookman', 'Furman', lg),
          ml('d', 'BYU', 'Ohio State', 'BYU', lg), ml('e', 'Hawaii', 'Seattle', 'Hawaii', lg), ml('f', 'Old Dominion', 'Western Michigan', 'Old Dominion', lg),
        ] })).results;
        const want = { a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' };
        r.forEach(function (x) { assert.strictEqual(x.gameId, want[x.id], 'label ' + lg + ', leg ' + x.id + ' went to ' + x.gameId + ' (' + x.league + ')'); assert.strictEqual(x.league, 'cbb'); });
      }
    });
    await t('spreads and the slips with Nevada, San Francisco, Cornell, Arizona and UMass', async function () {
      for (const lg of ['cfb', 'nfl', null]) {
        const r = (await post('/api/resolve', { legs: [
          ml('n', 'Nevada', 'Robert Morris', 'Nevada', lg), sp('a', 'Arkansas State', 9.5, 'Toledo', 'Arkansas State', lg), sp('f', 'Furman', 9.5, 'Bethune-Cookman', 'Furman', lg),
          ml('s', 'San Francisco', 'Radford', 'San Francisco', lg), sp('c', 'Cornell', 13.5, 'Pepperdine', 'Cornell', lg), ml('z', 'Arizona', 'UCLA', 'Arizona', lg),
          sp('m', 'UMass', 13.5, 'UMass', 'Troy', lg),
        ] })).results;
        const by = {}; r.forEach(function (x) { by[x.id] = x; });
        const want = { n: ['7', 'NEV'], a: ['2', 'ARST'], f: ['3', 'FUR'], s: ['8', 'SF'], c: ['9', 'COR'], z: ['10', 'ARIZ'], m: ['11', 'MASS'] };
        Object.keys(want).forEach(function (k) { assert.deepStrictEqual([by[k].gameId, by[k].team, by[k].league], want[k].concat('cbb'), 'label ' + lg + ', leg ' + k); });
      }
    });
    await t('a real college football leg with its football matchup stays football', async function () {
      const r = (await post('/api/resolve', { legs: [ml('a', 'BYU', 'BYU', 'Utah', 'cfb'), ml('b', 'Ohio State', 'Ohio State', 'Purdue', 'cfb'), ml('c', 'Nevada', 'New Mexico', 'Nevada', null)] })).results;
      assert.deepStrictEqual(r.map(function (x) { return x.gameId + '/' + x.league; }), ['21/cfb', '28/cfb', '26/cfb']);
    });
    await t('a leg with only one team named still uses its league label (no matchup to go on)', async function () {
      const r = (await post('/api/resolve', { legs: [{ id: 'a', market: 'moneyline', team: 'Utah', league: 'cfb' }] })).results;
      assert.strictEqual(r[0].gameId, '21');
    });
  } finally { server.close(); global.fetch = realFetch; }

  await t('tracking: a team the name lookup misses is still found through the team the server matched', function () {
    const g = { id: '3', league: 'cbb', state: 'pre', detail: '', away: { abbr: 'BCU', score: 0, linescores: [] }, home: { abbr: 'FUR', score: 0, linescores: [] }, players: [] };
    const r = E.evaluateLeg({ id: 'x', market: 'spread', team: 'Paladins of Greenville', line: 9.5, league: 'cfb', teamResolved: 'FUR' }, g);
    assert.notStrictEqual(r.state, 'unresolved', r.detail);
    const r2 = E.evaluateLeg({ id: 'y', market: 'spread', team: 'Nobody U', line: 9.5, league: 'cbb', teamResolved: 'XYZ' }, g);
    assert.strictEqual(r2.state, 'unresolved'); assert.ok(/Team not found/.test(r2.detail));
  });
  console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
  process.exit(fail ? 1 : 0);
})();
