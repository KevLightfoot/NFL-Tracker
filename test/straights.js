'use strict';
// "Straight bets" toggle: the reader is told every row is its own single, and a parlay that still comes back is split into singles.
const assert = require('assert'), http = require('http');
const json = function (o, st) { return { ok: (st || 200) < 400, status: st || 200, json: async function () { return o; }, text: async function () { return JSON.stringify(o); } }; };
const reply = function (bet) { return json({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_bet', arguments: JSON.stringify(bet) } }] } }] }); };
const leg = function (team, line, odds) { return { raw_text: team + ' ' + line + ' ' + odds, market: 'spread', team: team, line: line, odds: odds, league: 'nfl' }; };
const FOUR = [leg('Kansas City Chiefs', -15, '-105'), leg('Panthers', -2.5, '-105'), leg('Bills', -16.5, '-105'), leg('Vikings', 4, '-112')];

(async function () {
  const realFetch = global.fetch, oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test';
  const sent = []; let modelBet;
  global.fetch = async function (url, opts) {
    const u = String(url);
    if (/openai/.test(u)) { sent.push(JSON.parse(opts.body)); return reply(modelBet); }
    if (/scoreboard/.test(u)) return json({ events: [] });
    return json({}, 404);
  };
  const { server, splitStraights } = require('../server.js');
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const post = function (body) { return new Promise(function (res, rej) { const d = JSON.stringify(body); const q = http.request({ host: '127.0.0.1', port: port, path: '/api/parse', method: 'POST', headers: { 'content-type': 'application/json' } }, function (r) { let s = ''; r.on('data', function (c) { s += c; }); r.on('end', function () { res(JSON.parse(s)); }); }); q.on('error', rej); q.write(d); q.end(); }); };
  const img = [{ mediaType: 'image/png', data: 'aGVsbG8=' }];
  const texts = function (b) { return b.messages[1].content.filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join(' | '); };
  let fail = 0;
  const t = async function (name, f) { try { await f(); console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } };
  try {
    await t('Straight bets on: the reader is told each row is its own single; off: nothing extra', async function () {
      modelBet = { bet_type: 'single', wager: 52, payout: null, legs: [FOUR[0]] };
      sent.length = 0; await post({ images: img, straights: true });
      assert.ok(/STRAIGHT BETS/.test(texts(sent[0])) && /exactly ONE leg/.test(texts(sent[0])));
      sent.length = 0; await post({ images: img }); await post({ images: img, straights: 'yes' });
      sent.forEach(function (b) { assert.ok(!/STRAIGHT BETS/.test(texts(b))); });
    });
    await t('the reader still returns one 4-leg parlay: it is split into 4 singles, each with its own odds', async function () {
      modelBet = { bet_type: 'parlay', wager: 20, payout: 300, legs: FOUR };
      const r = await post({ images: img, straights: true });
      assert.strictEqual(r.bets.length, 4);
      r.bets.forEach(function (b, i) { assert.strictEqual(b.bet_type, 'single'); assert.strictEqual(b.legs.length, 1); assert.strictEqual(b.legs[0].team, FOUR[i].team); assert.strictEqual(b.total_odds, FOUR[i].odds); assert.strictEqual(b.wager, null); });
    });
    await t('the reader returns 4 singles with their own money: kept as they are', async function () {
      modelBet = { bet_type: 'single', wager: null, to_win: 50, total_odds: '-105', slip_status: 'won', legs: [FOUR[0]], additional_bets: [
        { bet_type: 'single', wager: 52, payout: null, total_odds: '-105', slip_status: 'lost', legs: [FOUR[1]] },
        { bet_type: 'single', wager: null, to_win: 50, total_odds: '-105', slip_status: 'won', legs: [FOUR[2]] },
        { bet_type: 'single', wager: 52, payout: null, total_odds: '-112', slip_status: 'lost', legs: [FOUR[3]] }] };
      const r = await post({ images: img, straights: true });
      assert.strictEqual(r.bets.length, 4);
      assert.deepStrictEqual(r.bets.map(function (b) { return [b.wager, b.to_win || null, b.slip_status]; }), [[null, 50, 'won'], [52, null, 'lost'], [null, 50, 'won'], [52, null, 'lost']]);
    });
    await t('toggle off: a real parlay stays one parlay', async function () {
      modelBet = { bet_type: 'parlay', wager: 20, payout: 300, legs: FOUR };
      const r = await post({ images: img });
      assert.strictEqual(r.bets.length, 1); assert.strictEqual(r.bets[0].legs.length, 4); assert.strictEqual(r.bets[0].bet_type, 'parlay');
    });
    await t('splitStraights leaves singles alone and never loses a leg', function () {
      const one = splitStraights({ bet_type: 'single', wager: 5, legs: [FOUR[0]], additional_bets: [{ bet_type: 'parlay', legs: FOUR.slice(1) }] });
      const all = [one].concat(one.additional_bets);
      assert.strictEqual(all.length, 4); assert.strictEqual(one.wager, 5);
      assert.deepStrictEqual(all.map(function (b) { return b.legs[0].team; }), FOUR.map(function (l) { return l.team; }));
    });
  } finally { server.close(); global.fetch = realFetch; if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; }
  console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
  process.exit(fail ? 1 : 0);
})();
