/* Parlay Tracker front-end */
(function () {
  'use strict';
  const E = window.NFLEval, T = window.NFLTeams, Demo = window.NFLDemo;
  const $ = function (s) { return document.querySelector(s); };
  const esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  const LS_COLLAPSED = 'parlay-tracker.collapsed.v1', LS_BETS = 'parlay-tracker.v1', LS_KEY = 'parlay-tracker.apiKey';
  // GitHub Pages frontend talks to the Render API. Keep this URL public; never put API keys here.
  const API_BASE = 'https://nfl-parlay-tracker.onrender.com';
  const S = { parlays: [], games: {}, gamesList: [], expanded: new Set(), collapsed: new Set(), gamesOpen: false, pending: [], config: {}, timer: null, demoTimer: null, lastUpdate: null, busy: false, again: false, fetchError: null, serverDown: false };

  /* ---------------- storage ---------------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function load() {
    try { S.parlays = JSON.parse(lsGet(LS_BETS) || '[]'); } catch (e) { S.parlays = []; }
    // Remove any old simulated demo parlay from this browser's saved state.
    S.parlays = S.parlays.filter(function (p) { return !p.demo; });
    S.parlays.forEach(function (p) { (p.legs || []).forEach(fixTdLeg); }); // repair slips saved before this fix
    // A college team that was wrongly matched to an NFL game ("S Carolina" -> Panthers): clear it so it re-matches.
    S.parlays.forEach(function (p) { (p.legs || []).forEach(function (l) {
      if (l.gameId && l.league === 'nfl' && !l.noResolve && /^(?:[nsewc] \w|north |south |east |west |central )|\b(?:state|st|tech)\b/i.test(String(l.team || '').trim())) { l.gameId = null; l.league = null; l.teamResolved = null; }
    }); });
    save();
  }
  try { S.collapsed = new Set(JSON.parse(lsGet(LS_COLLAPSED) || '[]')); } catch (e) { S.collapsed = new Set(); }
  try { S.gamesOpen = lsGet('parlay-tracker.gamesopen.v1') === '1'; } catch (e) { /* ignore */ }
  function saveCollapsed() { try { lsSet(LS_COLLAPSED, JSON.stringify(Array.from(S.collapsed))); } catch (e) { /* ignore */ } }
  function toggleParlay(pid) {
    const art = document.querySelector('.parlay[data-p="' + pid + '"]'); if (!art) return;
    const collapse = !S.collapsed.has(pid);
    if (collapse) S.collapsed.add(pid); else S.collapsed.delete(pid);
    saveCollapsed();
    art.classList.toggle('collapsed', collapse);
    const body = art.querySelector('.pbody'); if (body) body.hidden = collapse;
    const ph = art.querySelector('.ph'); if (ph) ph.setAttribute('aria-expanded', String(!collapse));
  }
  function save() { lsSet(LS_BETS, JSON.stringify(S.parlays)); cloudDirty(); }

  /* ---------------- cloud sync (Supabase) ---------------- */
  // Local-first: everything still works from this browser's storage; when signed in, slips and the portfolio are mirrored
  // to Supabase and pulled back on every device. See lib/cloud.js and supabase/schema.sql.
  const C = { cloud: null, slips: null, pf: null, timer: null, busy: false, again: false, state: 'off', msg: '', last: null };

  function cloudInit() {
    const cfg = window.PT_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase || !window.PTCloud) return;
    try {
      C.cloud = window.PTCloud.create({ client: window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY), storage: window.localStorage });
    } catch (e) { C.cloud = null; return; }
    C.slips = C.cloud.collection('slips'); C.pf = C.cloud.collection('portfolio');
    if (window.Portfolio) Portfolio.onSave(cloudDirty);
    C.cloud.onAuth(function () { acctRender(); renderBanner(); if (C.cloud.user) syncAll(); });
    C.cloud.ready.then(function () { acctRender(); renderBanner(); if (C.cloud.user) syncAll(); });
    setInterval(function () { if (!document.hidden && C.cloud && C.cloud.user) syncAll(); }, 30000);
  }

  function cloudDirty() {
    if (!C.cloud || !C.cloud.user) return;
    clearTimeout(C.timer); C.timer = setTimeout(syncAll, 700);
  }

  function setCloud(state, msg) { C.state = state; C.msg = msg || ''; if (state === 'ok') C.last = Date.now(); acctRender(); }

  function applySlips(r) {
    if (!r || !r.changed) return;
    r.dropped.forEach(function (id) { S.parlays = S.parlays.filter(function (p) { return p.id !== id; }); });
    let added = false;
    r.adopted.forEach(function (it) {
      const i = S.parlays.findIndex(function (p) { return p.id === it.id; });
      if (i >= 0) S.parlays[i] = it; else { S.parlays.push(it); added = true; }
    });
    if (added) S.parlays.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    render(); renderPending();
    if (S.parlays.length) { refreshAll(); startDemoClock(); }
    else { S.games = {}; clearTimeout(S.timer); }
  }

  async function syncAll() {
    if (!C.cloud || !C.cloud.user) return;
    if (C.busy) { C.again = true; return; }
    C.busy = true; setCloud('syncing');
    try {
      const r = await C.slips.sync(S.parlays.slice());
      applySlips(r);
      lsSet(LS_BETS, JSON.stringify(S.parlays));
      if (window.Portfolio) Portfolio.applyRemote(await C.pf.sync(Portfolio.entries().slice()));
      setCloud('ok');
    } catch (e) { setCloud('error', (e && e.message) || String(e)); }
    C.busy = false;
    if (C.again) { C.again = false; cloudDirty(); }
  }

  function acctRender() {
    const box = $('#acct'); if (!box) return;
    notifRender();
    box.hidden = !C.cloud;
    $('#setTitle').textContent = !C.cloud ? 'Settings' : C.cloud.user ? 'Account' : 'Sign in or create account';
    if (!C.cloud) return;
    const u = C.cloud.user;
    $('#acctOut').hidden = !!u; $('#acctIn').hidden = !u;
    $('#acctUser').textContent = u ? String(u.email || '').split('@')[0] : '';
    const m = $('#acctMsg'); m.className = 'hint';
    if (u) {
      if (C.state === 'syncing') m.textContent = 'Syncing…';
      else if (C.state === 'error') { m.textContent = 'Sync problem: ' + C.msg + ' — will retry.'; m.className = 'hint err'; }
      else if (C.last) { m.textContent = 'Synced ' + new Date(C.last).toLocaleTimeString() + '.'; m.className = 'hint ok'; }
      else m.textContent = '';
    } else if (C.state === 'authError') { m.textContent = C.msg; m.className = 'hint err'; }
    else if (C.state === 'confirm') { m.textContent = C.msg; m.className = 'hint ok'; }
    else m.textContent = '';
  }

  /* ---------------- push notifications ---------------- */
  // The service worker (sw.js) shows pushes; the server (notify.js) watches your slips and sends them. See supabase/push.sql.
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const STANDALONE = navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const PUSH_OK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  function keyBytes(s) { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, function (c) { return c.charCodeAt(0); }); }
  async function currentSub() { try { const reg = await navigator.serviceWorker.getRegistration(); return reg ? await reg.pushManager.getSubscription() : null; } catch (e) { return null; } }
  function notifSay(text, cls) { const m = $('#notifMsg'); if (m) { m.textContent = text; m.className = 'hint' + (cls ? ' ' + cls : ''); } }

  async function notifRender() {
    const box = $('#notif'); if (!box) return;
    const show = !!(C.cloud && C.cloud.user && S.config && S.config.vapidPublicKey);
    box.hidden = !show; if (!show) return;
    const on = $('#notifOn'), off = $('#notifOff'), test = $('#notifTest');
    [on, off, test].forEach(function (b) { b.hidden = true; b.disabled = false; });
    if (IS_IOS && !STANDALONE) return notifSay('On iPhone: tap the Share button in Safari, choose Add to Home Screen, then open Parlay Tracker from your Home Screen, sign in there, and turn notifications on.');
    if (!PUSH_OK) return notifSay('This browser can’t receive push notifications.');
    if (Notification.permission === 'denied') return notifSay('Notifications are blocked for this site. Allow them in your browser or phone settings, then come back here.', 'err');
    if (await currentSub()) { notifSay('Notifications are on for this device: you’ll get a push when a leg hits or misses and when a slip cashes, even with the app closed.', 'ok'); off.hidden = false; test.hidden = false; }
    else { notifSay('Get a push the moment a leg hits, even with the app closed.'); on.hidden = false; }
  }

  async function notifOn() {
    const btn = $('#notifOn'); btn.disabled = true;
    try {
      const perm = await Notification.requestPermission();                          // must be the first await: it needs the tap
      if (perm !== 'granted') throw new Error('Permission wasn’t granted. Allow notifications for this site and try again.');
      const reg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(S.config.vapidPublicKey) });
      const r = await C.cloud.client.from('push_subs').upsert({ user_id: C.cloud.user.id, endpoint: sub.endpoint, sub: sub.toJSON(), created_at: Date.now() }, { onConflict: 'user_id,endpoint' });
      if (r.error) throw new Error(r.error.message);
      toast('Notifications are on.');
    } catch (e) { await notifRender(); notifSay('Couldn’t turn on notifications: ' + ((e && e.message) || e), 'err'); $('#notifOn').hidden = false; return; }
    notifRender();
  }

  async function notifOff() {
    try {
      const sub = await currentSub();
      if (sub) {
        if (C.cloud && C.cloud.user) await C.cloud.client.from('push_subs').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
    } catch (e) { /* best effort */ }
    notifRender();
  }

  async function notifTest() {
    const btn = $('#notifTest'); btn.disabled = true; notifSay('Sending a test…');
    try {
      const sub = await currentSub(); if (!sub) throw new Error('This device isn’t subscribed yet.');
      await api('/api/push/test', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
      notifSay('Test sent: it should show up in a few seconds.', 'ok');
    } catch (e) { notifSay('Test failed: ' + ((e && e.message) || e), 'err'); }
    btn.disabled = false;
  }

  async function acctDo(kind) {
    // Supabase logs in by email, so a username becomes a private pseudo-email (nothing is ever sent to it).
    const uname = $('#acctEmail').value.trim().toLowerCase(), pass = $('#acctPass').value;
    if (!/^[a-z0-9][a-z0-9._-]{1,18}[a-z0-9]$/.test(uname)) { C.state = 'authError'; C.msg = 'Username: 3–20 letters, numbers, dot, dash or underscore.'; return acctRender(); }
    if (pass.length < 6) { C.state = 'authError'; C.msg = 'Password must be at least 6 characters.'; return acctRender(); }
    const email = uname + '@' + ((window.PT_CONFIG || {}).EMAIL_DOMAIN || 'gmail.com');
    const btns = ['#acctSignIn', '#acctSignUp'].map($); btns.forEach(function (b) { b.disabled = true; });
    try {
      if (kind === 'in') await C.cloud.signIn(email, pass);
      else {
        const r = await C.cloud.signUp(email, pass);
        if (r.needsConfirm) { C.state = 'confirm'; C.msg = 'Check your email and click the confirmation link, then sign in.'; }
      }
      if (C.cloud.user) { $('#acctPass').value = ''; toast('Signed in — syncing your slips and portfolio.'); }
    } catch (e) { C.state = 'authError'; C.msg = /invalid login/i.test((e && e.message) || '') ? 'Wrong username or password.' : /already registered/i.test((e && e.message) || '') ? 'That username is taken.' : ((e && e.message) || 'Could not sign in.'); }
    btns.forEach(function (b) { b.disabled = false; });
    acctRender();
  }
  const uid = function () { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3); };

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg; document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3800);
  }

  /* ---------------- api ---------------- */
  let wakePromise = null;
  async function wakeBackend() {
    if (wakePromise) return wakePromise;
    wakePromise = (async function () {
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        try {
          const r = await fetch(API_BASE + '/healthz', { cache: 'no-store' });
          if (r.ok) return;
        } catch (e) { /* Render may still be waking */ }
        await new Promise(function (resolve) { setTimeout(resolve, 4000); });
      }
      throw new Error('Backend is still waking up. Please try again in a moment.');
    })();
    try { return await wakePromise; } finally { wakePromise = null; }
  }
  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
    const key = lsGet(LS_KEY);
    if (key) headers['x-api-key'] = key;
    let res;
    try {
      res = await fetch(API_BASE + path, Object.assign({}, opts, { headers: headers }));
    } catch (e) {
      toast('Waking live data service… this can take up to a minute on the free host.');
      await wakeBackend();
      res = await fetch(API_BASE + path, Object.assign({}, opts, { headers: headers }));
    }
    let j = {};
    try { j = await res.json(); } catch (e) { /* non-json */ }
    if (!res.ok) throw new Error(j.error || ('Server error ' + res.status));
    return j;
  }

  async function fetchGame(id, league) {
    if (Demo.isDemoId(id)) return Demo.getGame(id);
    const j = await api('/api/game/' + encodeURIComponent(id) + (league ? '?league=' + league : ''));
    return j.game;
  }

  /* ---------------- formatting ---------------- */
  const money = function (n) { return n == null || n === '' || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); };
  const num = function (v) {
    if (v == null || v === '') return null;
    const x = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isFinite(x) ? x : null;
  };
  const LEAGUE_NAMES = { nfl: 'NFL', cfb: 'College football', nba: 'NBA', mlb: 'MLB' };
  const BET_LABEL = { parlay: 'Parlay', same_game_parlay: 'Same Game Parlay', single: 'Single', round_robin: 'Round Robin', teaser: 'Teaser', other: 'Bet' };

  /* Underdog/PrizePicks-style wording ("Higher 0.5 Anytime TD") often comes back as a generic prop with an
     unknown stat. Re-map touchdown-scorer legs from the slip text so they always track. */
  function fixTdLeg(leg) {
    if (!leg || !leg.player || leg.manual) return leg;
    if (['other', 'player_prop', 'anytime_td'].indexOf(leg.market) < 0) return leg;
    if (leg.market === 'player_prop' && leg.stat && leg.stat !== 'other' && leg.stat !== 'total_tds') return leg;
    const t = ((leg.raw_text || '') + ' ' + (leg.notes || '')).toLowerCase();
    if (/\bfirst\s+(td|touchdown)/.test(t)) { leg.market = 'first_td'; leg.stat = null; leg.side = 'yes'; leg.line = null; }
    else if (/\blast\s+(td|touchdown)/.test(t)) { leg.market = 'last_td'; leg.stat = null; leg.side = 'yes'; leg.line = null; }
    else if (/\b(anytime|any\s*time)\s+(td|touchdown)|\bto\s+score\s+a\s+(td|touchdown)/.test(t)) {
      if (leg.side === 'under' || /\b(lower|less|under)\b/.test(t)) { leg.market = 'player_prop'; leg.stat = 'total_tds'; leg.side = 'under'; leg.line = 0.5; }
      else { leg.market = 'anytime_td'; leg.stat = null; leg.side = 'yes'; leg.line = null; }
    }
    return leg;
  }

  // The model likes to remark on odds, percentages, payouts and boosts; those are not things the user can act on.
  function usefulWarning(w) { return !/odds|percent|%|payout|wager|stake|price|boost|trade|cash.?out|sportsbook|currency/i.test(String(w || '')); }

  /* ---------------- build parlays from parse output ---------------- */
  function normLeg(l) {
    const leg = {
      id: uid(), raw_text: l.raw_text || '', market: l.market || 'other', team: l.team || '', player: l.player || '', stat: l.stat || null,
      side: l.side || null, line: l.line == null ? null : Number(l.line), odds: l.odds || '', away_team: l.away_team || '', home_team: l.home_team || '',
      league: LEAGUE_NAMES[l.league] ? l.league : '',
      game_date: l.game_date || '', period: l.period || 'full', fantasy_system: l.fantasy_system || null, notes: l.notes || '',
      gameId: null, teamResolved: null, manual: null, manualValue: null,
    };
    if ((leg.market === 'player_prop' || leg.market === 'total' || leg.market === 'team_total') && !leg.side) leg.side = 'over';
    fixTdLeg(leg);
    if (leg.market === 'anytime_td') leg.side = 'yes';
    if (leg.line === 0 && leg.market !== 'spread') leg.line = null;   // a model "0" means "not shown", never a real line
    E.applyLadder(leg, true);                                         // "30+" is over 29.5, whatever the model returned
    if (leg.line != null && !isFinite(leg.line)) leg.line = null;
    return leg;
  }

  /* A slip without a name of your own is named after its legs: "JMU -3.5, UNT ML, Chuba 30+". Re-derived as teams resolve and legs
     are edited; once you type a name it is yours and never touched (clear the box to go back to the automatic one). */
  function refreshNames() {
    let changed = false;
    S.parlays.forEach(function (p) {
      if (p.demo || p.autoName === false || (p.name && p.autoName !== true)) return;
      const r = E.autoName(p.legs, S.games);
      if (r.text && r.text !== p.name && (r.complete || !p.name)) { p.name = r.text; p.autoName = true; changed = true; }
    });
    return changed;
  }

  function buildParlay(bet, thumb) {
    const wager = num(bet.wager);
    let payout = num(bet.payout);
    const toWin = num(bet.to_win);
    if (payout == null && wager != null && toWin != null) payout = Math.round((wager + toWin) * 100) / 100;
    return {
      id: uid(), createdAt: Date.now(), name: '', sportsbook: bet.sportsbook || '', betType: bet.bet_type || 'parlay',
      wager: wager, payout: payout, odds: bet.total_odds || '', slipStatus: bet.slip_status || '', warnings: bet.warnings || [],
      thumb: thumb || null, legs: (bet.legs || []).map(normLeg),
    };
  }

  /* ---------------- rendering ---------------- */
  function resultsFor(p) {
    return p.legs.map(function (l) { return E.evaluateLeg(l, S.games[l.gameId] || null); });
  }

  const BADGE = { hit: '✓', miss: '✕', push: '–', void: '∅', unresolved: '?', live: '', pending: '' };

  function barHTML(leg, r) {
    const pct = Math.max(0, Math.min(100, Math.round(r.progress * 1000) / 10));
    const under = leg.side === 'under';
    let cls = 'fill';
    if (under) cls += (r.progress >= 0.85 && r.state !== 'hit') ? ' warn' : ' under';
    const right = r.state === 'hit' ? '<span class="chk">✓</span>' : r.state === 'miss' ? '<span class="chk">✕</span>' : under ? '<span>UNDER</span>' : '';
    const tip = r.valueText + ' of ' + r.targetText + (r.unit ? ' ' + r.unit : '');
    return '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + esc(r.target) + '" aria-valuenow="' + esc(r.current) + '" title="' + esc(tip) + '">' +
      '<div class="' + cls + '" style="width:' + pct + '%"></div>' +
      '<div class="bar-label"><span><b>' + esc(r.valueText) + '</b> / ' + esc(r.targetText) + ' ' + esc(r.unit || '') + '</span>' + right + '</div></div>';
  }

  function legHTML(p, leg, r) {
    let mid = '';
    if (r.kind === 'bar' && r.state !== 'unresolved') mid = barHTML(leg, r);
    else if (r.kind === 'bar') mid = '';
    else if (r.kind === 'score') {
      const cls = r.state === 'pending' || r.onTrack == null ? 'neutral' : r.onTrack ? 'on' : 'off';
      mid = '<div class="scoreline ' + cls + '">' + esc(r.scoreText) + '</div>';
    } else if (r.kind === 'total') {
      const pct = Math.round(r.progress * 1000) / 10;
      mid = '<div class="scoreline neutral">' + esc(r.scoreText) + '</div><div class="mini"><i style="width:' + pct + '%"></i></div>';
    }
    const manualBits = [];
    if (leg.manual && leg.manual.state) manualBits.push('Marked ' + leg.manual.state + ' manually');
    if (leg.manualValue != null && leg.manualValue !== '') manualBits.push('Value set manually: ' + leg.manualValue);
    const canValue = leg.market === 'player_prop' || leg.market === 'anytime_td' || leg.market === 'total' || leg.market === 'team_total';
    const open = S.expanded.has(leg.id);
    const a = function (act, label, cls2) { return '<button class="btn small ' + (cls2 || '') + '" data-act="' + act + '" data-p="' + p.id + '" data-l="' + leg.id + '">' + label + '</button>'; };
    const more = '<div class="more"' + (open ? '' : ' hidden') + '>' +
      (leg.raw_text ? '<div class="raw">Slip: “' + esc(leg.raw_text) + '”</div>' : '') +
      (r.playerLine ? '<div>Box score: ' + esc(r.playerLine) + '</div>' : '') +
      (r.gameText ? '<div>Game: ' + esc(r.gameText) + '</div>' : '') +
      (manualBits.length ? '<div>' + esc(manualBits.join(' · ')) + '</div>' : '') +
      '<div class="btns">' + a('edit-leg', '✎ Edit') + (canValue ? a('set-value', '# Enter value') : '') + a('mark-hit', '✓ Hit') + a('mark-miss', '✕ Miss') +
      ((leg.manual || leg.manualValue != null) ? a('auto', '↺ Auto') : '') + '</div></div>';
    return '<li class="leg s-' + r.state + '" data-leg="' + leg.id + '" tabindex="0" aria-expanded="' + open + '">' +
      '<div class="badge"><span>' + BADGE[r.state] + '</span></div>' +
      '<div class="body"><div class="l-top"><span class="l-title">' + esc(r.title) + '</span><span class="odds">' + esc(leg.odds) + '</span></div>' +
      mid +
      '<div class="l-sub"><span class="detail">' + esc(r.detail) + '</span><span class="game">' +
      esc(r.kind === 'score' ? (r.gameText.split(' · ')[1] || '') : r.gameText) +
      ((['player_prop', 'anytime_td', 'first_td', 'last_td', 'first_basket'].indexOf(leg.market) >= 0 && S.games[leg.gameId] && S.games[leg.gameId].away && S.games[leg.gameId].home) ?
        ' <small class="prop-score">' + esc(S.games[leg.gameId].away.abbr + ' ' + S.games[leg.gameId].away.score + '–' + S.games[leg.gameId].home.abbr + ' ' + S.games[leg.gameId].home.score) + '</small>' : '') +
      '</span></div>' +
      more + '</div></li>';
  }

  /* Legs in kickoff order (earliest first); legs with no matched game keep their slip order at the end. */
  function kickoffOrder(p) {
    const t = function (l) { const g = S.games[l.gameId]; const v = g && g.date ? Date.parse(g.date) : NaN; return isNaN(v) ? Infinity : v; };
    return p.legs.map(function (l, i) { return { i: i, t: t(l) }; })
      .sort(function (a, b) { return a.t === b.t ? a.i - b.i : (a.t < b.t ? -1 : 1); })
      .map(function (x) { return x.i; });
  }

  function parlayHTML(p) {
    const order = kickoffOrder(p);
    const all = resultsFor(p);
    const results = order.map(function (i) { return all[i]; });
    const legsSorted = order.map(function (i) { return p.legs[i]; });
    const sum = E.summarize(results);
    const pill = { pending: ['pending', 'Not started'], live: ['live', 'Live · ' + sum.hits + '/' + sum.total + ' ✓'], won: ['won', 'Won ✓'], lost: ['lost', 'Lost ✕'], void: ['void', 'Void'] }[sum.status];
    const title = (p.name ? esc(p.name) : (p.legs.length + '-Leg ' + (BET_LABEL[p.betType] || 'Parlay'))) +
      '<small>' + (p.name ? p.legs.length + '-Leg ' + esc(BET_LABEL[p.betType] || 'Parlay') + ' · ' : '') + esc(p.sportsbook || (p.demo ? 'Demo' : 'Bet slip')) + '</small>';
    const segs = results.map(function (r) { return '<i class="seg ' + (['hit', 'miss', 'live', 'push', 'void'].indexOf(r.state) >= 0 ? r.state : '') + '"></i>'; }).join('');
    const shownWarns = (p.warnings || []).filter(usefulWarning);
    const warns = shownWarns.length ? '<div class="hint" style="color:#fbbf24;margin-top:8px">⚠ ' + shownWarns.map(esc).join(' · ') + '</div>' : '';
    const upd = p.demo ? 'Demo · simulated games' : (S.lastUpdate ? 'Updated ' + new Date(S.lastUpdate).toLocaleTimeString() : 'Waiting for data…');
    const collapsed = S.collapsed.has(p.id);
    return '<article class="parlay p-' + sum.status + (collapsed ? ' collapsed' : '') + '" data-p="' + p.id + '">' +
      '<div class="ph" role="button" tabindex="0" aria-expanded="' + !collapsed + '"><div class="ph-top"><div class="ph-title">' + title + '</div><span class="pill ' + pill[0] + '">' + esc(pill[1]) + '</span><span class="chev" aria-hidden="true"></span></div>' +

      '<div class="money"><div><label>WAGER</label><b>' + money(p.wager) + '</b></div><div class="payout"><label>PAYOUT</label><b>' + money(p.payout) + '</b></div><div><label>ODDS</label><b>' + esc(p.odds || '—') + '</b></div></div>' +
      '<div class="segs">' + segs + '</div>' + warns + '</div>' +
      '<div class="pbody"' + (collapsed ? ' hidden' : '') + '>' +
      '<ul class="legs">' + legsSorted.map(function (l, i) { return legHTML(p, l, results[i]); }).join('') + '</ul>' +
      '<div class="pf"><span>' + esc(upd) + '</span><span class="btns"><button class="btn small" data-act="edit-bet" data-p="' + p.id + '">Edit bet</button><button class="btn small danger" data-act="clear-slip" data-p="' + p.id + '">Clear slip</button></span></div></div></article>';
  }

  /* ---------------- all-games dropdown (only when slips cover different games) ---------------- */
  function renderGames() {
    const el = $('#gamesPanel'); if (!el) return;
    const slips = S.parlays.filter(function (p) { return p.legs.some(function (l) { return l.gameId && S.games[l.gameId]; }); });
    const byGame = {};
    slips.forEach(function (p, pi) {
      p.legs.forEach(function (l) {
        if (!l.gameId || !S.games[l.gameId]) return;
        (byGame[l.gameId] = byGame[l.gameId] || { g: S.games[l.gameId], slips: [] });
        if (byGame[l.gameId].slips.indexOf(pi) < 0) byGame[l.gameId].slips.push(pi);
      });
    });
    const rows = Object.keys(byGame).map(function (k) { return byGame[k]; });
    // Show only when there are 2+ slips and at least one game isn't in every slip.
    if (slips.length < 2 || !rows.some(function (r) { return r.slips.length < slips.length; })) { el.hidden = true; el.innerHTML = ''; return; }
    rows.sort(function (a, b) { const x = Date.parse(a.g.date), y = Date.parse(b.g.date); return (isNaN(x) ? Infinity : x) - (isNaN(y) ? Infinity : y); });
    const labels = slips.map(function (p) { return p.name || (p.legs.length + '-Leg ' + (BET_LABEL[p.betType] || 'Parlay')); });
    const seen = {};
    const names = labels.map(function (n, i) { const dup = labels.filter(function (x) { return x === n; }).length > 1; seen[n] = (seen[n] || 0) + 1; return dup ? n + ' #' + seen[n] : n; });
    const open = !!S.gamesOpen;
    el.hidden = false;
    el.innerHTML = '<button class="gp-head" type="button" aria-expanded="' + open + '" data-gp="toggle"><span><b>All games</b><small>' + rows.length + ' games across ' + slips.length + ' slips</small></span><span class="chev' + (open ? '' : ' down') + '" aria-hidden="true"></span></button>' +
      '<div class="gp-body"' + (open ? '' : ' hidden') + '>' + rows.map(function (r) {
        const g = r.g, pre = g.state === 'pre';
        return '<div class="gp-row"><div class="gp-main"><span class="gp-teams">' + esc(g.away.abbr) + (pre ? '' : ' <b>' + esc(g.away.score) + '</b>') + ' @ ' + esc(g.home.abbr) + (pre ? '' : ' <b>' + esc(g.home.score) + '</b>') + '</span>' +
          '<span class="gp-status' + (g.state === 'in' ? ' live' : '') + '">' + esc(E.gameStatusText(g)) + '</span></div>' +
          '<div class="gp-chips">' + r.slips.map(function (pi) { return '<span class="gp-chip">' + esc(names[pi]) + '</span>'; }).join('') + '</div></div>';
      }).join('') + '</div>';
  }

  function render() {
    const root = $('#parlays');
    const prev = {};
    root.querySelectorAll('.leg').forEach(function (li) {
      const f = li.querySelector('.fill, .mini i');
      if (f) prev[li.dataset.leg] = f.style.width;
    });
    const focusId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.leg : null;
    root.innerHTML = S.parlays.map(parlayHTML).join('');
    root.querySelectorAll('.leg').forEach(function (li) {
      const f = li.querySelector('.fill, .mini i');
      if (!f) return;
      const target = f.style.width;
      f.style.width = prev[li.dataset.leg] != null ? prev[li.dataset.leg] : '0%';
      void f.offsetWidth;
      requestAnimationFrame(function () { f.style.width = target; });
    });
    if (focusId) { const el = root.querySelector('.leg[data-leg="' + focusId + '"]'); if (el) el.focus({ preventScroll: true }); }
    $('#empty').hidden = S.parlays.length > 0 || S.pending.length > 0;
    renderGames();
  }

  function renderPending() {
    $('#pending').innerHTML = S.pending.map(function (x) {
      return '<div class="pending-card' + (x.error ? ' err' : '') + '" data-pid="' + x.id + '">' +
        (x.thumb ? '<img alt="" src="' + x.thumb + '">' : '') +
        '<div class="grow">' + (x.error ? '<b>Couldn’t read that slip</b><div class="msg">' + esc(x.error) + '</div>' : '<b>Reading your slip…</b><div class="hint">Finding every leg and market</div>') + '</div>' +
        (x.error ? '<button class="btn small" data-pact="retry" data-pid="' + x.id + '">Retry</button><button class="btn small ghost" data-pact="dismiss" data-pid="' + x.id + '">Dismiss</button>' : '<div class="loader"></div>') + '</div>';
    }).join('');
    $('#empty').hidden = S.parlays.length > 0 || S.pending.length > 0;
  }

  function renderBanner() {
    const b = $('#banner');
    let html = '', cls = 'banner';
    if (S.serverDown) { cls += ' error'; html = 'Can’t reach the Parlay Tracker server. Start it with <code>npm start</code> and open <b>http://localhost:3000</b> (don’t open the HTML file directly).'; }
    else if (S.fetchError) { cls += ' error'; html = 'Live scores unavailable right now: ' + esc(S.fetchError) + ' — retrying automatically.'; }
    else if (S.config.hasServerKey === false && !lsGet(LS_KEY)) { html = 'Slip reading isn’t set up yet: the server has no OPENAI_API_KEY.'; }
    else if (C.cloud && !C.cloud.user) { html = 'Sign in to sync your slips and portfolio across devices. <button class="btn small" id="bannerKey">Open Settings</button>'; }
    b.className = cls; b.hidden = !html; b.innerHTML = html;
  }

  /* ---------------- diagnostics: tell the server when something looks wrong (shows up in Render → Logs) ---------------- */
  const reported = new Set();
  let reportCount = 0;
  function report(ev, data, key) {
    try {
      if (key) { if (reported.has(key)) return; reported.add(key); }
      if (++reportCount > 40) return;
      const u = C.cloud && C.cloud.user ? String(C.cloud.user.id || '').slice(0, 8) : '';
      fetch(API_BASE + '/api/log', { method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true, body: JSON.stringify({ ev: ev, uid: u, data: data }) }).catch(function () {});
    } catch (e) { /* diagnostics must never break the app */ }
  }
  window.addEventListener('error', function (e) { report('js_error', { msg: String(e.message || '').slice(0, 200), at: String(e.filename || '').split('/').pop() + ':' + e.lineno }); });
  window.addEventListener('unhandledrejection', function (e) { report('js_rejection', { msg: String((e.reason && e.reason.message) || e.reason || '').slice(0, 200) }); });
  // Legs whose game started but whose player isn't found, and legs no game could be found for, with everything needed to see why.
  function auditLegs() {
    S.parlays.forEach(function (p) {
      if (p.demo) return;
      p.legs.forEach(function (l) {
        const brief = { slip: String(p.id).slice(0, 6), player: l.player, team: l.team, resolved: l.teamResolved, league: l.league, market: l.market, stat: l.stat, side: l.side, line: l.line, raw: String(l.raw_text || '').slice(0, 60), gameId: l.gameId };
        if (!l.gameId && l.market !== 'other' && !l.noResolve) { report('unresolved_leg', brief, 'u' + l.id); return; }
        const g = S.games[l.gameId];
        if (!g) return;
        if (l.player && g.state !== 'pre' && !l.manual) {
          const r = E.evaluateLeg(l, g);
          if (/^Not in the box score/.test(r.detail || '')) report('no_player_in_box', Object.assign({ game: g.away && g.home ? g.away.abbr + '@' + g.home.abbr : '', gl: g.league, players: (g.players || []).length, state: g.state }, brief), 'n' + l.id);
        }
        if (E.hasLine && ['spread', 'total', 'team_total', 'player_prop'].indexOf(l.market) >= 0 && l.side !== 'yes' && !E.hasLine(l)) report('missing_line', brief, 'm' + l.id);
      });
    });
  }

  /* ---------------- refresh loop ---------------- */
  async function refreshAll() {
    if (S.busy) { S.again = true; return; }
    S.busy = true; document.body.classList.add('spinning');
    let err = null;
    try {
      const need = [], slipOf = {};
      S.parlays.forEach(function (p) { p.legs.forEach(function (l) { E.applyLadder(l, false); if (!l.gameId && !l.noResolve && l.market !== 'other') { need.push(l); slipOf[l.id] = p.id; } }); });
      if (need.length) {
        try {
          const j = await api('/api/resolve', { method: 'POST', body: JSON.stringify({ legs: need.map(function (l) { return { id: l.id, slip: slipOf[l.id] || '', market: l.market, team: l.team, player: l.player, away_team: l.away_team, home_team: l.home_team, game_date: l.game_date, league: l.league || null }; }) }) });
          (j.results || []).forEach(function (r) {
            const l = need.find(function (x) { return x.id === r.id; });
            if (l) { if (r.gameId) l.gameId = r.gameId; if (r.team) l.teamResolved = r.team; if (r.league) l.league = r.league; }
          });
        } catch (e) { err = e.message; }
      }
      const ids = [], leagueOf = {};
      S.parlays.forEach(function (p) { p.legs.forEach(function (l) { if (l.gameId && ids.indexOf(l.gameId) < 0) ids.push(l.gameId); if (l.gameId && l.league) leagueOf[l.gameId] = l.league; }); });
      await Promise.all(ids.map(async function (id) {
        try { S.games[id] = await fetchGame(id, leagueOf[id]); } catch (e) { err = e.message; }
      }));
      S.fetchError = err; S.serverDown = false;
      S.lastUpdate = Date.now();
      refreshNames();
      auditLegs();
      save();
    } catch (e) { S.fetchError = e.message; }
    S.busy = false; document.body.classList.remove('spinning');
    render(); renderBanner(); schedule();
    if (S.again) { S.again = false; setTimeout(refreshAll, 50); }
  }

  function schedule() {
    clearTimeout(S.timer);
    if (!S.parlays.length) return;
    const gs = [];
    S.parlays.forEach(function (p) { p.legs.forEach(function (l) { if (S.games[l.gameId]) gs.push(S.games[l.gameId]); }); });
    const unresolved = S.parlays.some(function (p) { return p.legs.some(function (l) { return !l.gameId && l.market !== 'other'; }); });
    let delay = 5 * 60000;
    if (gs.some(function (g) { return g.state === 'in'; })) delay = 20000;
    else if (gs.some(function (g) { return g.state === 'pre'; })) delay = 60000;
    if (unresolved || S.fetchError) delay = Math.min(delay, 30000);
    S.timer = setTimeout(refreshAll, delay);
  }

  function startDemoClock() {
    clearInterval(S.demoTimer);
    if (!S.parlays.some(function (p) { return p.demo; })) return;
    S.demoTimer = setInterval(function () {
      if (Demo.done()) { clearInterval(S.demoTimer); }
      Demo.tick(0.06);
      refreshAll();
    }, 2000);
  }

  /* ---------------- upload ---------------- */
  function prepImage(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        try {
          /* The vision model downsizes anything over ~1568px on its long edge, which turns a long phone
             screenshot (many legs) into unreadable mush. So: keep full width, and cut tall images into
             overlapping ~1500px slices that are each read at full resolution. */
          const nw = img.naturalWidth, nh = img.naturalHeight;
          const LONG = 1568, TILE = 1500, OVERLAP = 180;
          const sc = nh > nw ? Math.min(1, 1200 / nw) : Math.min(1, LONG / nw);
          const w = Math.max(1, Math.round(nw * sc)), h = Math.max(1, Math.round(nh * sc));
          const spans = [];
          if (h <= LONG) spans.push([0, h]);
          else for (let y = 0; ;) { const end = Math.min(h, y + TILE); spans.push([y, end]); if (end >= h) break; y = end - OVERLAP; }
          const tiles = spans.map(function (s) {
            const th = s[1] - s[0];
            const c = document.createElement('canvas'); c.width = w; c.height = th;
            const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, th);
            ctx.drawImage(img, 0, s[0] / sc, nw, th / sc, 0, 0, w, th);
            let q = 0.9, data = c.toDataURL('image/jpeg', q);
            while (data.length > 6.2e6 && q > 0.4) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
            return { mediaType: 'image/jpeg', data: data.split(',')[1] };
          });
          const tc = document.createElement('canvas'); const ts = 120 / Math.max(nw, nh);
          tc.width = Math.max(1, Math.round(nw * ts)); tc.height = Math.max(1, Math.round(nh * ts));
          tc.getContext('2d').drawImage(img, 0, 0, tc.width, tc.height);
          URL.revokeObjectURL(url);
          resolve({ tiles: tiles, thumb: tc.toDataURL('image/jpeg', 0.6) });
        } catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not open that image. Use a PNG or JPG screenshot (HEIC isn’t supported by this browser).')); };
      img.src = url;
    });
  }

  async function processGroup(entry) {
    entry.error = null; renderPending();
    try {
      const imgs = [];
      for (const f of entry.files) imgs.push(await prepImage(f));
      if (!entry.thumb) entry.thumb = imgs[0].thumb;
      const tiles = [].concat.apply([], imgs.map(function (i) { return i.tiles; }));
      if (tiles.length > 12) throw new Error('That screenshot is extremely long (' + tiles.length + ' slices). Upload it in two or three smaller pieces.');
      renderPending();
      const j = await api('/api/parse', { method: 'POST', body: JSON.stringify({ images: tiles }) });
      const bets = (j.bets && j.bets.length ? j.bets : [j.bet || {}]).map(function (b) { return buildParlay(b, entry.thumb); }).filter(function (p) { return p.legs.length; });
      if (!bets.length) throw new Error('No bets found in that image. Try a clearer or fuller screenshot.');
      S.pending = S.pending.filter(function (x) { return x.id !== entry.id; });
      bets.reverse().forEach(function (p) { S.parlays.unshift(p); });
      save(); renderPending(); render(); refreshAll();
      const warn = [].concat.apply([], bets.map(function (p) { return (p.warnings || []).filter(usefulWarning); }));
      if (bets.length > 1) toast(bets.length + ' bets found — each is tracked separately.');
      else if (warn.length) toast('Check this slip: ' + warn[0]);
    } catch (e) {
      entry.error = e.message || 'Something went wrong.';
      if (/Failed to fetch|NetworkError/i.test(entry.error)) entry.error = 'Can’t reach the server. Is it running?';
      renderPending();
    }
  }

  function handleFiles(list) {
    const files = Array.prototype.slice.call(list || []).filter(function (f) { return /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(f.name); });
    if (!files.length) { toast('That doesn’t look like an image.'); return; }
    const combine = files.length > 1 && $('#combine').checked;
    const groups = combine ? [files] : files.map(function (f) { return [f]; });
    groups.forEach(function (g) {
      const entry = { id: uid(), files: g, thumb: null, error: null };
      S.pending.unshift(entry);
      processGroup(entry);
    });
  }

  /* ---------------- leg / bet actions ---------------- */
  function findLeg(pid, lid) {
    const p = S.parlays.find(function (x) { return x.id === pid; });
    const l = p && p.legs.find(function (x) { return x.id === lid; });
    return { p: p, l: l };
  }

  function act(name, pid, lid) {
    const f = findLeg(pid, lid), p = f.p, l = f.l;
    if (!p) return;
    if (name === 'edit-bet') return openBetDialog(p);
    if (name === 'clear-slip') {
      const finish = function () {
        S.parlays = S.parlays.filter(function (x) { return x.id !== p.id; });
        p.legs.forEach(function (leg) { S.expanded.delete(leg.id); });
        save(); render(); renderPending();
        if (S.parlays.length) refreshAll();
        else { S.games = {}; clearTimeout(S.timer); clearInterval(S.demoTimer); }
        toast('Slip cleared.');
      };
      if (window.Portfolio) {
        // Offer to log it in the portfolio as Placed / Won / Lost before clearing.
        const results = resultsFor(p), sum = E.summarize(results);
        Portfolio.promptSave({
          parlay: p, status: sum.status,
          legs: p.legs.map(function (l, i) { return { title: results[i].title, state: results[i].state, odds: l.odds || '' }; }),
        }, finish);
      } else if (confirm('Clear this slip? This cannot be undone.')) finish();
      return;
    }
    if (!l) return;
    if (name === 'edit-leg') return openLegDialog(p, l);
    if (name === 'mark-hit') { l.manual = { state: 'hit' }; }
    else if (name === 'mark-miss') { l.manual = { state: 'miss' }; }
    else if (name === 'auto') { l.manual = null; l.manualValue = null; }
    else if (name === 'set-value') {
      const cur = l.manualValue != null ? l.manualValue : '';
      const v = prompt('Enter the current value for:\n' + E.describeLeg(l), cur);
      if (v === null) return;
      if (v.trim() === '') l.manualValue = null;
      else { const n = num(v); if (n == null) { toast('Enter a number.'); return; } l.manualValue = n; }
    }
    save(); render();
  }

  function toggleLeg(id) { if (S.expanded.has(id)) S.expanded.delete(id); else S.expanded.add(id); render(); }

  /* ---- dialogs ---- */
  let editing = null;

  function openBetDialog(p) {
    editing = { p: p };
    $('#bName').value = p.name || ''; $('#bWager').value = p.wager == null ? '' : p.wager; $('#bPayout').value = p.payout == null ? '' : p.payout;
    $('#bOdds').value = p.odds || ''; $('#bBook').value = p.sportsbook || '';
    $('#dlgBet').returnValue = ''; $('#dlgBet').showModal();
  }

  function dateLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString([], { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  async function openLegDialog(p, l) {
    editing = { p: p, l: l };
    const sel = $('#lStat');
    sel.innerHTML = '<option value="">—</option>' + Object.keys(E.STAT_GROUPS).map(function (grp) {
      return '<optgroup label="' + esc(grp) + '">' + E.STAT_GROUPS[grp].map(function (k) { return '<option value="' + k + '">' + esc(E.STAT_LABEL[k]) + '</option>'; }).join('') + '</optgroup>';
    }).join('');
    $('#legRaw').textContent = l.raw_text ? 'From slip: “' + l.raw_text + '”' : '';
    $('#lMarket').value = l.market; $('#lPeriod').value = l.period || 'full'; $('#lTeam').value = l.team || ''; $('#lPlayer').value = l.player || '';
    $('#lStat').value = l.stat || ''; $('#lSide').value = l.side || ''; $('#lLine').value = l.line == null ? '' : l.line;
    const gs = $('#lGame'), lgSel = $('#lLeague');
    lgSel.value = l.league || '';
    function fillGames() {
      const want = lgSel.value, keep = gs.value;
      const opts = function (list) { return list.map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(g.away.abbr + ' @ ' + g.home.abbr + ' · ' + dateLabel(g.date)) + '</option>'; }).join(''); };
      gs.innerHTML = '<option value="auto">Auto-detect</option>' + Object.keys(LEAGUE_NAMES).map(function (lk) {
        const list = S.gamesList.filter(function (g) { return (g.league || 'nfl') === lk; });
        return want && want !== lk || !list.length ? '' : '<optgroup label="' + esc(LEAGUE_NAMES[lk]) + '">' + opts(list) + '</optgroup>';
      }).join('');
      if (l.gameId && !Demo.isDemoId(l.gameId) && l.pinned) gs.value = l.gameId;
      if (keep && gs.querySelector('option[value="' + keep + '"]')) gs.value = keep;
    }
    lgSel.onchange = fillGames;
    fillGames();
    $('#dlgLeg').returnValue = ''; $('#dlgLeg').showModal();
    if (!S.gamesList.length && !Demo.isDemoId(l.gameId || '')) {
      try { S.gamesList = (await api('/api/games')).games || []; fillGames(); } catch (e) { /* optional */ }
    }
  }

  function wireDialogs() {
    $('#dlgBet').addEventListener('close', function () {
      if ($('#dlgBet').returnValue !== 'save' || !editing) return;
      const p = editing.p;
      const typed = $('#bName').value.trim();
      if (typed !== (p.name || '')) { p.autoName = typed === ''; p.name = typed; if (!typed) refreshNames(); }
      p.wager = num($('#bWager').value); p.payout = num($('#bPayout').value);
      p.odds = $('#bOdds').value.trim(); p.sportsbook = $('#bBook').value.trim();
      save(); render();
    });
    $('#btnDeleteBet').addEventListener('click', function () {
      if (!editing || !confirm('Delete this bet?')) return;
      S.parlays = S.parlays.filter(function (x) { return x.id !== editing.p.id; });
      $('#dlgBet').close('cancel'); save(); render(); renderPending(); startDemoClock();
    });
    $('#dlgLeg').addEventListener('close', function () {
      if ($('#dlgLeg').returnValue !== 'save' || !editing || !editing.l) return;
      const l = editing.l;
      l.market = $('#lMarket').value; l.period = $('#lPeriod').value; l.team = $('#lTeam').value.trim(); l.player = $('#lPlayer').value.trim();
      l.stat = $('#lStat').value || null; l.side = $('#lSide').value || null;
      const ln = $('#lLine').value.replace(/[−–]/g, '-').trim(); l.line = ln === '' ? null : num(ln);
      const g = $('#lGame').value, pickedLeague = $('#lLeague').value;
      if (g !== 'auto') {
        const pg = S.gamesList.find(function (x) { return x.id === g; });
        l.gameId = g; l.pinned = true; l.noResolve = false; l.league = pg && pg.league ? pg.league : (pickedLeague || l.league || '');
      } else if (!Demo.isDemoId(l.gameId || '')) { l.pinned = false; l.gameId = null; l.teamResolved = null; l.league = pickedLeague; }
      if (l.market === 'anytime_td') l.side = 'yes';
      save(); render(); refreshAll();
    });
    $('#btnDeleteLeg').addEventListener('click', function () {
      if (!editing || !editing.l) return;
      const p = editing.p;
      p.legs = p.legs.filter(function (x) { return x.id !== editing.l.id; });
      if (!p.legs.length) S.parlays = S.parlays.filter(function (x) { return x.id !== p.id; });
      $('#dlgLeg').close('cancel'); save(); render(); renderPending(); startDemoClock();
    });
    $('#btnClearAll').addEventListener('click', function () {
      if (!confirm('Delete ALL tracked bets?')) return;
      S.parlays = []; S.games = {}; S.expanded.clear(); save(); render(); renderPending(); $('#dlgSettings').close('cancel'); clearInterval(S.demoTimer);
    });
  }

  /* ---------------- init ---------------- */
  function init() {
    load();
    const drop = $('#drop'), file = $('#file');
    // Keep desktop click-to-upload, but on touch devices let the box act as a paste target.
    drop.addEventListener('click', function (e) {
      if (e.target.closest('#combineWrap')) return;
      drop.focus();
      if (!window.matchMedia('(pointer: coarse)').matches) file.click();
    });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (window.matchMedia('(pointer: coarse)').matches) drop.focus();
        else file.click();
      }
    });
    const choosePhoto = $('#choosePhoto');
    if (choosePhoto) choosePhoto.addEventListener('click', function () { file.click(); });
    $('#combineWrap').hidden = false;
    $('#combineWrap').addEventListener('click', function (e) { e.stopPropagation(); });
    file.addEventListener('change', function () { handleFiles(file.files); file.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { window.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { window.addEventListener(ev, function (e) { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement || !e.relatedTarget) drop.classList.remove('over'); }); });
    window.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
    document.addEventListener('paste', function (e) {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      const files = [];
      for (let i = 0; i < items.length; i++) if (items[i].kind === 'file' && /^image\//.test(items[i].type)) files.push(items[i].getAsFile());
      if (files.length) { e.preventDefault(); handleFiles(files); }
    });

    $('#parlays').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act]');
      if (btn) { e.stopPropagation(); act(btn.dataset.act, btn.dataset.p, btn.dataset.l); return; }
      const ph = e.target.closest('.ph');
      if (ph) { toggleParlay(ph.closest('.parlay').dataset.p); return; }
      const li = e.target.closest('.leg');
      if (li && !e.target.closest('.more')) toggleLeg(li.dataset.leg);
    });
    $('#parlays').addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ph')) { e.preventDefault(); toggleParlay(e.target.closest('.parlay').dataset.p); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('leg')) { e.preventDefault(); toggleLeg(e.target.dataset.leg); }
    });
    $('#gamesPanel').addEventListener('click', function (e) {
      if (!e.target.closest('[data-gp="toggle"]')) return;
      S.gamesOpen = !S.gamesOpen; try { lsSet('parlay-tracker.gamesopen.v1', S.gamesOpen ? '1' : '0'); } catch (x) { /* ignore */ }
      renderGames();
    });
    $('#pending').addEventListener('click', function (e) {
      const b = e.target.closest('[data-pact]'); if (!b) return;
      const entry = S.pending.find(function (x) { return x.id === b.dataset.pid; });
      if (!entry) return;
      if (b.dataset.pact === 'retry') processGroup(entry);
      else { S.pending = S.pending.filter(function (x) { return x !== entry; }); renderPending(); }
    });
    $('#banner').addEventListener('click', function (e) { if (e.target.id === 'bannerKey') $('#btnSettings').click(); });

    $('#btnRefresh').addEventListener('click', function () { refreshAll(); });
    $('#btnSettings').addEventListener('click', function () { $('#dlgSettings').returnValue = ''; acctRender(); $('#dlgSettings').showModal(); });
    $('#acctSignIn').addEventListener('click', function () { acctDo('in'); });
    $('#acctSignUp').addEventListener('click', function () { acctDo('up'); });
    $('#notifOn').addEventListener('click', notifOn);
    $('#notifOff').addEventListener('click', notifOff);
    $('#notifTest').addEventListener('click', notifTest);
    $('#acctSignOut').addEventListener('click', async function () { await notifOff(); await C.cloud.signOut(); C.state = 'off'; C.last = null; acctRender(); renderBanner(); toast('Signed out. Your data stays in the cloud.'); });
    $('#acctPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); acctDo('in'); } });
    $('#acctEmail').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#acctPass').focus(); } });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { if (S.parlays.length) refreshAll(); syncAll(); } });

    wireDialogs();
    cloudInit();
    render(); renderPending();
    api('/api/config').then(function (c) { S.config = c; renderBanner(); notifRender(); }).catch(function () { S.serverDown = true; renderBanner(); });
    if (S.parlays.length) { refreshAll(); startDemoClock(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();