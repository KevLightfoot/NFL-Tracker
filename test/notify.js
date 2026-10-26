'use strict';
// Push notifications: Web Push crypto (RFC 8291 vector + round trip), VAPID signing, Supabase REST shape, and the checker's rules.
const assert = require('assert');
const crypto = require('crypto');
const N = require('../notify.js');
const Stats = require('../public/lib/stats.js');
const E = require('../public/lib/evaluate.js');
const F = require('./fixtures.js');

let pass = 0, fail = 0; const tests = [];
function test(n, f) { tests.push([n, f]); }
const b64u = function (b) { return Buffer.from(b).toString('base64url'); };

/* ---------- crypto ---------- */
test('payload encryption matches the RFC 8291 published test vector', function () {
  const sub = { endpoint: 'https://push.example.net/x', keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } };
  const r = N.encrypt('When I grow up, I want to be a watermelon', sub, { asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
  assert.strictEqual(b64u(r.ikm), 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg');
  assert.strictEqual(b64u(r.cek), 'oIhVW04MRdy2XN9CiKLxTg');
  assert.strictEqual(b64u(r.nonce), '4h_95klXJ5E_qnoN');
  assert.strictEqual(b64u(r.body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

function browserSide() {                                   // what the phone's push service does: decrypt with its private key
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16);
  return {
    sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } },
    decrypt: function (body) {
      const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
      const hk = function (ikm, s, info, len) { return Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, len)); };
      const ikm = hk(ua.computeSecret(asPub), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32);
      const d = crypto.createDecipheriv('aes-128-gcm', hk(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hk(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      d.setAuthTag(ct.subarray(ct.length - 16));
      const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
      assert.strictEqual(plain[plain.length - 1], 2, 'record delimiter'); return plain.subarray(0, plain.length - 1).toString();
    },
  };
}
function vapidPair() {
  const k = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), j = k.privateKey.export({ format: 'jwk' });
  return { pub: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')])), priv: j.d, publicKey: k.publicKey };
}

test('a sent message round-trips, carries a valid VAPID signature, and expired devices are flagged', async function () {
  const dev = browserSide(), v = vapidPair(), vapid = N.makeVapid(v.pub, v.priv, 'mailto:me@example.com');
  let seen = null;
  const mk = function (status) { return async function (url, init) { seen = { url: url, init: init }; return { status: status, text: async function () { return 'body'; } }; }; };
  let r = await N.sendWebPush(dev.sub, { title: 'Leg hit ✓', body: 'Dak 230 yds' }, vapid, mk(201));
  assert.ok(r.ok); assert.strictEqual(seen.url, dev.sub.endpoint);
  assert.deepStrictEqual(JSON.parse(dev.decrypt(seen.init.body)), { title: 'Leg hit ✓', body: 'Dak 230 yds' });
  assert.strictEqual(seen.init.headers['content-encoding'], 'aes128gcm');
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(seen.init.headers.authorization); assert.ok(m, seen.init.headers.authorization);
  assert.strictEqual(m[2], v.pub);
  const [h, c, s] = m[1].split('.');
  assert.ok(crypto.verify('sha256', Buffer.from(h + '.' + c), { key: v.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), 'signature verifies');
  const claims = JSON.parse(Buffer.from(c, 'base64url')); assert.strictEqual(claims.aud, 'https://fcm.googleapis.com'); assert.strictEqual(claims.sub, 'mailto:me@example.com');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp - Date.now() / 1000 <= 24 * 3600);
  r = await N.sendWebPush(dev.sub, { title: 'x' }, vapid, mk(410)); assert.ok(!r.ok && r.gone);
  r = await N.sendWebPush(dev.sub, { title: 'x' }, vapid, mk(500)); assert.ok(!r.ok && !r.gone);
});

test('Supabase REST calls: right URLs, keys and filters', async function () {
  const calls = [], f = async function (url, init) { calls.push({ url: url, init: init }); return { ok: true, status: 200, json: async function () { return [{ a: 1 }]; }, text: async function () { return ''; } }; };
  let db = N.makeDb('https://abc.supabase.co/', 'sb_secret_xyz', f);
  assert.deepStrictEqual(await db.select('slips', 'select=id&user_id=eq.u1'), [{ a: 1 }]);
  assert.strictEqual(calls[0].url, 'https://abc.supabase.co/rest/v1/slips?select=id&user_id=eq.u1');
  assert.strictEqual(calls[0].init.headers.apikey, 'sb_secret_xyz'); assert.ok(!calls[0].init.headers.authorization, 'new-style secret keys are not JWTs: no Bearer header');
  await db.upsert('leg_state', [{ x: 1 }], 'user_id,slip_id,leg_id');
  assert.strictEqual(calls[1].url, 'https://abc.supabase.co/rest/v1/leg_state?on_conflict=user_id,slip_id,leg_id'); assert.strictEqual(calls[1].init.method, 'POST');
  assert.ok(/merge-duplicates/.test(calls[1].init.headers.prefer));
  await db.del('push_subs', 'endpoint=eq.zzz'); assert.strictEqual(calls[2].init.method, 'DELETE');
  db = N.makeDb('https://abc.supabase.co', 'eyJhbGciOi.legacy.jwt', f); await db.select('slips', ''); assert.strictEqual(calls[3].init.headers.authorization, 'Bearer eyJhbGciOi.legacy.jwt');
  const bad = N.makeDb('https://abc.supabase.co', 'k', async function () { return { ok: false, status: 401, text: async function () { return 'nope'; } }; });
  await assert.rejects(function () { return bad.select('slips', ''); }, /401/);
});

/* ---------- the checker ---------- */
function memDb() {                                         // tiny PostgREST stand-in: eq. / in. filters, upsert by key, delete
  const t = { push_subs: [], slips: [], leg_state: [] }, keys = { leg_state: ['user_id', 'slip_id', 'leg_id'], push_subs: ['user_id', 'endpoint'] };
  const parse = function (qs) {
    const f = [], p = new URLSearchParams(qs);
    p.forEach(function (v, k) {
      if (k === 'select' || k === 'on_conflict') return;
      if (v.startsWith('eq.')) f.push(function (r) { return String(r[k]) === v.slice(3); });
      else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map(function (x) { return x.replace(/^"|"$/g, ''); }); f.push(function (r) { return set.indexOf(String(r[k])) >= 0; }); }
    });
    return function (r) { return f.every(function (x) { return x(r); }); };
  };
  return {
    t: t,
    select: async function (table, qs) { const m = parse(qs); return t[table].filter(m).map(function (r) { return JSON.parse(JSON.stringify(r)); }); },
    upsert: async function (table, rows) { rows.forEach(function (row) { const k = keys[table], i = t[table].findIndex(function (r) { return k.every(function (c) { return r[c] === row[c]; }); }); if (i >= 0) t[table][i] = Object.assign({}, t[table][i], row); else t[table].push(Object.assign({}, row)); }); },
    del: async function (table, qs) { const m = parse(qs); t[table] = t[table].filter(function (r) { return !m(r); }); },
  };
}

function world() {
  const vp = vapidPair();
  const w = { away: 17, home: 24, state: 'in', calls: 0, sent: [], goneEndpoints: {}, db: memDb() };
  w.game = function () { return Stats.normalizeSummary(F.summary({ id: 401, away: 'IND', home: 'HOU', state: w.state, period: w.state === 'post' ? 4 : 3, clock: '5:12', awayScore: w.away, homeScore: w.home, detail: w.state === 'post' ? 'Final' : '5:12 - 3rd' }), '401', 'nfl'); };
  w.n = N.create({
    env: { VAPID_PUBLIC_KEY: vp.pub, VAPID_PRIVATE_KEY: vp.priv }, db: w.db, E: E,
    getGames: async function () { return [{ id: '401', league: 'nfl', state: w.state }, { id: '402', league: 'nfl', state: 'pre' }]; },
    getGame: async function (id) { w.calls++; return w.game(); },
    send: async function (sub, payload) { w.sent.push({ endpoint: sub.endpoint, payload: payload }); return w.goneEndpoints[sub.endpoint] ? { ok: false, status: 410, gone: true, text: 'gone' } : { ok: true, status: 201 }; },
  });
  w.sub = function (user, ep) { w.db.t.push_subs.push({ user_id: user, endpoint: ep, sub: { endpoint: ep, keys: { p256dh: 'x', auth: 'y' } } }); };
  w.slip = function (user, id, legs, extra) { const i = w.db.t.slips.findIndex(function (r) { return r.user_id === user && r.id === id; }); const row = { user_id: user, id: id, data: Object.assign({ id: id, wager: 10, payout: 50, legs: legs }, extra || {}) }; if (i >= 0) w.db.t.slips[i] = row; else w.db.t.slips.push(row); };
  return w;
}
const L = {
  over:  function (id, line) { return { id: id, market: 'total', side: 'over', line: line, gameId: '401', league: 'nfl' }; },
  under: function (id, line) { return { id: id, market: 'total', side: 'under', line: line, gameId: '401', league: 'nfl' }; },
  ml:    function (id, team) { return { id: id, market: 'moneyline', team: team, gameId: '401', league: 'nfl' }; },
};

test('checker: first sighting is a silent baseline; a leg that hits notifies once, with the right wording', async function () {
  const w = world(); w.sub('u1', 'https://p/1');
  w.slip('u1', 's1', [L.over('a', 44.5), L.ml('b', 'Texans'), { id: 'c', market: 'moneyline', team: 'Jets', gameId: '402', league: 'nfl' }]);
  let r = await w.n.tick(); assert.strictEqual(w.sent.length, 0, 'baseline never notifies'); assert.strictEqual(r.slips, 1); assert.deepStrictEqual(r.errors, []);
  await w.n.tick(); assert.strictEqual(w.sent.length, 0, 'nothing changed');
  w.away = 21; w.home = 27;                                  // total 48 > 44.5 -> leg a hits
  await w.n.tick();
  assert.strictEqual(w.sent.length, 1);
  assert.strictEqual(w.sent[0].payload.title, '✓ Leg hit'); assert.ok(/Over 44\.5/.test(w.sent[0].payload.body), w.sent[0].payload.body); assert.ok(/1\/3 legs in/.test(w.sent[0].payload.body), w.sent[0].payload.body);
  await w.n.tick(); await w.n.tick(); assert.strictEqual(w.sent.length, 1, 'never twice');
});

test('checker: a missed leg, then the final whistle settles the slip as won', async function () {
  const w = world(); w.sub('u1', 'https://p/1');
  w.slip('u1', 'dead', [L.under('a', 50.5), L.ml('b', 'Texans')]);
  w.slip('u1', 'win', [L.over('a', 44.5), L.ml('b', 'Texans')]);
  await w.n.tick();
  w.away = 28; w.home = 27;                                  // total 55: under 50.5 busts, over 44.5 hits
  await w.n.tick();
  const titles = w.sent.map(function (m) { return m.payload.title; }).sort();
  assert.deepStrictEqual(titles, ['✓ Leg hit', '✕ Leg missed'], titles.join('|'));
  const missMsg = w.sent.find(function (m) { return /missed/.test(m.payload.title); }).payload.body;
  assert.ok(/Under 50\.5/.test(missMsg) && /dead/.test(missMsg), missMsg);
  w.sent.length = 0; w.state = 'post'; w.away = 24; w.home = 31;   // Texans win -> ML hits -> 'win' slip cashes
  await w.n.tick();
  const t2 = w.sent.map(function (m) { return m.payload.title; });
  assert.ok(t2.indexOf('🎉 Parlay cashed!') >= 0, t2.join('|'));
  assert.strictEqual(t2.filter(function (x) { return /cashed/.test(x); }).length, 1, 'only the winning slip cashes');
  const calls = w.calls; await w.n.tick(); assert.strictEqual(w.sent.length, t2.length, 'no repeats after final');
  assert.strictEqual(w.calls, calls, 'settled legs cost no more ESPN lookups');
});

test('checker: only subscribed users are checked, and each user hears only about their own slips', async function () {
  const w = world(); w.sub('u1', 'https://p/1'); w.sub('u1', 'https://p/laptop'); w.sub('u2', 'https://p/2');
  w.slip('u1', 'mine', [L.over('a', 44.5)]); w.slip('u2', 'theirs', [L.under('a', 50.5)]); w.slip('u3', 'nosub', [L.over('a', 30.5)]);
  const r = await w.n.tick(); assert.strictEqual(r.slips, 2, 'u3 has no push subscription: not read');
  w.away = 21; w.home = 27;
  await w.n.tick();
  assert.deepStrictEqual(w.sent.map(function (m) { return m.endpoint; }).sort(), ['https://p/1', 'https://p/laptop'], 'both of u1’s devices, nobody else');
  assert.ok(w.sent.every(function (m) { return /cashed/.test(m.payload.title); }), 'a single-leg bet sends one "cashed" message, not hit + cashed');
  assert.ok(!w.db.t.leg_state.some(function (x) { return x.user_id === 'u3'; }));
});

test('checker: manual marks and already-settled legs never notify; expired devices are removed; cleared slips are forgotten', async function () {
  const w = world(); w.sub('u1', 'https://p/ok'); w.sub('u1', 'https://p/dead'); w.goneEndpoints['https://p/dead'] = true;
  w.slip('u1', 's1', [L.over('a', 44.5), Object.assign(L.under('b', 70.5), { manual: null })]);
  await w.n.tick();
  w.slip('u1', 's1', [L.over('a', 44.5), Object.assign(L.under('b', 70.5), { manual: { state: 'hit' } })]);   // you tapped "✓ Hit" yourself
  await w.n.tick(); assert.strictEqual(w.sent.length, 0, 'your own manual mark is not news');
  w.away = 21; w.home = 27; await w.n.tick();
  assert.strictEqual(w.sent.length, 2, 'both devices tried (one message each: the slip cashed)'); assert.ok(!w.db.t.push_subs.some(function (s) { return s.endpoint === 'https://p/dead'; }), '410 -> subscription deleted');
  // new slip whose leg is already hit when first seen -> baseline only
  w.sent.length = 0; w.slip('u1', 's2', [L.over('z', 10.5)]); await w.n.tick(); assert.strictEqual(w.sent.length, 0);
  // slip cleared by the user -> its state rows are cleaned up
  w.db.t.slips = w.db.t.slips.filter(function (r) { return r.id !== 's1'; }); await w.n.tick();
  assert.ok(!w.db.t.leg_state.some(function (x) { return x.slip_id === 's1'; }));
});

test('checker: test push goes to one registered device only; unconfigured server stays inert', async function () {
  const w = world(); w.sub('u1', 'https://p/1'); w.sub('u2', 'https://p/2');
  let r = await w.n.sendTest('https://p/2'); assert.ok(r.ok); assert.deepStrictEqual(w.sent.map(function (m) { return m.endpoint; }), ['https://p/2']);
  r = await w.n.sendTest('https://p/unknown'); assert.ok(!r.ok && r.status === 404);
  const off = N.create({ env: {}, E: E }); assert.strictEqual(off.enabled, false); assert.deepStrictEqual(await off.tick(), { skipped: 'not configured' }); assert.strictEqual(off.publicKey, null);
});


test('service worker: shows the pushed message; tapping it focuses the open app or opens it', async function () {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const L = {}, shown = [], opened = []; let focused = 0, closed = 0;
  const self = {
    addEventListener: function (t, f) { L[t] = f; }, skipWaiting: function () {},
    registration: { scope: 'https://u.github.io/app/', showNotification: function (title, o) { shown.push([title, o]); return Promise.resolve(); } },
    clients: { claim: function () { return Promise.resolve(); }, matchAll: async function () { return self._wins; }, openWindow: function (u) { opened.push(u); return Promise.resolve(); } }, _wins: [],
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), { self: self });
  let waited; const ev = function (extra) { return Object.assign({ waitUntil: function (p) { waited = p; } }, extra); };
  L.push(ev({ data: { json: function () { return { title: '✓ Leg hit', body: 'Dak Prescott Over 219.5', tag: 's1:a' }; } } })); await waited;
  assert.strictEqual(shown[0][0], '✓ Leg hit'); assert.strictEqual(shown[0][1].body, 'Dak Prescott Over 219.5'); assert.strictEqual(shown[0][1].tag, 's1:a'); assert.strictEqual(shown[0][1].data.url, 'https://u.github.io/app/');
  L.push(ev({ data: null })); await waited; assert.strictEqual(shown[1][0], 'Parlay Tracker', 'always shows something (browsers require it)');
  const n = { close: function () { closed++; }, data: { url: 'https://u.github.io/app/' } };
  L.notificationclick(ev({ notification: n })); await waited; assert.deepStrictEqual(opened, ['https://u.github.io/app/']); assert.strictEqual(closed, 1);
  self._wins = [{ focus: function () { focused++; return Promise.resolve(); } }];
  L.notificationclick(ev({ notification: n })); await waited; assert.strictEqual(focused, 1); assert.strictEqual(opened.length, 1, 'reuses the open window');
});

(async function () {
  for (const t of tests) { try { await t[1](); pass++; console.log('  ✓ ' + t[0]); } catch (e) { fail++; console.log('  ✗ ' + t[0] + '\n    ' + (e && e.stack || e)); } }
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
