'use strict';
// Upload limit: generous per network, per-network not global, clear message, and the reader prompt knows the offshore ticket-list rows.
const assert = require('assert'), http = require('http');
const { server } = require('../server.js');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '../server.js'), 'utf8');

(async function () {
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const post = function (path, ip) {
    return new Promise(function (resolve, reject) {
      const rq = http.request({ host: '127.0.0.1', port: port, path: path, method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip } }, function (res) {
        let s = ''; res.on('data', function (c) { s += c; }); res.on('end', function () { let j = {}; try { j = JSON.parse(s); } catch (e) { /* */ } resolve({ status: res.statusCode, json: j, retry: res.headers['retry-after'] }); });
      });
      rq.on('error', reject); rq.end('{}');
    });
  };
  let fail = 0;
  const t = async function (name, f) { try { await f(); console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } };
  try {
    await t('80 uploads an hour from one network are allowed; the 81st is told how long to wait', async function () {
      let last;
      for (let i = 1; i <= 80; i++) { last = await post('/api/parse', '9.9.9.9'); assert.notStrictEqual(last.status, 429, 'upload ' + i + ' was blocked'); }
      const r = await post('/api/parse', '9.9.9.9');
      assert.strictEqual(r.status, 429); assert.ok(/uploaded a lot of slips/.test(r.json.error) && /\d+ min/.test(r.json.error), r.json.error); assert.ok(+r.retry > 0 && +r.retry <= 3600);
    });
    await t('the limit is per network: someone else is unaffected, and other endpoints too', async function () {
      assert.notStrictEqual((await post('/api/parse', '8.8.8.8')).status, 429);
      assert.notStrictEqual((await post('/api/resolve', '9.9.9.9')).status, 429);
    });
    await t('the limit can be raised with PARSE_PER_HOUR (and cannot be set absurdly low)', function () {
      assert.ok(/PARSE_PER_HOUR = Math\.max\(5, parseInt\(process\.env\.PARSE_PER_HOUR, 10\) \|\| 80\)/.test(src));
    });
    await t('odds printed on the ticket are kept when the money agrees; a misread slip still gets the money\'s odds', function () {
      const E = require('../public/lib/evaluate.js');
      assert.ok(E.printedOddsAgree('+114', 25, 53), '$25 to win $28 is +112 from the money, +114 printed');
      assert.ok(E.printedOddsAgree('-126', 32, 57));
      assert.ok(E.printedOddsAgree('\u2212126', 32, 57), 'real minus sign');
      assert.ok(!E.printedOddsAgree('+114', 25, 125), 'printed +114 but the money says +400: the money wins');
      assert.ok(!E.printedOddsAgree('', 25, 53) && !E.printedOddsAgree(null, 25, 53) && !E.printedOddsAgree('+114', 25, null) && !E.printedOddsAgree('abc', 25, 53));
    });
    await t('the reader prompt explains ticket-list rows: red = risk, next = to win, matchup before "/ Game", total player touchdowns', function () {
      ['RISK (wager)', 'TO WIN', 'away team first', 'total player touchdowns', 'anytime_td'].forEach(function (k) { assert.ok(src.indexOf(k) >= 0, 'missing: ' + k); });
    });
  } finally { server.close(); }
  console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
  process.exit(fail ? 1 : 0);
})();
