/* Parlay Tracker front-end */
(function () {
  'use strict';
  const E = window.NFLEval, T = window.NFLTeams, Demo = window.NFLDemo;
  const $ = function (s) { return document.querySelector(s); };
  const esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  const LS_BETS = 'parlay-tracker.v1', LS_KEY = 'parlay-tracker.apiKey';
  // GitHub Pages frontend talks to the Render API. Keep this URL public; never put API keys here.
  const API_BASE = 'https://nfl-parlay-tracker.onrender.com';
  const S = { parlays: [], games: {}, gamesList: [], expanded: new Set(), pending: [], config: {}, timer: null, demoTimer: null, lastUpdate: null, busy: false, again: false, fetchError: null, serverDown: false };

  /* ---------------- storage ---------------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function load() {
    try { S.parlays = JSON.parse(lsGet(LS_BETS) || '[]'); } catch (e) { S.parlays = []; }
    // Remove any old simulated demo parlay from this browser's saved state.
    S.parlays = S.parlays.filter(function (p) { return !p.demo; });
    S.parlays.forEach(function (p) { (p.legs || []).forEach(fixTdLeg); }); // repair slips saved before this fix
    save();
  }
  function save() { lsSet(LS_BETS, JSON.stringify(S.parlays)); }
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

  /* ---------------- build parlays from parse output ---------------- */
  function normLeg(l) {
    const leg = {
      id: uid(), raw_text: l.raw_text || '', market: l.market || 'other', team: l.team || '', player: l.player || '', stat: l.stat || null,
      side: l.side || null, line: l.line == null ? null : Number(l.line), odds: l.odds || '', away_team: l.away_team || '', home_team: l.home_team || '',
      league: l.league === 'nfl' || l.league === 'cfb' ? l.league : '',
      game_date: l.game_date || '', period: l.period || 'full', fantasy_system: l.fantasy_system || null, notes: l.notes || '',
      gameId: null, teamResolved: null, manual: null, manualValue: null,
    };
    if ((leg.market === 'player_prop' || leg.market === 'total' || leg.market === 'team_total') && !leg.side) leg.side = 'over';
    fixTdLeg(leg);
    if (leg.market === 'anytime_td') leg.side = 'yes';
    return leg;
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
      ((['player_prop', 'anytime_td', 'first_td', 'last_td'].indexOf(leg.market) >= 0 && S.games[leg.gameId] && S.games[leg.gameId].away && S.games[leg.gameId].home) ?
        ' <small class="prop-score">' + esc(S.games[leg.gameId].away.abbr + ' ' + S.games[leg.gameId].away.score + '–' + S.games[leg.gameId].home.abbr + ' ' + S.games[leg.gameId].home.score) + '</small>' : '') +
      '</span></div>' +
      more + '</div></li>';
  }

  function parlayHTML(p) {
    const results = resultsFor(p);
    const sum = E.summarize(results);
    const pill = { pending: ['pending', 'Not started'], live: ['live', 'Live · ' + sum.hits + '/' + sum.total + ' ✓'], won: ['won', 'Won ✓'], lost: ['lost', 'Lost ✕'], void: ['void', 'Void'] }[sum.status];
    const title = (p.name ? esc(p.name) : (p.legs.length + '-Leg ' + (BET_LABEL[p.betType] || 'Parlay'))) +
      '<small>' + (p.name ? p.legs.length + '-Leg ' + esc(BET_LABEL[p.betType] || 'Parlay') + ' · ' : '') + esc(p.sportsbook || (p.demo ? 'Demo' : 'Bet slip')) + '</small>';
    const segs = results.map(function (r) { return '<i class="seg ' + (['hit', 'miss', 'live', 'push', 'void'].indexOf(r.state) >= 0 ? r.state : '') + '"></i>'; }).join('');
    const warns = (p.warnings || []).length ? '<div class="hint" style="color:#fbbf24;margin-top:8px">⚠ ' + p.warnings.map(esc).join(' · ') + '</div>' : '';
    const upd = p.demo ? 'Demo · simulated games' : (S.lastUpdate ? 'Updated ' + new Date(S.lastUpdate).toLocaleTimeString() : 'Waiting for data…');
    return '<article class="parlay p-' + sum.status + '" data-p="' + p.id + '">' +
      '<div class="ph"><div class="ph-top"><div class="ph-title">' + title + '</div><span class="pill ' + pill[0] + '">' + esc(pill[1]) + '</span></div>' +
      '<div class="money"><div><label>WAGER</label><b>' + money(p.wager) + '</b></div><div class="payout"><label>PAYOUT</label><b>' + money(p.payout) + '</b></div><div><label>ODDS</label><b>' + esc(p.odds || '—') + '</b></div></div>' +
      '<div class="segs">' + segs + '</div>' + warns + '</div>' +
      '<ul class="legs">' + p.legs.map(function (l, i) { return legHTML(p, l, results[i]); }).join('') + '</ul>' +
      '<div class="pf"><span>' + esc(upd) + '</span><span class="btns"><button class="btn small" data-act="edit-bet" data-p="' + p.id + '">Edit bet</button><button class="btn small danger" data-act="clear-slip" data-p="' + p.id + '">Clear slip</button></span></div></article>';
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
    else if (!S.config.hasServerKey && !lsGet(LS_KEY)) { html = 'Add your OpenAI API key to read screenshots. <button class="btn small" id="bannerKey">Open Settings</button>'; }
    b.className = cls; b.hidden = !html; b.innerHTML = html;
  }

  /* ---------------- refresh loop ---------------- */
  async function refreshAll() {
    if (S.busy) { S.again = true; return; }
    S.busy = true; document.body.classList.add('spinning');
    let err = null;
    try {
      const need = [];
      S.parlays.forEach(function (p) { p.legs.forEach(function (l) { if (!l.gameId && !l.noResolve && l.market !== 'other') need.push(l); }); });
      if (need.length) {
        try {
          const j = await api('/api/resolve', { method: 'POST', body: JSON.stringify({ legs: need.map(function (l) { return { id: l.id, market: l.market, team: l.team, player: l.player, away_team: l.away_team, home_team: l.home_team, game_date: l.game_date, league: l.league || null }; }) }) });
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
      const warn = [].concat.apply([], bets.map(function (p) { return p.warnings || []; }));
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
    sel.innerHTML = '<option value="">—</option>' + Object.keys(E.STAT_LABEL).map(function (k) { return '<option value="' + k + '">' + esc(E.STAT_LABEL[k]) + '</option>'; }).join('');
    $('#legRaw').textContent = l.raw_text ? 'From slip: “' + l.raw_text + '”' : '';
    $('#lMarket').value = l.market; $('#lPeriod').value = l.period || 'full'; $('#lTeam').value = l.team || ''; $('#lPlayer').value = l.player || '';
    $('#lStat').value = l.stat || ''; $('#lSide').value = l.side || ''; $('#lLine').value = l.line == null ? '' : l.line;
    const gs = $('#lGame'), lgSel = $('#lLeague');
    lgSel.value = l.league || '';
    function fillGames() {
      const want = lgSel.value, keep = gs.value;
      const opts = function (list) { return list.map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(g.away.abbr + ' @ ' + g.home.abbr + ' · ' + dateLabel(g.date)) + '</option>'; }).join(''); };
      const nfl = S.gamesList.filter(function (g) { return g.league !== 'cfb'; }), cfb = S.gamesList.filter(function (g) { return g.league === 'cfb'; });
      gs.innerHTML = '<option value="auto">Auto-detect</option>' +
        (want !== 'cfb' && nfl.length ? '<optgroup label="NFL">' + opts(nfl) + '</optgroup>' : '') +
        (want !== 'nfl' && cfb.length ? '<optgroup label="College football">' + opts(cfb) + '</optgroup>' : '');
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
      p.name = $('#bName').value.trim(); p.wager = num($('#bWager').value); p.payout = num($('#bPayout').value);
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
    $('#dlgSettings').addEventListener('close', function () {
      if ($('#dlgSettings').returnValue === 'save') {
        const k = $('#setKey').value.trim();
        lsSet(LS_KEY, k); renderBanner(); toast(k ? 'API key saved in this browser.' : 'API key cleared.');
      }
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
      const li = e.target.closest('.leg');
      if (li && !e.target.closest('.more')) toggleLeg(li.dataset.leg);
    });
    $('#parlays').addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('leg')) { e.preventDefault(); toggleLeg(e.target.dataset.leg); }
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
    $('#btnSettings').addEventListener('click', function () { $('#setKey').value = lsGet(LS_KEY) || ''; $('#dlgSettings').returnValue = ''; $('#dlgSettings').showModal(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && S.parlays.length) refreshAll(); });

    wireDialogs();
    render(); renderPending();
    api('/api/config').then(function (c) { S.config = c; renderBanner(); }).catch(function () { S.serverDown = true; renderBanner(); });
    if (S.parlays.length) { refreshAll(); startDemoClock(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();