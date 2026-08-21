// Collector tests against a synthetic DSH_HOME fixture (no real dsh needed).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let home;

before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-home-'));
  process.env.DSH_HOME = home;

  const profile = path.join(home, 'profiles', 'test');
  const bundleDir = path.join(home, 'profiles', 'node_modules', '@fixture', 'bundle-a');
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(bundleDir, { recursive: true });

  fs.writeFileSync(
    path.join(profile, 'package.json'),
    JSON.stringify({
      name: 'dsh-profile-test',
      dependencies: { 'dsh-ghost': '^1.0.0' },
      dsh: { profile: { bundles: ['@fixture/bundle-a', '@fixture/missing-bundle'] } },
    }),
  );
  fs.writeFileSync(
    path.join(bundleDir, 'package.json'),
    JSON.stringify({
      name: '@fixture/bundle-a',
      version: '1.2.3',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
  );
  fs.writeFileSync(
    path.join(bundleDir, 'cordis.patch.yml'),
    "- insert:\n    - id: a\n      name: plugin-a\n      config:\n        root: !!js dshHomePath('x')\n",
  );
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), '- id: a\n  disabled: true\n');

  // Repository plugin fixture (.dsh-plugin mechanism)
  const repoDir = path.join(home, '.dsh-plugin', 'my-repo-plugin');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, 'package.json'),
    JSON.stringify({
      name: 'my-repo-plugin',
      version: '2.0.0',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
  );
  fs.writeFileSync(
    path.join(repoDir, 'cordis.patch.yml'),
    '- insert:\n    - id: repo-row\n      name: my-repo-plugin\n',
  );
});

after(() => {
  delete process.env.DSH_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

test('collectStatic reads bundle and profile layers in order, with warnings', () => {
  // Late require: DSH_HOME must be set before dshHome() is called.
  const { collectStatic } = require('../lib/collect/static.js');
  const data = collectStatic('test');

  assert.deepEqual(
    data.layers.map((l) => l.kind),
    ['bundle', 'profile-patch', 'repository'],
  );
  assert.equal(data.layers[0].name, '@fixture/bundle-a');
  assert.equal(data.layers[0].version, '1.2.3');
  assert.equal(data.layers[0].entries[0].insert[0].id, 'a');
  // !!js parses as opaque marker, not evaluated
  assert.deepEqual(data.layers[0].entries[0].insert[0].config.root, { $js: "dshHomePath('x')" });

  // missing bundle and uninstalled dependency surface as warnings, not throws
  assert.ok(data.warnings.some((w) => w.includes('@fixture/missing-bundle')));
  assert.ok(data.warnings.some((w) => w.includes('dsh-ghost')));
});

test('collectStatic throws on missing profile', () => {
  const { collectStatic } = require('../lib/collect/static.js');
  assert.throws(() => collectStatic('no-such-profile'), /profile manifest not found/);
});

test('end-to-end: attribute over the fixture home', () => {
  const { collectStatic } = require('../lib/collect/static.js');
  const { attribute } = require('../lib/model.js');
  const result = attribute(collectStatic('test'));
  const a = result.rows.find((r) => r.id === 'a');
  assert.equal(a.origin.layer, '@fixture/bundle-a');
  assert.equal(a.disabled, true);
  assert.deepEqual(
    a.overrides.map((o) => o.kind),
    ['profile-patch'],
  );
  const repo = result.rows.find((r) => r.id === 'repo-row');
  assert.equal(repo.origin.kind, 'repository');
  assert.equal(repo.origin.layer, 'my-repo-plugin');
});
