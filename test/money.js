'use strict';
// Odds from money, offshore/credit slips, portfolio totals, and the games panel markup.
const assert = require('assert');
const fs = require('fs'), path = require('path');
const E = require('../public/lib/evaluate.js');
const Portfolio = require('../public/portfolio.js');

const tests = [];
const test = function (n, f) { tests.push([n, f]); };

test('odds come from the money, for any account', function () {
  assert.strictEqual(E.oddsFromMoney(9.81, 51), '+420', 'the +500 the model guessed was wrong');
  assert.strictEqual(E.oddsFromMoney(24.75, 61.05), '+147', 'boosted payout is what counts');
  assert.strictEqual(E.oddsFromMoney(25.35, 65), '+156');
  assert.strictEqual(E.oddsFromMoney(26, 50), '-108');
  assert.strictEqual(E.oddsFromMoney(25, 50), '+100', 'risk 25 to win 25');
  assert.strictEqual(E.oddsFromMoney(110, 210), '-110', 'risk 110 to win 100');
  assert.strictEqual(E.oddsFromMoney(100, 600), '+500');
  assert.strictEqual(E.oddsFromMoney(0, 50), null);
  assert.strictEqual(E.oddsFromMoney(25, null), null);
  assert.strictEqual(E.oddsFromMoney(25, 25), null, 'nothing won, nothing to price');
  assert.strictEqual(E.oddsFromMoney('x', 'y'), null);
});

test('credit slips: a win books the amount to win, a loss costs the stake, and credit counts as wagered', function () {
  assert.strictEqual(Portfolio.toWinOf(25, 50), 25);
  assert.strictEqual(Portfolio.payoutFromToWin(25, 25), 50);
  const win = Portfolio.makeEntry({ status: 'won', wager: 25, payout: Portfolio.payoutFromToWin(25, 25), credit: true });
  const loss = Portfolio.makeEntry({ status: 'lost', wager: 25, payout: 50, credit: true });
  const cash = Portfolio.makeEntry({ status: 'won', wager: 10, payout: 30 });
  assert.strictEqual(Portfolio.profit(win), 25, 'not $0');
  assert.strictEqual(Portfolio.profit(loss), -25);
  const s = Portfolio.summarize([win, loss, cash]);
  assert.strictEqual(s.wagered, 60, 'credit is part of wagered');
  assert.strictEqual(s.creditWagered, 50); assert.strictEqual(s.cashWagered, 10);
  assert.strictEqual(s.net, 20 + 25 - 25);
  assert.strictEqual(s.moneyWon, 45); assert.strictEqual(s.moneyLost, 25);
  assert.ok(Math.abs(s.roi - 20 / 60) < 1e-9);
  assert.strictEqual(Portfolio.makeEntry({ wager: 5 }).credit, false);
});

test('the app wires credit slips, auto odds, and the games panel with totals', function () {
  const src = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(/id="bCredit"/.test(html) && /id="bPayLbl"/.test(html));
  assert.ok(/data-act="offshore"/.test(src) && /name === 'offshore'/.test(src), 'one-tap Offshore button on every slip');
  assert.ok(/applyOdds\(p\)/.test(src) && /oddsUser/.test(src), 'odds are derived unless you typed your own');
  assert.ok(/<label>RISK<\/label>/.test(src) && /<label>TO WIN<\/label>/.test(src), 'credit slips show risk / to win');
  assert.ok(/data-gp-game/.test(src) && /gamesExpanded/.test(src) && /gameLegs\(/.test(src), 'each game expands to its markets');
  assert.ok(/gamesTotals\(slips\)/.test(src) && /TOTAL RISK/.test(src), 'totals sit at the bottom of the games tab');
  assert.ok(!/gp-chips">' \+ r\.slips/.test(src), 'bet chips no longer sit under every game');
});

(async function () {
  let pass = 0, fail = 0;
  for (const [n, f] of tests) { try { await f(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + '\n      ' + (e && e.stack || e)); } }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
