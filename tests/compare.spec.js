// compareSnapshots: saved lockfile vs the current snapshot. The saved lock may
// be schema@1 (versions only) — the comparison reports what it can and names
// what it cannot in `notices`, instead of calling the unchecked parts equal.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { compareSnapshots } = require('../lib/compare.js');

const base = () => ({
  schema: 'dsh-xray/snapshot@2',
  createdAt: '2026-08-20T00:00:00Z',
  profile: 'web',
  bundles: [
    { name: '@deepseek-ai/dsh-base', version: '0.1.0-rc.6', patchHash: 'aaaa' },
    { name: '@deepseek-ai/dsh-web-app', version: '0.1.0-rc.6', patchHash: 'bbbb' },
  ],
  patches: [{ kind: 'profile-patch', file: '/x', hash: 'cccc' }],
  packages: [
    { name: 'dsh-xray', version: '0.4.1', source: 'link', integrity: 'sha256-1111', files: 42 },
  ],
  services: [
    { name: 'tools', provider: 'ToolRuntime' },
    { name: 'storage', provider: 'ShadowA' },
  ],
  tools: [{ name: 'xray_composition', owner: 'dsh-xray', tokens: 120 }],
  composedHash: 'dddd',
  rowCount: 12,
});

test('identical snapshots compare clean', () => {
  const r = compareSnapshots(base(), base());
  assert.equal(r.schema, 'dsh-xray/snapshot-diff@2');
  assert.equal(r.identical, true);
  assert.deepEqual(r.notices, []);
});

test('bundle version bump and patch content drift are reported', () => {
  const cur = base();
  cur.bundles[0].version = '0.1.0-rc.7';
  cur.patches[0].hash = 'eeee';
  cur.composedHash = 'ffff';
  const r = compareSnapshots(base(), cur);
  assert.equal(r.identical, false);
  assert.deepEqual(r.changes.bundles[0], {
    name: '@deepseek-ai/dsh-base',
    change: 'version',
    from: { version: '0.1.0-rc.6', patchHash: 'aaaa' },
    to: { version: '0.1.0-rc.7', patchHash: 'aaaa' },
  });
  assert.equal(r.changes.patches[0].change, 'content');
  assert.deepEqual(r.changes.composed, { from: 'dddd', to: 'ffff' });
});

test('package add and remove are reported', () => {
  const cur = base();
  cur.packages = [
    {
      name: 'dsh-market',
      version: '1.15.0',
      source: 'registry',
      integrity: 'sha256-2222',
      files: 9,
    },
  ];
  const r = compareSnapshots(base(), cur);
  assert.deepEqual(r.changes.packages.map((p) => `${p.change}:${p.name}`).sort(), [
    'added:dsh-market',
    'removed:dsh-xray',
  ]);
});

test('package content drift is reported as integrity, not as a version bump', () => {
  const cur = base();
  cur.packages[0].integrity = 'sha256-9999';
  const r = compareSnapshots(base(), cur);
  assert.equal(r.changes.packages.length, 1);
  assert.equal(r.changes.packages[0].change, 'integrity');
  assert.equal(r.changes.packages[0].from.integrity, 'sha256-1111');
  assert.equal(r.changes.packages[0].to.integrity, 'sha256-9999');
  assert.equal(r.identical, false);
});

test('a package that switched from a working copy to a registry install is reported', () => {
  const cur = base();
  cur.packages[0].source = 'registry';
  const r = compareSnapshots(base(), cur);
  assert.equal(r.changes.packages[0].change, 'source');
  assert.equal(r.changes.packages[0].from.source, 'link');
});

test('service providers and tool ownership drift are reported', () => {
  const cur = base();
  cur.services[0] = { name: 'tools', provider: 'ToolRuntimeV2' };
  cur.services.push({ name: 'events', provider: 'Bus' });
  cur.tools = [
    { name: 'xray_composition', owner: 'dsh-xray', tokens: 140 },
    { name: 'bash', owner: 'dsh-bash', tokens: 300 },
  ];
  const r = compareSnapshots(base(), cur);
  assert.deepEqual(r.changes.services, [
    { name: 'tools', change: 'providers', from: 'ToolRuntime', to: 'ToolRuntimeV2' },
    { name: 'events', change: 'added', provider: 'Bus' },
  ]);
  assert.deepEqual(r.changes.tools, [
    { name: 'xray_composition', change: 'tokens', from: 120, to: 140 },
    { name: 'bash', change: 'added', owner: 'dsh-bash' },
  ]);
  assert.equal(r.identical, false);
});

test('tool ownership change wins over a token change in the same row', () => {
  const cur = base();
  cur.tools = [{ name: 'xray_composition', owner: 'other-plugin', tokens: 140 }];
  const r = compareSnapshots(base(), cur);
  assert.deepEqual(r.changes.tools, [
    { name: 'xray_composition', change: 'owner', from: 'dsh-xray', to: 'other-plugin' },
  ]);
});

test('a schema@1 lock is compared field by field and its gaps are named', () => {
  const saved = base();
  saved.schema = 'dsh-xray/snapshot@1';
  // A @1 lock carries versions only — no source/integrity, no runtime sections.
  saved.packages = [{ name: 'dsh-xray', version: '0.4.1' }];
  saved.services = undefined;
  saved.tools = undefined;
  const r = compareSnapshots(saved, base());
  assert.equal(r.savedSchema, 'dsh-xray/snapshot@1');
  assert.equal(r.identical, true, 'same version and nothing else the @1 lock can speak to');
  assert.deepEqual(r.changes.packages, [], 'absent source/integrity must not read as drift');
  assert.deepEqual(r.changes.services, []);
  assert.deepEqual(r.notices, [
    'saved lock is schema@1: package source/integrity and runtime sections not compared',
  ]);

  const bumped = base();
  bumped.packages[0].version = '0.5.0';
  const r2 = compareSnapshots(saved, bumped);
  assert.equal(r2.changes.packages[0].change, 'version');
  assert.equal(r2.identical, false);
});

test('a lock with no integrity says so instead of implying the packages are verified', () => {
  const saved = base();
  saved.packages = [
    { name: 'dsh-xray', version: '0.4.1', source: null, integrity: null, files: null },
  ];
  const r = compareSnapshots(saved, base());
  assert.deepEqual(r.notices, [
    'saved lock records no package integrity: package content drift cannot be detected',
  ]);
});

test('non-snapshot input is rejected', () => {
  assert.throws(() => compareSnapshots({ schema: 'nope' }, base()), /not a dsh-xray snapshot/);
  assert.throws(
    () => compareSnapshots({ schema: 'dsh-xray/snapshot@3' }, base()),
    /not a dsh-xray snapshot/,
  );
});

// The committed drift scenario: `snapshot --against` output is pinned as a
// golden, so a comparison refactor that changes the report shows up as a diff.
test('golden: fixtures/lock-drift pins the --against report', () => {
  const dir = path.join(__dirname, '..', 'fixtures', 'lock-drift');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'saved.json'), 'utf8'));
  const current = JSON.parse(fs.readFileSync(path.join(dir, 'current.json'), 'utf8'));
  const actual = compareSnapshots(saved, current);
  assert.deepEqual(actual, JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8')));
});
