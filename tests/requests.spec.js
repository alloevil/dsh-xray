// Request ledger: classify GenerateOptions into a per-request bill; observe
// llm/stream without touching the payload.
const { test } = require('node:test');
const assert = require('node:assert');
const { installRequestLedger, classify } = require('../lib/collect/requests.js');
const { requestLedger } = require('../lib/model.js');

const msg = (role, content, source) => ({
  id: 'm',
  role,
  content,
  source: source ?? { kind: 'user' },
});
const text = (s) => ({ type: 'text', text: s });

test('classify buckets system, tools, history, and tool results by name', () => {
  const options = {
    provider: 'p',
    model: 'm',
    system: 'S'.repeat(400), // ~100 tokens
    tools: [{ name: 'bash', description: 'd', parameters: {} }],
    messages: [
      msg('user', [text('hello there, this is the user asking')]),
      msg('assistant', [
        text('let me check'),
        { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{"command":"ls"}' },
      ]),
      msg('user', [{ type: 'tool-result', toolCallId: 'c1', content: [text('R'.repeat(800))] }], {
        kind: 'tool',
        callId: 'c1',
      }),
    ],
  };
  const entry = classify(options);
  assert.equal(entry.system, 100);
  assert.ok(entry.toolSchemas > 0);
  assert.equal(entry.historyMessages, 2); // user + assistant, tool result excluded
  assert.equal(entry.toolResultRows.length, 1);
  assert.equal(entry.toolResultRows[0].name, 'bash'); // resolved via callId
  assert.equal(entry.toolResultRows[0].tokens, 200); // 800 chars / 4
  assert.equal(entry.total, entry.system + entry.toolSchemas + entry.history + entry.toolResults);
});

test('ledger observes llm/stream, marks prefix stability and delta', async () => {
  let listener = null;
  const ctx = {
    on: (event, fn) => {
      if (event === 'llm/stream') listener = fn;
      return () => {};
    },
  };
  const { sessions, dispose } = installRequestLedger(ctx, { maxPerSession: 3 });
  const base = {
    provider: 'p',
    model: 'm',
    sessionId: 's1',
    system: 'stable system',
    tools: [{ name: 't', description: '', parameters: {} }],
    messages: [msg('user', [text('one')])],
  };
  let passedThrough = 0;
  const next = () => {
    passedThrough += 1;
    return 'stream';
  };
  // request 1
  assert.equal(listener(base, next), 'stream'); // payload passes through untouched
  // request 2: same prefix, more history
  listener(
    { ...base, messages: [...base.messages, msg('assistant', [text('two two two two')])] },
    next,
  );
  // request 3: prefix broken (system changed)
  listener({ ...base, system: 'DIFFERENT system prompt' }, next);
  assert.equal(passedThrough, 3);
  const ring = sessions.get('s1');
  assert.equal(ring.length, 3);
  assert.equal(ring[0].prefixStable, null); // first has no previous
  assert.equal(ring[1].prefixStable, true);
  assert.equal(ring[2].prefixStable, false);
  assert.ok(ring[1].deltaTotal > 0); // history grew
  // ring bound
  listener(base, next);
  assert.equal(sessions.get('s1').length, 3); // oldest evicted
  dispose();
});

test('requestLedger view model reverses to newest-first per session', () => {
  const snap = {
    capturedAt: 'now',
    requestLedger: {
      s1: [
        {
          at: 1,
          purpose: null,
          provider: 'p',
          model: 'm',
          total: 10,
          system: 1,
          toolSchemas: 2,
          history: 3,
          toolResults: 4,
          toolResultRows: [],
          historyMessages: 1,
          prefixStable: null,
          deltaTotal: null,
        },
        {
          at: 2,
          purpose: 'compaction',
          provider: 'p',
          model: 'm',
          total: 20,
          system: 1,
          toolSchemas: 2,
          history: 13,
          toolResults: 4,
          toolResultRows: [],
          historyMessages: 2,
          prefixStable: true,
          deltaTotal: 10,
        },
      ],
    },
  };
  const out = requestLedger(snap);
  assert.equal(out.available, true);
  assert.equal(out.sessions[0].requests[0].seq, 2); // newest first
  assert.equal(out.sessions[0].requests[0].purpose, 'compaction');
  assert.equal(out.sessions[0].requests[1].seq, 1);
});

test('requestLedger degrades cleanly without observations', () => {
  assert.equal(requestLedger({ capturedAt: 'x' }).available, false);
  assert.equal(requestLedger({ capturedAt: 'x', requestLedger: {} }).available, false);
});

test('classify records the largest result call id per tool', () => {
  const options = {
    system: 's',
    tools: [],
    messages: [
      msg('assistant', [
        { type: 'tool-call', id: 'small', name: 'bash', arguments: '{}' },
        { type: 'tool-call', id: 'big', name: 'bash', arguments: '{}' },
      ]),
      msg('user', [{ type: 'tool-result', toolCallId: 'small', content: [text('x'.repeat(40))] }], {
        kind: 'tool',
        callId: 'small',
      }),
      msg('user', [{ type: 'tool-result', toolCallId: 'big', content: [text('y'.repeat(4000))] }], {
        kind: 'tool',
        callId: 'big',
      }),
    ],
  };
  const entry = classify(options);
  assert.equal(entry.toolResultRows[0].name, 'bash');
  assert.equal(entry.toolResultRows[0].count, 2);
  assert.equal(entry.toolResultRows[0].topCallId, 'big'); // largest wins
});
