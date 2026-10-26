'use strict';
/*
 * Push notifications for Parlay Tracker (zero dependencies).
 *  - Web Push: RFC 8291 (aes128gcm payload encryption) + RFC 8292 (VAPID), built on node:crypto.
 *  - Checker: every minute, looks at the slips of every signed-in user who turned notifications on, evaluates each leg
 *    against live ESPN data, and pushes when a leg HITS or MISSES and when a whole slip WINS.
 *  - Storage: Supabase REST (PostgREST) with the server-only secret key. Tables: slips, push_subs, leg_state (supabase/push.sql).
 */
const crypto = require('crypto');

const TERMINAL = { hit: 1, miss: 1, push: 1, void: 1 };
const b64u = function (b) { return Buffer.from(b).toString('base64url'); };

/* ---------------- Web Push ---------------- */
function makeVapid(publicKey, privateKey, subject) {
  const pub = Buffer.from(publicKey, 'base64url');
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY must be a base64url P-256 public key (65 bytes). Generate one with: node scripts/gen-vapid.js');
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: privateKey }, format: 'jwk' });
  return {
    publicKey: publicKey,
    header: function (endpoint) {
      const data = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' +
        b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
      const sig = crypto.sign('sha256', Buffer.from(data), { key: key, dsaEncoding: 'ieee-p1363' });
      return 'vapid t=' + data + '.' + b64u(sig) + ', k=' + publicKey;
    },
  };
}

/* RFC 8291 message encryption. `fixed` ({asPrivate, salt}) exists only so tests can use the RFC's published vector. */
function encrypt(plain, sub, fixed) {
  const uaPublic = Buffer.from(sub.keys.p256dh, 'base64url'), authSecret = Buffer.from(sub.keys.auth, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  if (fixed && fixed.asPrivate) ecdh.setPrivateKey(Buffer.from(fixed.asPrivate, 'base64url')); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = fixed && fixed.salt ? Buffer.from(fixed.salt, 'base64url') : crypto.randomBytes(16);
  const hkdf = function (ikm, s, info, len) { return Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, len)); };
  const ikm = hkdf(shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plain), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = asPublic.length;
  return { body: Buffer.concat([head, asPublic, ct]), cek: cek, nonce: nonce, ikm: ikm };
}

async function sendWebPush(sub, payload, vapid, fetchFn) {
  const res = await (fetchFn || fetch)(sub.endpoint, {
    method: 'POST',
    headers: { authorization: vapid.header(sub.endpoint), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '3600', urgency: 'high' },
    body: encrypt(JSON.stringify(payload), sub).body,
  });
  let text = ''; try { text = await res.text(); } catch (e) { /* ignore */ }
  return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410, text: text.slice(0, 300) };
}

/* ---------------- Supabase REST ---------------- */
function makeDb(url, key, fetchFn) {
  const base = String(url).replace(/\/+$/, '') + '/rest/v1/', f = fetchFn || fetch;
  const headers = function (extra) {
    return Object.assign({ apikey: key, 'content-type': 'application/json' }, /^eyJ/.test(key) ? { authorization: 'Bearer ' + key } : {}, extra || {});
  };
  async function call(method, table, qs, body, prefer) {
    const res = await f(base + table + (qs ? '?' + qs : ''), { method: method, headers: headers(prefer ? { prefer: prefer } : null), body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error('Supabase ' + method + ' ' + table + ' failed (' + res.status + '): ' + String(await res.text()).slice(0, 200));
    return method === 'GET' ? res.json() : null;
  }
  return {
    select: function (table, qs) { return call('GET', table, qs); },
    upsert: function (table, rows, onConflict) { return rows.length ? call('POST', table, 'on_conflict=' + onConflict, rows, 'resolution=merge-duplicates,return=minimal') : Promise.resolve(); },
    del: function (table, qs) { return call('DELETE', table, qs, null, 'return=minimal'); },
  };
}
const inList = function (arr) { return 'in.(' + arr.map(function (x) { return '"' + String(x).replace(/["\\]/g, '') + '"'; }).join(',') + ')'; };

/* ---------------- message wording ---------------- */
const money = function (n) { return n == null || isNaN(n) ? '' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(+n) ? 0 : 2, maximumFractionDigits: 2 }); };
function slipName(p) { return p.name || (p.legs.length + '-Leg ' + (p.legs.length === 1 ? 'Bet' : 'Parlay')); }
function message(kind, p, leg, hits) {
  const n = p.legs.length, parlay = n > 1;
  if (kind === 'hit') return { title: '✓ Leg hit', body: leg + '\n' + (parlay ? hits + '/' + n + ' legs in' + (p.payout ? ' · ' + money(p.wager) + ' → ' + money(p.payout) : '') : 'Bet cashed' + (p.payout ? ' · ' + money(p.payout) : '')) };
  if (kind === 'miss') return { title: '✕ Leg missed', body: leg + (parlay ? '\nYour ' + slipName(p) + ' is dead' : '') };
  return { title: '🎉 ' + (parlay ? 'Parlay' : 'Bet') + ' cashed!', body: slipName(p) + (p.payout ? ' pays ' + money(p.payout) : '') };
}

/* ---------------- the checker ---------------- */
function create(opts) {
  const env = opts.env || {};
  const enabled = !!((opts.db || (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY)) && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  let vapid = null, db = opts.db || null;
  if (enabled) {
    vapid = makeVapid(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT || 'mailto:admin@example.com');
    if (!db) db = makeDb(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, opts.fetch);
  }
  const send = opts.send || function (sub, payload) { return sendWebPush(sub, payload, vapid, opts.fetch); };
  const E = opts.E;
  const state = { running: false, last: null };

  async function pushTo(subs, payload, out) {
    for (const s of subs) {
      try {
        const r = await send(s.sub, payload);
        if (r.ok) out.sent++;
        else {
          out.errors.push('push ' + r.status + ' ' + (r.text || ''));
          if (r.gone) await db.del('push_subs', 'user_id=eq.' + s.user_id + '&endpoint=eq.' + encodeURIComponent(s.endpoint));
        }
      } catch (e) { out.errors.push('push: ' + e.message); }
    }
  }

  async function tick() {
    if (!enabled) return { skipped: 'not configured' };
    if (state.running) return { skipped: 'busy' };
    state.running = true;
    const out = { at: new Date().toISOString(), users: 0, slips: 0, games: 0, sent: 0, errors: [] };
    try {
      const subs = await db.select('push_subs', 'select=user_id,endpoint,sub');
      const subsBy = {}; subs.forEach(function (s) { (subsBy[s.user_id] = subsBy[s.user_id] || []).push(s); });
      const users = Object.keys(subsBy); out.users = users.length;
      if (!users.length) return out;
      const [slipRows, stateRows] = await Promise.all([
        db.select('slips', 'select=user_id,id,data&user_id=' + inList(users)),
        db.select('leg_state', 'select=user_id,slip_id,leg_id,state&user_id=' + inList(users)),
      ]);
      const prev = new Map(stateRows.map(function (r) { return [r.user_id + '|' + r.slip_id + '|' + r.leg_id, r.state]; }));
      const slips = slipRows.filter(function (r) { return r.data && Array.isArray(r.data.legs) && r.data.legs.length; });
      out.slips = slips.length;

      // which live/finished games do we need to look at? (not-started games and already-settled legs are skipped)
      const board = new Map((await opts.getGames()).map(function (g) { return [g.id, g]; }));
      const need = new Map();
      slips.forEach(function (r) {
        r.data.legs.forEach(function (l) {
          if (!l.gameId || TERMINAL[prev.get(r.user_id + '|' + r.id + '|' + l.id)]) return;
          const b = board.get(String(l.gameId));
          if (b && b.state === 'pre') return;
          need.set(String(l.gameId), (b && b.league) || l.league || null);
        });
      });
      const games = {};
      for (const [id, league] of need) { try { games[id] = await opts.getGame(id, league); out.games++; } catch (e) { out.errors.push('game ' + id + ': ' + e.message); } }

      const rows = [], todo = [];
      slips.forEach(function (r) {
        const p = r.data, k = function (leg) { return r.user_id + '|' + r.id + '|' + leg; };
        const results = p.legs.map(function (l) {
          const before = prev.get(k(l.id));
          if (TERMINAL[before]) return { state: before, before: before, leg: l };
          const g = l.gameId ? games[String(l.gameId)] : null;
          if (l.gameId && !g) return { state: before || 'pending', before: before, leg: l };      // game not started (or fetch failed): nothing to evaluate yet
          const ev = E.evaluateLeg(l, g || null);
          return { state: ev.state, before: before, leg: l, title: ev.title, manual: !!(l.manual || l.manualValue != null) };
        });
        const hits = results.filter(function (x) { return x.state === 'hit'; }).length, mine = [];
        results.forEach(function (x) {
          if (x.state !== x.before) rows.push({ user_id: r.user_id, slip_id: r.id, leg_id: x.leg.id, state: x.state, updated_at: Date.now() });
          if (x.before === undefined || x.manual || x.state === x.before) return;              // first sighting = baseline, never a notification
          if (x.state === 'hit' || x.state === 'miss') mine.push({ user: r.user_id, payload: Object.assign(message(x.state, p, x.title || 'A leg', hits), { tag: r.id + ':' + x.leg.id }) });
        });
        const status = E.summarize(results).status, sb = prev.get(k('_slip'));
        if (status !== sb) rows.push({ user_id: r.user_id, slip_id: r.id, leg_id: '_slip', state: status, updated_at: Date.now() });
        if (sb !== undefined && status === 'won' && sb !== 'won') todo.push({ user: r.user_id, payload: Object.assign(message('won', p, '', hits), { tag: r.id + ':won' }) });   // the winning leg's "hit" is folded into this
        else Array.prototype.push.apply(todo, mine);
      });

      await db.upsert('leg_state', rows, 'user_id,slip_id,leg_id');                              // remember first, send second: never notify twice
      const perUser = {};
      for (const t of todo) {
        perUser[t.user] = (perUser[t.user] || 0) + 1;
        if (perUser[t.user] <= 20) await pushTo(subsBy[t.user], t.payload, out);
      }

      // forget state for slips that were cleared
      const live = new Set(slips.map(function (r) { return r.user_id + '|' + r.id; })), orphans = {};
      stateRows.forEach(function (r) { if (!live.has(r.user_id + '|' + r.slip_id)) (orphans[r.user_id] = orphans[r.user_id] || new Set()).add(r.slip_id); });
      for (const u of Object.keys(orphans)) await db.del('leg_state', 'user_id=eq.' + u + '&slip_id=' + inList(Array.from(orphans[u])));
      return out;
    } catch (e) { out.errors.push(e.message); return out; }
    finally { state.running = false; state.last = out; }
  }

  async function sendTest(endpoint) {
    if (!enabled) return { ok: false, status: 503, text: 'Notifications are not configured on the server yet.' };
    const rows = await db.select('push_subs', 'select=user_id,endpoint,sub&endpoint=eq.' + encodeURIComponent(endpoint));
    if (!rows.length) return { ok: false, status: 404, text: 'This device is not registered. Turn notifications on again.' };
    const out = { sent: 0, errors: [] };
    await pushTo(rows, { title: '✓ Notifications are working', body: 'You’ll get a push when a leg hits.', tag: 'test' }, out);
    return out.sent ? { ok: true, status: 200 } : { ok: false, status: 502, text: out.errors.join('; ') || 'The push service rejected the message.' };
  }

  return { enabled: enabled, tick: tick, sendTest: sendTest, status: function () { return { enabled: enabled, last: state.last }; }, publicKey: enabled ? env.VAPID_PUBLIC_KEY : null };
}

module.exports = { create: create, encrypt: encrypt, makeVapid: makeVapid, sendWebPush: sendWebPush, makeDb: makeDb, message: message };
