'use strict';
// The bettor's note goes to the reader with the screenshot; short card names ("RADF" @ "SAN FRAN") still find their game.
const assert = require('assert'), http = require('http');
const now = Date.now(), H = 36e5, iso = function (h) { return new Date(now + h * H).toISOString(); };
const team = function (id, abbr, name, short, nick) { return { id: String(id), abbreviation: abbr, displayName: name, shortDisplayName: short, name: nick, location: short }; };
const ev = function (id, away, home, h) { const st = { period: 0, displayClock: '0:00', type: { state: 'pre', completed: false, shortDetail: '' } };
  return { id: String(id), date: iso(h), status: st, competitions: [{ date: iso(h), status: st, competitors: [{ homeAway: 'away', team: away, score: '0' }, { homeAway: 'home', team: home, score: '0' }] }] }; };
const json = function (o, st) { return { ok: (st || 200) < 400, status: st || 200, json: async function () { return o; }, text: async function () { return JSON.stringify(o); } }; };
const reply = function (bet) { return json({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_bet', arguments: JSON.stringify(bet) } }] } }] }); };

(async function () {
  const realFetch = global.fetch, oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test';
  const sent = [];
  let modelBet = { bet_type: 'single', wager: 10, payout: 20, legs: [{ raw_text: 'Seattle ML', market: 'moneyline', team: 'Seattle', league: 'cbb', away_team: 'Seattle', home_team: 'Hawaii' }] };
  global.fetch = async function (url, opts) {
    const u = String(url);
    if (/openai/.test(u)) { sent.push(JSON.parse(opts.body)); return reply(modelBet); }
    if (/\/nfl\/scoreboard/.test(u)) return json({ events: [ev(1, team(25, 'SF', 'San Francisco 49ers', '49ers', '49ers'), team(14, 'LAR', 'Los Angeles Rams', 'Rams', 'Rams'), 30)] });
    if (/mens-college-basketball\/scoreboard/.test(u)) return json({ events: [ev(2, team(2515, 'RAD', 'Radford Highlanders', 'Radford', 'Highlanders'), team(2539, 'SF', 'San Francisco Dons', 'San Francisco', 'Dons'), 2)] });
    if (/scoreboard/.test(u)) return json({ events: [] });
    return json({}, 404);
  };
  const { server } = require('../server.js');
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const post = function (p, body) { return new Promise(function (res, rej) { const d = JSON.stringify(body); const q = http.request({ host: '127.0.0.1', port: port, path: p, method: 'POST', headers: { 'content-type': 'application/json' } }, function (r) { let s = ''; r.on('data', function (c) { s += c; }); r.on('end', function () { res(JSON.parse(s)); }); }); q.on('error', rej); q.write(d); q.end(); }); };
  const img = [{ mediaType: 'image/png', data: 'aGVsbG8=' }];
  const texts = function (b) { return b.messages[1].content.filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join(' | '); };
  let fail = 0;
  const t = async function (name, f) { try { await f(); console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } };
  try {
    await t('the note goes to the reader with the screenshot, cleaned and capped at 300 characters', async function () {
      sent.length = 0;
      await post('/api/parse', { images: img, note: '  Seattle is college\nbasketball vs "Hawaii"\u0007  ' });
      assert.ok(/The bettor wrote this note/.test(texts(sent[0])));
      assert.ok(texts(sent[0]).indexOf("Note: \"Seattle is college basketball vs 'Hawaii'\"") >= 0, texts(sent[0]));
      sent.length = 0;
      await post('/api/parse', { images: img, note: 'x'.repeat(900) });
      assert.ok(texts(sent[0]).indexOf('x'.repeat(300) + '"') >= 0 && texts(sent[0]).indexOf('x'.repeat(301)) < 0);
    });
    await t('no note: nothing extra is sent', async function () {
      sent.length = 0;
      await post('/api/parse', { images: img }); await post('/api/parse', { images: img, note: '   ' });
      sent.forEach(function (b) { assert.ok(!/bettor wrote/.test(texts(b))); });
    });
    await t('the note also goes with the second look when lines were missing', async function () {
      sent.length = 0;
      modelBet = { bet_type: 'single', wager: 10, payout: 20, legs: [{ raw_text: 'Flagg points', market: 'player_prop', player: 'Cooper Flagg', stat: 'points', side: 'over', line: null }] };
      await post('/api/parse', { images: img, note: 'Duke basketball' });
      assert.strictEqual(sent.length, 2); sent.forEach(function (b) { assert.ok(/Duke basketball/.test(texts(b))); });
    });
    await t('"RADF @ SAN FRAN" finds the Radford–San Francisco basketball game (not the 49ers), whatever the league label', async function () {
      for (const lg of ['nfl', 'cbb', null]) {
        const r = (await post('/api/resolve', { legs: [{ id: 'a', market: 'moneyline', team: 'SAN FRAN', away_team: 'RADF', home_team: 'SAN FRAN', league: lg }] })).results;
        assert.deepStrictEqual([r[0].gameId, r[0].league, r[0].team], ['2', 'cbb', 'SF'], 'label ' + lg);
      }
    });
    await t('loose names never stretch to a different spelling ("Rado" is not Radford, "Sant" is not San Francisco)', async function () {
      const r = (await post('/api/resolve', { legs: [{ id: 'a', market: 'moneyline', team: 'Rado', away_team: 'Rado', home_team: 'Sant', league: 'cbb' }] })).results;
      assert.strictEqual(r[0].gameId, null);
    });
  } finally { server.close(); global.fetch = realFetch; if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; }
  console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
  process.exit(fail ? 1 : 0);
})();
