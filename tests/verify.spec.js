// verify(): reconcile the declared (static) composition with the runtime
// registry snapshot. Names differ by convention (loader rows: plugin-alpha;
// registry callbacks: PluginAlpha) — matching is normalized.
const { test } = require('node:test');
const assert = require('node:assert');
const { verify } = require('../lib/model.js');

const staticData = {
  layers: [
    {
      kind: 'profile-patch',
      name: 'profile-patch',
      file: '/x/p.yml',
      entries: [
        {
          insert: [
            { id: 'alpha', name: 'plugin-alpha' },
            { id: 'beta', name: 'plugin-beta' },
            { id: 'gamma', name: 'plugin-gamma' },
          ],
        },
        { id: 'gamma', disabled: true },
      ],
    },
  ],
};

const snap = {
  capturedAt: '2026-01-01T00:00:00.000Z',
  plugins: [
    { name: 'PluginAlpha', inject: [], provide: [], fibers: [] },
    { name: 'PluginGamma', inject: [], provide: [], fibers: [] },
    { name: 'ExtraHelper', inject: [], provide: [], fibers: [] },
  ],
};

test('verify matches declared rows to runtime plugins by normalized name', () => {
  const v = verify(staticData, snap);
  assert.equal(v.schema, 'dsh-xray/verify@1');
  assert.deepEqual(v.matched, [{ id: 'alpha', name: 'plugin-alpha', runtime: 'PluginAlpha' }]);
  assert.deepEqual(v.declaredNotRunning, [{ id: 'beta', name: 'plugin-beta' }]);
  assert.deepEqual(v.disabledButRunning, [
    { id: 'gamma', name: 'plugin-gamma', runtime: 'PluginGamma' },
  ]);
  assert.deepEqual(v.undeclaredRuntime, ['ExtraHelper']);
  assert.deepEqual(v.unsatisfied, []);
});

test('verify flags a snapshot older than the static layers', () => {
  const captured = Date.parse(snap.capturedAt);
  assert.equal(verify(staticData, snap, { staticMtimeMs: captured + 1 }).stale, true);
  assert.equal(verify(staticData, snap, { staticMtimeMs: captured - 1 }).stale, false);
  assert.equal(verify(staticData, snap).stale, null);
});
