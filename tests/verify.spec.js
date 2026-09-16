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
  services: [
    { name: 'alpha-api', provider: 'PluginAlpha' },
    { name: 'gamma-store', provider: 'PluginGamma' },
    { name: 'helper-bus', provider: 'ExtraHelper' },
  ],
  tools: [
    { name: 'alpha_tool', tokens: 80 },
    { name: 'gamma_tool', tokens: 60 },
    { name: 'helper_tool', tokens: 40 },
    { name: 'orphan_tool', tokens: 20 },
  ],
  toolOwners: {
    alpha_tool: 'PluginAlpha',
    gamma_tool: 'PluginGamma',
    helper_tool: 'ExtraHelper',
  },
};

test('verify matches declared rows to runtime plugins by normalized name', () => {
  const v = verify(staticData, snap);
  assert.equal(v.schema, 'dsh-xray/verify@2');
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

test('verify resolves each runtime service provider to its declared row', () => {
  const v = verify(staticData, snap);
  assert.equal(v.services.checked, 3);
  assert.deepEqual(v.services.rows[0], {
    name: 'alpha-api',
    provider: 'PluginAlpha',
    row: { id: 'alpha', name: 'plugin-alpha', disabled: false },
  });
  // A provider the static layers never declare — reported, never guessed.
  assert.deepEqual(v.services.providerUndeclared, [
    { name: 'helper-bus', provider: 'ExtraHelper' },
  ]);
  // A service still provided by a row the composition disables: the same class
  // of smell as disabled-but-running.
  assert.deepEqual(v.services.providerDisabled, [
    { name: 'gamma-store', provider: 'PluginGamma', id: 'gamma' },
  ]);
});

test('verify resolves each tool owner to its declared row and counts the unattributed', () => {
  const v = verify(staticData, snap);
  assert.equal(v.tools.checked, 3);
  assert.deepEqual(v.tools.ownerUndeclared, [{ name: 'helper_tool', owner: 'ExtraHelper' }]);
  assert.deepEqual(v.tools.ownerDisabled, [
    { name: 'gamma_tool', owner: 'PluginGamma', id: 'gamma' },
  ]);
  assert.deepEqual(v.tools.unattributed, ['orphan_tool']);
});

test('verify states the boundary of the static side instead of implying a declaration', () => {
  const v = verify(staticData, snap);
  assert.equal(v.notes.length, 1);
  assert.match(v.notes[0], /provide or tool lists/);
});

test('verify reports empty runtime sections rather than failing on them', () => {
  const bare = { capturedAt: snap.capturedAt, plugins: snap.plugins };
  const v = verify(staticData, bare);
  assert.equal(v.schema, 'dsh-xray/verify@2');
  assert.deepEqual(v.services, {
    checked: 0,
    rows: [],
    providerUndeclared: [],
    providerDisabled: [],
  });
  assert.deepEqual(v.tools, {
    checked: 0,
    rows: [],
    ownerUndeclared: [],
    ownerDisabled: [],
    unattributed: [],
  });
});
