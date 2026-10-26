/* Cloud sync (Supabase). Local-first: the browser keeps working from localStorage, and when you are signed in this
 * module mirrors two collections ("slips", "portfolio") to Postgres tables so every device sees the same data.
 *   PTCloud.create({ client, storage })  ->  { ready, user, signIn, signUp, signOut, onAuth, collection(table) }
 *   collection.sync(items) -> { adopted: [...items to add/replace locally], dropped: [ids to remove locally] }
 * Items need a string `id`. Sync stamps `updatedAt` / `_h` on them (in place). Newest updatedAt wins.
 * Works in the browser (window.PTCloud) and Node (tests, with a fake client).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PTCloud = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CHUNK = 100;

  function hashOf(it) { const c = Object.assign({}, it); delete c._h; delete c.updatedAt; return JSON.stringify(c); }
  function wrap(err) { if (err instanceof Error) return err; const e = new Error((err && err.message) || String(err)); e.cause = err; return e; }
  function memStore() { const m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); } }; }
  function chunks(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

  function create(opts) {
    const client = opts.client, store = opts.storage || memStore();
    let user = null;
    const listeners = [];
    function emit() { setTimeout(function () { listeners.forEach(function (f) { try { f(user); } catch (e) { /* ignore */ } }); }, 0); }

    const ready = (async function () {
      try { const r = await client.auth.getSession(); user = r && r.data && r.data.session ? r.data.session.user : null; } catch (e) { /* offline */ }
      try {
        client.auth.onAuthStateChange(function (ev, session) {
          const u = session ? session.user : null;
          if ((u && u.id) !== (user && user.id)) { user = u; emit(); }
        });
      } catch (e) { /* ignore */ }
    })();

    async function signIn(email, password) {
      const r = await client.auth.signInWithPassword({ email: email, password: password });
      if (r.error) throw wrap(r.error);
      user = (r.data && (r.data.user || (r.data.session && r.data.session.user))) || null; emit(); return user;
    }
    async function signUp(email, password) {
      const r = await client.auth.signUp({ email: email, password: password });
      if (r.error) throw wrap(r.error);
      if (r.data && r.data.session) { user = r.data.session.user; emit(); return { user: user, needsConfirm: false }; }
      return { user: null, needsConfirm: true };
    }
    async function signOut() { try { await client.auth.signOut(); } catch (e) { /* ignore */ } user = null; emit(); }

    function collection(table) {
      let queue = Promise.resolve();
      const key = function () { return 'parlay-tracker.cloud.' + table + '.' + (user ? user.id : 'anon'); };
      function loadState() { let s = {}; try { s = JSON.parse(store.getItem(key()) || '{}') || {}; } catch (e) { s = {}; } s.pushed = s.pushed || {}; return s; }
      function saveState(s) { try { store.setItem(key(), JSON.stringify(s)); } catch (e) { /* ignore */ } }

      /* mark items whose content changed since they were last stamped */
      function stamp(items) {
        items.forEach(function (it) {
          const h = hashOf(it);
          if (it._h !== h) { it._h = h; it.updatedAt = Math.max(Date.now(), (it.updatedAt || 0) + 1); }
        });
      }

      async function push(local, st) {
        const have = {}; local.forEach(function (i) { have[i.id] = 1; });
        const gone = Object.keys(st.pushed).filter(function (id) { return !have[id]; });
        for (const c of chunks(gone, CHUNK)) {
          const r = await client.from(table).delete().eq('user_id', user.id).in('id', c);
          if (r.error) throw wrap(r.error);
          c.forEach(function (id) { delete st.pushed[id]; }); saveState(st);
        }
        const dirty = local.filter(function (i) { return st.pushed[i.id] !== i.updatedAt; });
        for (const c of chunks(dirty, CHUNK)) {
          const rows = c.map(function (i) { return { user_id: user.id, id: i.id, data: i, updated_at: i.updatedAt }; });
          const r = await client.from(table).upsert(rows, { onConflict: 'user_id,id' });
          if (r.error) throw wrap(r.error);
          c.forEach(function (i) { st.pushed[i.id] = i.updatedAt; }); saveState(st);
        }
      }

      function adopt(row, st) {
        const it = row.data || {};
        it.id = row.id; it.updatedAt = Number(row.updated_at); it._h = hashOf(it);
        st.pushed[it.id] = it.updatedAt;
        return it;
      }

      async function doSync(local) {
        if (!user) throw new Error('Not signed in');
        const st = loadState();
        stamp(local);
        await push(local, st);
        const res = await client.from(table).select('id,data,updated_at');
        if (res.error) throw wrap(res.error);
        const rows = res.data || [], rmap = {}, lmap = {}, adopted = [], dropped = [];
        rows.forEach(function (r) { rmap[r.id] = r; });
        local.forEach(function (it) {
          lmap[it.id] = 1;
          const r = rmap[it.id];
          if (!r) { if (st.pushed[it.id] !== undefined) { dropped.push(it.id); delete st.pushed[it.id]; } return; }   // deleted on another device
          if (Number(r.updated_at) > (it.updatedAt || 0)) adopted.push(adopt(r, st));                               // newer elsewhere
        });
        rows.forEach(function (r) {
          if (lmap[r.id]) return;
          if (st.pushed[r.id] !== undefined) return;                                                                // we deleted it; delete not acknowledged yet
          adopted.push(adopt(r, st));                                                                               // new from another device
        });
        saveState(st);
        return { adopted: adopted, dropped: dropped, changed: adopted.length + dropped.length > 0 };
      }

      /* one sync at a time per collection */
      function sync(local) { const run = queue.then(function () { return doSync(local); }); queue = run.catch(function () {}); return run; }
      return { sync: sync, stamp: stamp, table: table };
    }

    return {
      ready: ready, client: client, collection: collection, signIn: signIn, signUp: signUp, signOut: signOut,
      onAuth: function (f) { listeners.push(f); },
      get user() { return user; },
    };
  }

  return { create: create, hashOf: hashOf };
});
