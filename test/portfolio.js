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
t('NFL weeks run Tuesday → Monday', () => {
  assert.strictEqual(P.weekStart('2026-10-18'), '2026-10-13'); // Sunday
  assert.strictEqual(P.weekStart('2026-10-19'), '2026-10-13'); // Monday night
  assert.strictEqual(P.weekStart('2026-10-20'), '2026-10-20'); // next Tuesday
});
t('daily / weekly / YTD grouping and filters', () => {
  const all = [E('2026-10-18', 'won', 20, 120), E('2026-10-19', 'lost', 10, 50), E('2026-10-25', 'placed', 5, 20), E('2026-03-02', 'won', 10, 30), E('2025-12-31', 'lost', 99, 1)];
  assert.strictEqual(P.group(all, 'day').length, 5);
  assert.strictEqual(P.group(all, 'week').find(g => g.key === '2026-10-13').entries.length, 2);
  const y = P.group(all, 'ytd', '2026'); assert.deepStrictEqual(y.map(g => g.key), ['2026-10', '2026-03']); // 2025 excluded
  assert.strictEqual(P.filter(all, { status: 'won' }).length, 2);
  assert.strictEqual(P.filter(all, { date: '2026-10-19' })[0].status, 'lost');
  const r = P.rangeSummaries(all, '2026-10-18'); assert.strictEqual(r.today.count, 1); assert.strictEqual(r.week.count, 2); assert.strictEqual(r.ytd.count, 4);
});
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
