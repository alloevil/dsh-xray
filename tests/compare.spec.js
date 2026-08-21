const { test } = require('node:test');
const assert = require('node:assert');
const { compareSnapshots } = require('../lib/compare.js');

const base = () => ({
  schema: 'dsh-xray/snapshot@1',
  createdAt: '2026-08-20T00:00:00Z',
  profile: 'web',
  bundles: [
    { name: '@deepseek-ai/dsh-base', version: '0.1.0-rc.6', patchHash: 'aaaa' },
    { name: '@deepseek-ai/dsh-web-app', version: '0.1.0-rc.6', patchHash: 'bbbb' },
  ],
  patches: [{ kind: 'profile-patch', file: '/x', hash: 'cccc' }],
  packages: [{ name: 'dsh-xray', version: '0.4.1' }],
  composedHash: 'dddd',
});

test('identical snapshots compare clean', () => {
  const r = compareSnapshots(base(), base());
  assert.equal(r.identical, true);
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
  cur.packages = [{ name: 'dsh-market', version: '1.15.0' }];
  const r = compareSnapshots(base(), cur);
  assert.deepEqual(r.changes.packages.map((p) => `${p.change}:${p.name}`).sort(), [
    'added:dsh-market',
    'removed:dsh-xray',
  ]);
});

test('non-snapshot input is rejected', () => {
  assert.throws(() => compareSnapshots({ schema: 'nope' }, base()), /not a dsh-xray snapshot/);
});
