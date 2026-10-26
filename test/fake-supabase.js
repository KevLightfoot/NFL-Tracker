/* In-memory stand-in for the Supabase client: auth + from(table).select/upsert/delete, with per-user row isolation.
 * Shared "server" state lets tests simulate two devices. Works in Node and (injected as a script) in the browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FakeSupabase = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function makeServer() { return { users: {}, tables: {}, failNext: 0, calls: [] }; }

  function makeClient(server, initialSession) {
    let session = initialSession || null; const authCbs = [];
    function setSession(s) { session = s; authCbs.forEach(function (f) { f(s ? 'SIGNED_IN' : 'SIGNED_OUT', s); }); }
    const uidNow = function () { return session ? session.user.id : null; };
    function maybeFail() { if (server.failNext > 0) { server.failNext--; return { error: { message: 'network down' } }; } return null; }
    const rowsOf = function (t) { return (server.tables[t] = server.tables[t] || []); };

    function query(table) {
      const q = { op: null, filters: [], payload: null, opts: null };
      const exec = function () {
        const f = maybeFail(); if (f) return Promise.resolve(f);
        const uid = uidNow(); if (!uid) return Promise.resolve({ error: { message: 'JWT required' } });
        const rows = rowsOf(table);
        server.calls.push(q.op + ':' + table);
        if (q.op === 'select') return Promise.resolve({ data: rows.filter(function (r) { return r.user_id === uid; }).map(function (r) { return JSON.parse(JSON.stringify(r)); }), error: null });
        if (q.op === 'upsert') {
          for (const row of (Array.isArray(q.payload) ? q.payload : [q.payload])) {
            if (row.user_id !== uid) return Promise.resolve({ error: { message: 'RLS violation' } });
            const i = rows.findIndex(function (r) { return r.user_id === uid && r.id === row.id; });
            const copy = JSON.parse(JSON.stringify(row)); if (i >= 0) rows[i] = copy; else rows.push(copy);
          }
          return Promise.resolve({ error: null });
        }
        if (q.op === 'delete') {
          server.tables[table] = rows.filter(function (r) {
            if (r.user_id !== uid) return true;
            return !q.filters.every(function (fl) { return fl.type === 'eq' ? r[fl.col] === fl.val : fl.val.indexOf(r[fl.col]) >= 0; });
          });
          return Promise.resolve({ error: null });
        }
        return Promise.resolve({ error: { message: 'bad op' } });
      };
      const api = {
        select: function () { q.op = 'select'; return api; },
        upsert: function (rows, o) { q.op = 'upsert'; q.payload = rows; q.opts = o; return exec(); },
        delete: function () { q.op = 'delete'; return api; },
        eq: function (col, val) { q.filters.push({ type: 'eq', col: col, val: val }); return api; },
        in: function (col, val) { q.filters.push({ type: 'in', col: col, val: val }); return api; },
        then: function (a, b) { return exec().then(a, b); },
      };
      return api;
    }

    return {
      from: query,
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: session } }); },
        onAuthStateChange: function (cb) { authCbs.push(cb); return { data: { subscription: { unsubscribe: function () {} } } }; },
        signInWithPassword: function (c) {
          const u = server.users[c.email];
          if (!u || u.password !== c.password) return Promise.resolve({ data: {}, error: { message: 'Invalid login credentials' } });
          const s = { user: { id: u.id, email: c.email } }; setSession(s); return Promise.resolve({ data: { user: s.user, session: s }, error: null });
        },
        signUp: function (c) {
          if (server.users[c.email]) return Promise.resolve({ data: {}, error: { message: 'User already registered' } });
          if (String(c.password || '').length < 6) return Promise.resolve({ data: {}, error: { message: 'Password should be at least 6 characters' } });
          server.users[c.email] = { id: 'u-' + Object.keys(server.users).length + '-' + c.email.split('@')[0], password: c.password };
          const s = { user: { id: server.users[c.email].id, email: c.email } }; setSession(s); return Promise.resolve({ data: { user: s.user, session: s }, error: null });
        },
        signOut: function () { setSession(null); return Promise.resolve({ error: null }); },
      },
    };
  }
  return { makeServer: makeServer, makeClient: makeClient };
});
