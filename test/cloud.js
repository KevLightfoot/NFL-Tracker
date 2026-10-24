'use strict';
// Cloud sync: two simulated devices sharing one fake Supabase. Covers migration, edits, deletes, offline retry, privacy.
const assert = require('assert');
const FS = require('./fake-supabase.js');
const Cloud = require('../public/lib/cloud.js');

let pass = 0, fail = 0; const tests = [];
function test(n, f) { tests.push([n, f]); }
function memStore() { const m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); } }; }
async function device(server, email) {
  const cloud = Cloud.create({ client: FS.makeClient(server), storage: memStore() });
  await cloud.ready;
  if (email) await cloud.signIn(email, 'secret1');
  return { cloud: cloud, slips: cloud.collection('slips'), items: [] };
}
async function apply(d, col, r) {                 // what the app does with a sync result
  r.dropped.forEach(function (id) { d.items = d.items.filter(function (x) { return x.id !== id; }); });
  r.adopted.forEach(function (it) { const i = d.items.findIndex(function (x) { return x.id === it.id; }); if (i >= 0) d.items[i] = it; else d.items.push(it); });
  return r;
}
const sync = async function (d) { return apply(d, d.slips, await d.slips.sync(d.items.slice())); };
function setup() { const server = FS.makeServer(); server.users['k@x.com'] = { id: 'u-k', password: 'secret1' }; server.users['o@x.com'] = { id: 'u-o', password: 'secret1' }; return server; }

test('first sign-in migrates local-only items up; a second device pulls them down', async function () {
  const server = setup(), A = await device(server, 'k@x.com'), B = await device(server, 'k@x.com');
  A.items.push({ id: 's1', name: '4-leg', wager: 25 }, { id: 's2', name: 'single', wager: 10 });
  await sync(A);
  assert.strictEqual(server.tables.slips.length, 2);
  const r = await sync(B);
  assert.deepStrictEqual(B.items.map(function (x) { return x.id; }).sort(), ['s1', 's2']); assert.strictEqual(r.adopted.length, 2);
  assert.strictEqual(B.items.find(function (x) { return x.id === 's1'; }).wager, 25);
});

test('an unchanged item is not re-uploaded; an edit is, and the newest edit wins on the other device', async function () {
  const server = setup(), A = await device(server, 'k@x.com'), B = await device(server, 'k@x.com');
  A.items.push({ id: 's1', wager: 25 }); await sync(A); await sync(B);
  server.calls.length = 0; await sync(A);
  assert.ok(!server.calls.some(function (c) { return /^upsert/.test(c); }), 'no upsert when nothing changed');
  A.items[0].wager = 40; await sync(A);
  await sync(B); assert.strictEqual(B.items[0].wager, 40);
  B.items[0].wager = 55; await sync(B); await sync(A); assert.strictEqual(A.items[0].wager, 55);
});

test('deleting on one device removes it from the other (and it does not come back)', async function () {
  const server = setup(), A = await device(server, 'k@x.com'), B = await device(server, 'k@x.com');
  A.items.push({ id: 's1' }, { id: 's2' }); await sync(A); await sync(B);
  A.items = A.items.filter(function (x) { return x.id !== 's1'; }); await sync(A);
  assert.deepStrictEqual(server.tables.slips.map(function (r) { return r.id; }), ['s2']);
  const r = await sync(B); assert.deepStrictEqual(r.dropped, ['s1']); assert.deepStrictEqual(B.items.map(function (x) { return x.id; }), ['s2']);
  await sync(A); await sync(B); assert.strictEqual(A.items.length, 1); assert.strictEqual(B.items.length, 1);
});

test('offline: a failed push is retried on the next sync, nothing is lost', async function () {
  const server = setup(), A = await device(server, 'k@x.com');
  A.items.push({ id: 's1', wager: 5 });
  server.failNext = 1; await assert.rejects(function () { return sync(A); }, /network down/);
  assert.strictEqual(A.items.length, 1);
  await sync(A); assert.strictEqual(server.tables.slips.length, 1);
  A.items = []; server.failNext = 1; await assert.rejects(function () { return sync(A); });
  const B = await device(server, 'k@x.com'); await sync(B);                    // delete hasn't landed yet -> B still sees it
  assert.strictEqual(B.items.length, 1);
  await sync(A); assert.strictEqual(A.items.length, 0, 'unacknowledged delete is not resurrected'); assert.strictEqual(server.tables.slips.length, 0);
});

test('a slip added on a device while a sync is in flight is not lost', async function () {
  const server = setup(), A = await device(server, 'k@x.com'), B = await device(server, 'k@x.com');
  B.items.push({ id: 'b1' }); await sync(B);
  const p = A.slips.sync(A.items.slice());
  A.items.push({ id: 'new-during' });
  await apply(A, A.slips, await p);
  assert.deepStrictEqual(A.items.map(function (x) { return x.id; }).sort(), ['b1', 'new-during']);
  await sync(A); assert.strictEqual(server.tables.slips.length, 2);
});

test("users only see their own rows; signed-out sync refuses", async function () {
  const server = setup(), A = await device(server, 'k@x.com'), O = await device(server, 'o@x.com');
  A.items.push({ id: 'mine' }); await sync(A);
  await sync(O); assert.strictEqual(O.items.length, 0);
  const anon = await device(server, null); await assert.rejects(function () { return anon.slips.sync([]); }, /Not signed in/);
});

test('auth: sign up, bad password, sign out', async function () {
  const server = setup(), d = await device(server, null);
  await assert.rejects(function () { return d.cloud.signIn('k@x.com', 'wrong'); }, /Invalid login/);
  const r = await d.cloud.signUp('new@x.com', 'secret1'); assert.strictEqual(r.needsConfirm, false); assert.ok(d.cloud.user);
  await d.cloud.signOut(); assert.strictEqual(d.cloud.user, null);
});

(async function () {
  for (const t of tests) { try { await t[1](); pass++; console.log('  ✓ ' + t[0]); } catch (e) { fail++; console.log('  ✗ ' + t[0] + '\n    ' + (e && e.stack || e)); } }
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
