'use strict';
const assert = require('assert');
const E = require('../public/lib/evaluate.js');
const Stats = require('../public/lib/stats.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } }
const game = (o) => Object.assign({ id: 'x', state: 'in', detail: '', period: 2, clock: '5:00',
  away: { abbr: 'LV', score: 10, linescores: [7, 3] }, home: { abbr: 'CLE', score: 14, linescores: [7, 7] }, players: [], scoringPlays: [] }, o);

t('1H spread settles at halftime, not before', () => {
  const leg = { id: 'a', market: 'spread', team: 'Raiders', line: 4.5, period: '1h' };
  assert.strictEqual(E.evaluateLeg(leg, game({})).state, 'live');
  const r = E.evaluateLeg(leg, game({ detail: 'Halftime', clock: '0:00' }));
  assert.strictEqual(r.state, 'hit'); // LV 10 +4.5 vs 14
});
t('quarter market settles at end of quarter', () => {
  const leg = { id: 'b', market: 'moneyline', team: 'Browns', period: 'q1' };
  const g = game({ period: 2, clock: '10:00' });
  assert.strictEqual(E.evaluateLeg(leg, g).state, 'push'); // 7-7 after Q1, Q1 complete
});
t('pace shows on live totals and props, never on finals', () => {
  const live = E.evaluateLeg({ id: 'c', market: 'total', side: 'over', line: 54.5 }, game({ period: 3, clock: '15:00' }));
  assert.ok(/pace/.test(live.detail), live.detail);
  const fin = E.evaluateLeg({ id: 'd', market: 'total', side: 'over', line: 54.5 }, game({ state: 'post', period: 4, clock: '0:00' }));
  assert.ok(!/pace/.test(fin.detail));
});
t('summary header without status is flagged for scoreboard backfill', () => {
  const g = Stats.normalizeSummary({ header: { id: '9', competitions: [{ competitors: [] }] } }, '9');
  assert.strictEqual(g.hasStatus, false);
});
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
