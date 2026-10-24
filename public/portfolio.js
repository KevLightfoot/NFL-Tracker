/* Portfolio: keeps a permanent log of slips (placed / won / lost) with money totals,
 * daily / weekly / YTD logs and a by-date filter. Self-contained: pure math + its own UI.
 * Browser: window.Portfolio   Node (tests): require('./portfolio.js')
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Portfolio = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LS_KEY = 'parlay-tracker.portfolio.v1';
  const WEEK_START = 2; // 0=Sun … 2=Tue. NFL betting weeks run Tue → Mon (Thu, Sun and Monday games land together).

  /* ======================= pure logic (unit-tested) ======================= */
  const pad = function (n) { return String(n).padStart(2, '0'); };
  const round2 = function (x) { return Math.round(x * 100) / 100; };
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function parseDay(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(s, n) { const d = parseDay(s); d.setDate(d.getDate() + n); return ymd(d); }
  function weekStart(s) { const d = parseDay(s); d.setDate(d.getDate() - ((d.getDay() - WEEK_START + 7) % 7)); return ymd(d); }
  const num = function (v) {
    if (v == null || v === '') return null;
    const x = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isFinite(x) ? x : null;
  };

  /* money result of one entry: won = payout - wager, lost = -wager, placed = nothing settled yet */
  function profit(e) {
    if (e.status === 'won') return e.payout != null && e.wager != null ? round2(e.payout - e.wager) : 0;
    if (e.status === 'lost') return e.wager != null ? -round2(e.wager) : 0;
    return 0;
  }

  function summarize(list) {
    const s = { count: list.length, placed: 0, won: 0, lost: 0, atRisk: 0, wagered: 0, moneyWon: 0, moneyLost: 0, net: 0, settledWager: 0, winRate: null, roi: null };
    list.forEach(function (e) {
      const w = e.wager || 0;
      s.wagered += w;
      if (e.status === 'won') { s.won++; s.moneyWon += profit(e); s.settledWager += w; }
      else if (e.status === 'lost') { s.lost++; s.moneyLost += w; s.settledWager += w; }
      else { s.placed++; s.atRisk += w; }
    });
    ['atRisk', 'wagered', 'moneyWon', 'moneyLost', 'settledWager'].forEach(function (k) { s[k] = round2(s[k]); });
    s.net = round2(s.moneyWon - s.moneyLost);
    if (s.won + s.lost) s.winRate = s.won / (s.won + s.lost);
    if (s.settledWager > 0) s.roi = s.net / s.settledWager;
    return s;
  }

  function filter(entries, f) {
    f = f || {};
    return entries.filter(function (e) {
      if (f.status && f.status !== 'all' && f.status !== 'placed' && e.status !== f.status) return false;   // 'placed' = every bet you placed

      if (f.date && e.date !== f.date) return false;
      return true;
    });
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dayLabel(s) { const d = parseDay(s); return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate(); }
  function shortDay(s) { const d = parseDay(s); return MONTHS[d.getMonth()] + ' ' + d.getDate(); }

  const byNewest = function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0); };

  /* mode: 'day' | 'week' | 'ytd' (ytd = current-year entries grouped by month) */
  function group(entries, mode, year) {
    year = year || String(new Date().getFullYear());
    const map = {};
    entries.forEach(function (e) {
      let key, label;
      if (mode === 'week') { key = weekStart(e.date); label = 'Week of ' + shortDay(key) + ' – ' + shortDay(addDays(key, 6)); }
      else if (mode === 'ytd') {
        if (e.date.slice(0, 4) !== year) return;
        key = e.date.slice(0, 7); label = MONTHS_LONG[+e.date.slice(5, 7) - 1] + ' ' + year;
      } else { key = e.date; label = dayLabel(e.date); }
      (map[key] = map[key] || { key: key, label: label, entries: [] }).entries.push(e);
    });
    return Object.keys(map).sort().reverse().map(function (k) {
      const g = map[k]; g.entries.sort(byNewest); g.sum = summarize(g.entries); return g;
    });
  }

  function rangeSummaries(entries, now) {
    const t = now || today(), ws = weekStart(t), yr = t.slice(0, 4);
    return {
      today: summarize(entries.filter(function (e) { return e.date === t; })),
      week: summarize(entries.filter(function (e) { return weekStart(e.date) === ws; })),
      ytd: summarize(entries.filter(function (e) { return e.date.slice(0, 4) === yr; })),
    };
  }

  function makeEntry(o) {
    return {
      id: o.id || (Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3)),
      createdAt: o.createdAt || Date.now(),
      date: o.date || today(),
      status: ['placed', 'won', 'lost'].indexOf(o.status) >= 0 ? o.status : 'placed',
      name: o.name || '', sportsbook: o.sportsbook || '', betType: o.betType || '',
      wager: num(o.wager), payout: num(o.payout), odds: o.odds || '',
      legs: (o.legs || []).map(function (l) { return { title: String(l.title || ''), state: l.state || '', odds: l.odds || '' }; }),
      updatedAt: o.updatedAt || 0, _h: o._h || '',   // cloud-sync stamps (see lib/cloud.js)
    };
  }

  const logic = { ymd: ymd, today: today, weekStart: weekStart, addDays: addDays, profit: profit, summarize: summarize, filter: filter, group: group, rangeSummaries: rangeSummaries, makeEntry: makeEntry, num: num };

  /* ======================= UI (browser only) ======================= */
  if (typeof document === 'undefined') return Object.assign({ WEEK_START: WEEK_START }, logic);

  const $ = function (s, r) { return (r || document).querySelector(s); };
  const esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  const usd = function (n) { return n == null ? '—' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); };
  const signed = function (n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + usd(Math.abs(n)); };
  const pct = function (x) { return x == null ? '—' : Math.round(x * 100) + '%'; };
  const BET_LABEL = { parlay: 'Parlay', same_game_parlay: 'Same Game Parlay', single: 'Single', round_robin: 'Round Robin', teaser: 'Teaser', other: 'Bet' };

  const U = { entries: [], mode: 'day', status: 'placed', date: '', view: 'tracker', onSave: null };

  function load() {
    try { U.entries = (JSON.parse(localStorage.getItem(LS_KEY) || '[]') || []).map(makeEntry); } catch (e) { U.entries = []; }
  }
  function persist() { try { localStorage.setItem(LS_KEY, JSON.stringify(U.entries)); } catch (e) { /* storage blocked */ } }
  function save() { persist(); if (U.onSave) { try { U.onSave(U.entries); } catch (e) { /* ignore */ } } }
  /* Apply a cloud-sync result: { adopted: [entries to add/replace], dropped: [ids to remove] } */
  function applyRemote(r) {
    if (!r || (!r.adopted.length && !r.dropped.length)) { persist(); return; }
    r.dropped.forEach(function (id) { U.entries = U.entries.filter(function (x) { return x.id !== id; }); });
    r.adopted.forEach(function (raw) {
      const it = makeEntry(raw), i = U.entries.findIndex(function (x) { return x.id === it.id; });
      if (i >= 0) U.entries[i] = it; else U.entries.push(it);
    });
    persist(); if (U.view === 'portfolio') render();
  }
  function toast(msg) {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg; document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }

  /* ---------- dialogs ---------- */
  function buildDialogs() {
    const host = document.createElement('div');
    host.innerHTML =
      '<dialog id="dlgPfAdd"><div class="dlg">' +
        '<h2>Did it win or lose?</h2><p class="hint" id="pfaInfo"></p>' +
        '<div class="grid3"><label>Wager ($)<input id="pfaWager" inputmode="decimal"></label>' +
        '<label>Payout ($)<input id="pfaPayout" inputmode="decimal"></label>' +
        '<label>Date<input id="pfaDate" type="date"></label></div>' +
        '<p class="pf-err" id="pfaErr" hidden></p>' +
        '<div class="pf-choice"><button type="button" class="btn win" data-pick="won" aria-pressed="false">Won</button>' +
        '<button type="button" class="btn lose" data-pick="lost" aria-pressed="false">Lost</button></div>' +
        '<div class="row"><button type="button" class="btn danger" data-pick="discard">Clear without saving</button><span class="grow"></span>' +
        '<button type="button" class="btn ghost" data-pick="cancel">Cancel</button>' +
        '<button type="button" class="btn primary" id="pfaSave" data-pick="save" disabled>Save</button></div>' +
      '</div></dialog>' +
      '<dialog id="dlgPfEdit"><div class="dlg">' +
        '<h2 id="pfeTitle">Edit slip</h2>' +
        '<label>Name <input id="pfeName" placeholder="e.g. Sunday 5-leggers"></label>' +
        '<div class="grid2"><label>Status<select id="pfeStatus"><option value="placed">Placed</option><option value="won">Won</option><option value="lost">Lost</option></select></label>' +
        '<label>Date<input id="pfeDate" type="date"></label></div>' +
        '<div class="grid2"><label>Wager ($)<input id="pfeWager" inputmode="decimal"></label><label>Payout ($) <input id="pfePayout" inputmode="decimal"></label></div>' +
        '<p class="pf-err" id="pfeErr" hidden></p>' +
        '<div class="row"><button type="button" class="btn danger" id="pfeDelete">Delete</button><span class="grow"></span>' +
        '<button type="button" class="btn ghost" data-e="cancel">Cancel</button><button type="button" class="btn primary" data-e="save">Save</button></div>' +
      '</div></dialog>';
    document.body.appendChild(host);
  }

  let addCtx = null, editCtx = null;

  /* Called by the tracker's "Clear slip" button.
     info = { parlay, status: 'won'|'lost'|'live'|'pending'|'void', legs:[{title,state,odds}] }; done() runs the actual clear. */
  function promptSave(info, done) {
    const p = info.parlay, dlg = $('#dlgPfAdd');
    addCtx = { info: info, done: done };
    const label = (p.legs.length + '-Leg ' + (BET_LABEL[p.betType] || 'Parlay')) + (p.sportsbook ? ' · ' + p.sportsbook : '');
    const live = { won: 'Tracker says: WON ✓', lost: 'Tracker says: LOST ✕', live: 'Still in play', pending: 'Not started yet', void: 'Void' }[info.status] || '';
    $('#pfaInfo').textContent = label + ' — ' + live;
    $('#pfaWager').value = p.wager == null ? '' : p.wager;
    $('#pfaPayout').value = p.payout == null ? '' : p.payout;
    $('#pfaDate').value = today();
    $('#pfaErr').hidden = true;
    // Pre-select what the tracker says if the slip is already settled; otherwise you must pick Won or Lost.
    setPick(info.status === 'won' ? 'won' : info.status === 'lost' ? 'lost' : '');
    dlg.showModal();
  }

  function setPick(v) {
    if (addCtx) addCtx.pick = v;
    document.querySelectorAll('#dlgPfAdd .pf-choice [data-pick]').forEach(function (b) {
      const on = b.dataset.pick === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    const sv = $('#pfaSave'); if (sv) sv.disabled = !v;
    const err = $('#pfaErr'); if (err) err.hidden = true;
  }

  function wireAdd() {
    const dlg = $('#dlgPfAdd');
    dlg.addEventListener('click', function (e) {
      const b = e.target.closest('[data-pick]'); if (!b || !addCtx) return;
      const act = b.dataset.pick, ctx = addCtx, p = ctx.info.parlay;
      if (act === 'won' || act === 'lost') { setPick(act); return; }
      if (act === 'cancel') { dlg.close(); addCtx = null; return; }
      if (act === 'discard') { dlg.close(); addCtx = null; ctx.done(); return; }
      const pick = ctx.pick; if (act !== 'save' || (pick !== 'won' && pick !== 'lost')) return;
      const wager = num($('#pfaWager').value), payout = num($('#pfaPayout').value), date = $('#pfaDate').value || today();
      const err = $('#pfaErr');
      if (wager == null) { err.textContent = 'Enter the wager so the money totals are right.'; err.hidden = false; return; }
      if (pick === 'won' && payout == null) { err.textContent = 'Enter the payout (total returned, including your stake) so winnings count.'; err.hidden = false; return; }
      U.entries.unshift(makeEntry({
        date: date, status: pick, name: p.name, sportsbook: p.sportsbook, betType: p.betType, wager: wager, payout: payout, odds: p.odds, legs: ctx.info.legs,
      }));
      save(); dlg.close(); addCtx = null; render();
      toast('Saved to portfolio — ' + pick.toUpperCase() + '.');
      ctx.done();
    });
  }

  function openEdit(entry) {
    const isNew = !entry;
    editCtx = { id: entry ? entry.id : null };
    const e = entry || makeEntry({});
    $('#pfeTitle').textContent = isNew ? 'Log a bet' : 'Edit slip';
    $('#pfeName').value = e.name || ''; $('#pfeStatus').value = e.status; $('#pfeDate').value = e.date;
    $('#pfeWager').value = e.wager == null ? '' : e.wager; $('#pfePayout').value = e.payout == null ? '' : e.payout;
    $('#pfeDelete').hidden = isNew; $('#pfeErr').hidden = true;
    $('#dlgPfEdit').showModal();
  }

  function wireEdit() {
    const dlg = $('#dlgPfEdit');
    dlg.addEventListener('click', function (ev) {
      const b = ev.target.closest('[data-e]'); if (!b) return;
      if (b.dataset.e === 'cancel') { dlg.close(); return; }
      const wager = num($('#pfeWager').value), payout = num($('#pfePayout').value), status = $('#pfeStatus').value, err = $('#pfeErr');
      if (wager == null) { err.textContent = 'Wager is required.'; err.hidden = false; return; }
      if (status === 'won' && payout == null) { err.textContent = 'A won slip needs its payout (total returned).'; err.hidden = false; return; }
      const fields = { name: $('#pfeName').value.trim(), status: status, date: $('#pfeDate').value || today(), wager: wager, payout: payout };
      if (editCtx.id) { const e = U.entries.find(function (x) { return x.id === editCtx.id; }); if (e) Object.assign(e, fields); }
      else U.entries.unshift(makeEntry(fields));
      save(); dlg.close(); render();
    });
    $('#pfeDelete').addEventListener('click', function () {
      if (!editCtx.id || !confirm('Delete this slip from your portfolio?')) return;
      U.entries = U.entries.filter(function (x) { return x.id !== editCtx.id; });
      save(); dlg.close(); render();
    });
  }

  /* ---------- rendering ---------- */
  function moneyLine(s) {
    return '<span class="pos">Won ' + signed(s.moneyWon).replace('+', '+') + '</span><span class="neg">Lost −' + usd(s.moneyLost) + '</span>';
  }

  function statCard(title, s) {
    const cls = s.net > 0 ? 'pos' : s.net < 0 ? 'neg' : '';
    return '<div class="pf-card"><label>' + title + '</label><b class="' + cls + '">' + signed(s.net) + '</b>' +
      '<div class="sub">' + s.won + 'W · ' + s.lost + 'L' + (s.placed ? ' · ' + s.placed + ' pending (' + usd(s.atRisk) + ' at risk)' : '') + '</div>' +
      '<div class="sub2">' + moneyLine(s) + '</div></div>';
  }

  function entryHTML(e) {
    const pr = profit(e);
    let res;
    if (e.status === 'won') res = '<span class="res pos">' + signed(pr) + '</span>';
    else if (e.status === 'lost') res = '<span class="res neg">' + signed(pr) + '</span>';
    else res = '<span class="res risk">At risk ' + usd(e.wager) + (e.payout != null && e.wager != null ? ' · to win ' + usd(round2(e.payout - e.wager)) : '') + '</span>';
    const glyph = { hit: '✓', miss: '✕', push: '–', void: '–' };
    const legs = e.legs.length ? '<details class="pfe-legs"><summary>' + e.legs.length + ' leg' + (e.legs.length === 1 ? '' : 's') + '</summary><ul>' +
      e.legs.map(function (l) { return '<li class="lg-' + esc(l.state) + '"><i>' + (glyph[l.state] || '·') + '</i>' + esc(l.title) + (l.odds ? '<em>' + esc(l.odds) + '</em>' : '') + '</li>'; }).join('') + '</ul></details>' : '';
    const title = e.name ? esc(e.name) : (e.legs.length ? e.legs.length + '-Leg ' + esc(BET_LABEL[e.betType] || 'Parlay') : 'Bet');
    const sb = ['placed', 'won', 'lost'].map(function (st) {
      return '<button class="btn small st-' + st + (e.status === st ? ' on' : '') + '" data-st="' + st + '">' + st.charAt(0).toUpperCase() + st.slice(1) + '</button>';
    }).join('');
    return '<article class="pfe e-' + e.status + '" data-id="' + e.id + '">' +
      '<div class="pfe-top"><div class="pfe-title">' + title + '<small>' + esc([e.sportsbook, dayLabel(e.date)].filter(Boolean).join(' · ')) + '</small></div>' +
      '<span class="pill ' + (e.status === 'placed' ? 'live' : e.status) + '">' + e.status + '</span></div>' +
      '<div class="pfe-money"><span>Wager <b>' + usd(e.wager) + '</b></span><span>Payout <b>' + usd(e.payout) + '</b></span>' + res + '</div>' +
      legs + '<div class="pfe-btns">' + sb + '<span class="grow"></span><button class="btn small" data-edit>Edit</button></div></article>';
  }

  function render() {
    const root = $('#viewPortfolio'); if (!root) return;
    const R = rangeSummaries(U.entries);
    const list = filter(U.entries, { status: U.status, date: U.date });
    const groups = group(list, U.mode);
    const modes = [['day', 'Daily'], ['week', 'Weekly'], ['ytd', 'YTD']];
    const stats = [['placed', 'Placed'], ['won', 'Won'], ['lost', 'Lost']];
    let html =
      '<div class="pf-cards">' + statCard('Today', R.today) + statCard('This week', R.week) + statCard('YTD ' + new Date().getFullYear(), R.ytd) + '</div>' +
      '<div class="pf-ytd">YTD record <b>' + R.ytd.won + '–' + R.ytd.lost + '</b> · win rate <b>' + pct(R.ytd.winRate) + '</b> · ROI <b>' + pct(R.ytd.roi) + '</b> · wagered <b>' + usd(R.ytd.wagered) + '</b></div>' +
      '<div class="pf-ctrl"><div class="segctl">' + modes.map(function (m) { return '<button data-mode="' + m[0] + '" class="' + (U.mode === m[0] ? 'on' : '') + '">' + m[1] + '</button>'; }).join('') + '</div>' +
      '<div class="chips">' + stats.map(function (m) { return '<button data-status="' + m[0] + '" class="chip st-' + m[0] + (U.status === m[0] ? ' on' : '') + '">' + m[1] + '</button>'; }).join('') + '</div>' +
      '<div class="pf-date"><label>Jump to date <input type="date" id="pfDate" value="' + esc(U.date) + '"></label>' + (U.date ? '<button class="btn small" id="pfDateClear">Clear</button>' : '') + '</div>' +
      '<div class="pf-tools"><button class="btn small primary" id="pfLog">+ Log bet</button><button class="btn small" id="pfCsv">Export CSV</button></div></div>';

    if (!groups.length) html += '<p class="empty">' + (U.entries.length ? 'No slips match these filters.' : 'No slips saved yet. Press <b>Clear slip</b> on a tracked slip and choose Won or Lost — or tap <b>+ Log bet</b>.') + '</p>';
    groups.forEach(function (g) {
      const s = g.sum, cls = s.net > 0 ? 'pos' : s.net < 0 ? 'neg' : '';
      html += '<section class="pf-group"><header><div><h3>' + esc(g.label) + '</h3><span class="sub">' + s.count + ' slip' + (s.count === 1 ? '' : 's') + ' · ' + s.won + 'W ' + s.lost + 'L' + (s.placed ? ' ' + s.placed + ' pending' : '') + '</span></div>' +
        '<div class="gt"><b class="' + cls + '">' + signed(s.net) + '</b><span class="sub2">' + moneyLine(s) + '</span></div></header>' +
        g.entries.map(entryHTML).join('') + '</section>';
    });
    root.innerHTML = html;
  }

  function csv() {
    const rows = [['date', 'status', 'name', 'sportsbook', 'wager', 'payout', 'profit', 'legs']];
    U.entries.slice().sort(byNewest).forEach(function (e) {
      rows.push([e.date, e.status, e.name, e.sportsbook, e.wager == null ? '' : e.wager, e.payout == null ? '' : e.payout, profit(e), e.legs.map(function (l) { return l.title; }).join(' | ')]);
    });
    const text = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = 'portfolio-' + today() + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function showView(v) {
    U.view = v;
    const t = $('#viewTracker'), p = $('#viewPortfolio');
    if (t) t.hidden = v !== 'tracker';
    if (p) p.hidden = v !== 'portfolio';
    document.querySelectorAll('#tabs [data-view]').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
    if (v === 'portfolio') render();
    window.scrollTo(0, 0);
  }

  function init() {
    load(); buildDialogs(); wireAdd(); wireEdit();
    document.querySelectorAll('#tabs [data-view]').forEach(function (b) { b.addEventListener('click', function () { showView(b.dataset.view); }); });
    const root = $('#viewPortfolio'); if (!root) return;
    root.addEventListener('click', function (e) {
      const t = e.target;
      if (t.closest('[data-mode]')) { U.mode = t.closest('[data-mode]').dataset.mode; return render(); }
      if (t.closest('[data-status]')) { U.status = t.closest('[data-status]').dataset.status; return render(); }
      if (t.id === 'pfDateClear') { U.date = ''; return render(); }
      if (t.id === 'pfLog') return openEdit(null);
      if (t.id === 'pfCsv') return csv();
      const card = t.closest('.pfe'); if (!card) return;
      const entry = U.entries.find(function (x) { return x.id === card.dataset.id; }); if (!entry) return;
      const st = t.closest('[data-st]');
      if (st) {
        if (st.dataset.st === 'won' && entry.payout == null) { openEdit(entry); $('#pfeStatus').value = 'won'; $('#pfeErr').textContent = 'Add the payout (total returned) to count this win.'; $('#pfeErr').hidden = false; return; }
        entry.status = st.dataset.st; save(); return render();
      }
      if (t.closest('[data-edit]')) openEdit(entry);
    });
    root.addEventListener('change', function (e) { if (e.target.id === 'pfDate') { U.date = e.target.value; render(); } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return Object.assign({ WEEK_START: WEEK_START, promptSave: promptSave, render: render, showView: showView, entries: function () { return U.entries; }, applyRemote: applyRemote, onSave: function (fn) { U.onSave = fn; } }, logic);
});
