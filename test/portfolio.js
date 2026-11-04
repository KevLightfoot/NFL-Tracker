'use strict';
const assert = require('assert');
const P = require('../public/portfolio.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } }
const E = (date, status, wager, payout) => P.makeEntry({ date, status, wager, payout });

t('profit: won = payout - wager, lost = -wager, placed = 0', () => {
  assert.strictEqual(P.profit(E('2026-10-18', 'won', 20, 2415)), 2395);
  assert.strictEqual(P.profit(E('2026-10-18', 'lost', 25, 230)), -25);
  assert.strictEqual(P.profit(E('2026-10-18', 'placed', 25, 230)), 0);
});
t('summary: money won / lost / net / at risk / win rate / ROI', () => {
  const s = P.summarize([E('2026-10-18', 'won', 20, 120), E('2026-10-18', 'lost', 30, 90), E('2026-10-18', 'placed', 10, 50)]);
  assert.deepStrictEqual([s.won, s.lost, s.placed, s.moneyWon, s.moneyLost, s.net, s.atRisk, s.wagered], [1, 1, 1, 100, 30, 70, 10, 60]);
  assert.strictEqual(s.winRate, 0.5); assert.strictEqual(Math.round(s.roi * 1000) / 1000, 1.4);
});
t('weeks run Monday → Sunday', () => {
  assert.strictEqual(P.WEEK_START, 1);
  assert.strictEqual(P.weekStart('2026-11-02'), '2026-11-02'); // Monday
  assert.strictEqual(P.weekStart('2026-11-08'), '2026-11-02'); // Sunday is the last day
  assert.strictEqual(P.weekStart('2026-11-03'), '2026-11-02'); // Tuesday is no longer a new week
  assert.strictEqual(P.weekStart('2026-11-09'), '2026-11-09');
  assert.strictEqual(P.weekStart('2027-01-01'), '2026-12-28');   // across the new year
});

t('stepping through days, weeks and months', () => {
  assert.deepStrictEqual(P.period('week', '2026-11-05'), { start: '2026-11-02', end: '2026-11-08', label: 'Nov 2 – Nov 8' });
  assert.strictEqual(P.stepPeriod('week', '2026-11-05', -1), '2026-10-26');
  assert.strictEqual(P.stepPeriod('week', '2026-11-05', 1), '2026-11-09');
  assert.strictEqual(P.stepPeriod('day', '2026-11-01', -1), '2026-10-31');
  assert.strictEqual(P.stepPeriod('day', '2026-03-01', -1), '2026-02-28');
  assert.strictEqual(P.stepPeriod('month', '2026-03-31', -1), '2026-02-01', 'Mar 31 back one month is February, not March 3');
  assert.strictEqual(P.stepPeriod('month', '2026-12-15', 1), '2027-01-01');
  const m = P.period('month', '2026-02-10'); assert.strictEqual(m.start, '2026-02-01'); assert.strictEqual(m.end, '2026-02-28'); assert.strictEqual(m.label, 'February 2026');
  const es = ['2026-11-01', '2026-11-02', '2026-11-08', '2026-11-09'].map(function (d) { return P.makeEntry({ date: d }); });
  assert.deepStrictEqual(P.inPeriod(es, 'week', '2026-11-04').map(function (e) { return e.date; }), ['2026-11-02', '2026-11-08']);
  assert.strictEqual(P.inPeriod(es, 'month', '2026-11-30').length, 4);
  assert.strictEqual(P.inPeriod(es, 'day', '2026-11-01').length, 1);
});
t('daily / weekly / YTD grouping and filters', () => {
  const all = [E('2026-10-18', 'won', 20, 120), E('2026-10-19', 'lost', 10, 50), E('2026-10-25', 'placed', 5, 20), E('2026-03-02', 'won', 10, 30), E('2025-12-31', 'lost', 99, 1)];
  assert.strictEqual(P.group(all, 'day').length, 5);
  assert.strictEqual(P.group(all, 'week').find(g => g.key === '2026-10-12').entries.length, 1);   // Sun 10/18 closes the week of Mon 10/12
  assert.strictEqual(P.group(all, 'week').find(g => g.key === '2026-10-19').entries.length, 2);   // Mon 10/19 – Sun 10/25
  const y = P.group(all, 'ytd', '2026'); assert.deepStrictEqual(y.map(g => g.key), ['2026-10', '2026-03']); // 2025 excluded
  assert.strictEqual(P.filter(all, { status: 'won' }).length, 2);
  assert.strictEqual(P.filter(all, { status: 'placed' }).length, 5, 'Placed = every bet you placed, won or lost included');
  assert.strictEqual(P.filter(all, { date: '2026-10-19' })[0].status, 'lost');
  const r = P.rangeSummaries(all, '2026-10-18'); assert.strictEqual(r.today.count, 1); assert.strictEqual(r.week.count, 1); assert.strictEqual(r.ytd.count, 4);
});
t('entries keep their cloud-sync stamps', () => {
  const e = P.makeEntry({ date: '2026-10-18', status: 'won', wager: 1, payout: 3, updatedAt: 123, _h: 'abc' });
  assert.strictEqual(e.updatedAt, 123); assert.strictEqual(e._h, 'abc');
});
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
