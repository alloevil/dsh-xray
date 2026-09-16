// whyTool(): the provenance chain for one registered tool, walked from the
// runtime snapshot alone — toolOwner → owner plugin → its injects → the
// providers of those services → on up to the plugins that inject nothing.
const { test } = require('node:test');
const assert = require('node:assert');
const { whyTool } = require('../lib/model.js');

const snap = {
  capturedAt: '2026-01-01T00:00:00.000Z',
  plugins: [
    { name: 'AppShell', inject: ['tools', 'webServer'], provide: ['shell'], fibers: [] },
    { name: 'ToolRuntime', inject: [], provide: ['tools'], fibers: [] },
    { name: 'ShadowTools', inject: [], provide: ['tools'], fibers: [] },
    { name: 'WebServer', inject: ['config'], provide: ['webServer'], fibers: [] },
    { name: 'ConfigService', inject: [], provide: ['config'], fibers: [] },
  ],
  services: [
    { name: 'tools', provider: 'ToolRuntime' },
    { name: 'webServer', provider: 'WebServer' },
    { name: 'config', provider: 'ConfigService' },
  ],
  tools: [{ name: 'xray_composition', tokens: 120 }],
  toolOwners: { xray_composition: 'AppShell' },
};

const chain = (name = 'xray_composition') => whyTool(snap, name).rows;

test('whyTool walks tool → owner → injects → providers → roots', () => {
  const rows = chain();
  assert.deepEqual(
    rows.map((r) => `${r.depth}:${r.kind}:${r.name ?? r.owner ?? ''}`),
    [
      '0:tool:xray_composition',
      '1:plugin:AppShell',
      '2:service:tools',
      '3:plugin:ToolRuntime',
      '3:plugin:ShadowTools',
      '2:service:webServer',
      '3:plugin:WebServer',
      '4:service:config',
      '5:plugin:ConfigService',
    ],
  );
  assert.equal(rows[0].owner, 'AppShell');
  assert.equal(rows[0].tokens, 120);
  assert.equal(rows[2].providers.length, 2, 'a service offered twice reports both providers');
});

test('whyTool marks plugins that inject nothing as roots, and stops there', () => {
  const rows = chain();
  const roots = rows.filter((r) => r.root).map((r) => r.name);
  assert.deepEqual(roots, ['ToolRuntime', 'ShadowTools', 'ConfigService']);
  assert.equal(rows.at(-1).root, true, 'the walk ends on a root, not on a bare service');
});

test('whyTool stops at a plugin already expanded instead of looping', () => {
  const cyclic = {
    ...snap,
    plugins: [
      { name: 'A', inject: ['b'], provide: ['a'], fibers: [] },
      { name: 'B', inject: ['a'], provide: ['b'], fibers: [] },
    ],
    services: [
      { name: 'a', provider: 'A' },
      { name: 'b', provider: 'B' },
    ],
    tools: [{ name: 'looper', tokens: 10 }],
    toolOwners: { looper: 'A' },
  };
  const rows = whyTool(cyclic, 'looper').rows;
  assert.deepEqual(
    rows.map((r) => `${r.kind}:${r.name}`),
    ['tool:looper', 'plugin:A', 'service:b', 'plugin:B', 'service:a', 'plugin:A'],
  );
  assert.equal(rows.at(-1).revisited, true);
});

test('whyTool reports an unattributed or absent tool without inventing a chain', () => {
  const missing = whyTool(snap, 'nope');
  assert.equal(missing.found, false);
  assert.equal(missing.tool.owner, null);
  assert.deepEqual(missing.rows, [
    { depth: 0, kind: 'tool', name: 'nope', owner: null, tokens: null },
  ]);
});

test('whyTool marks an owner that is not in this snapshot as unresolved', () => {
  const stale = { ...snap, plugins: [], services: [] };
  const rows = whyTool(stale, 'xray_composition').rows;
  assert.deepEqual(rows, [
    { depth: 0, kind: 'tool', name: 'xray_composition', owner: 'AppShell', tokens: 120 },
    { depth: 1, kind: 'plugin', name: 'AppShell', injects: [], unresolved: true },
  ]);
});

test('whyTool takes providers from the reflect store and callback provide, deduped', () => {
  const rows = chain();
  const toolsRow = rows.find((r) => r.kind === 'service' && r.name === 'tools');
  assert.deepEqual(toolsRow.providers, ['ToolRuntime', 'ShadowTools']);
});

test('whyTool keeps a service nobody provides as an empty-provider row', () => {
  const orphaned = {
    ...snap,
    services: [{ name: 'webServer', provider: 'WebServer' }],
    plugins: snap.plugins.filter((p) => p.name === 'AppShell' || p.name === 'WebServer'),
  };
  const toolsRow = whyTool(orphaned, 'xray_composition').rows.find(
    (r) => r.kind === 'service' && r.name === 'tools',
  );
  assert.deepEqual(toolsRow.providers, []);
});
