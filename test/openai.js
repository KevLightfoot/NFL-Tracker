'use strict';
const assert = require('assert');
const { parseSlip, TOOL } = require('../server.js');

(async function () {
  const oldFetch = global.fetch;
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  let captured;
  const expected = {
    bet_type: 'parlay',
    wager: 10,
    payout: 65,
    legs: [{ raw_text: 'Player over 49.5 receiving yards', market: 'player_prop', player: 'Test Player', stat: 'receiving_yards', side: 'over', line: 49.5 }],
  };
  global.fetch = async function (url, options) {
    captured = { url, options, body: JSON.parse(options.body) };
    return { ok: true, status: 200, text: async function () { return JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_bet', arguments: JSON.stringify(expected) } }] } }] }); } };
  };
  try {
    const actual = await parseSlip([{ mediaType: 'image/png', data: 'aGVsbG8=' }]);
    assert.deepStrictEqual(actual, expected);
    assert.strictEqual(captured.url, 'https://api.openai.com/v1/chat/completions');
    assert.strictEqual(captured.options.headers.authorization, 'Bearer test-key-not-real');
    assert.strictEqual(captured.body.model, 'gpt-4.1-mini');
    assert.strictEqual(captured.body.tools[0].function.name, TOOL.name);
    assert.deepStrictEqual(captured.body.tools[0].function.parameters, TOOL.input_schema);
    const image = captured.body.messages[1].content.find(function (x) { return x.type === 'image_url'; });
    assert.strictEqual(image.image_url.url, 'data:image/png;base64,aGVsbG8=');
    console.log('  ✓ OpenAI vision request uses image input + structured function output');
  } catch (e) {
    console.error('  ✗ OpenAI integration test\n      ' + (e && e.stack || e));
    process.exitCode = 1;
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
  }
})();
