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

test('packageSource classifies registry, link and repository installs', () => {
  const { packageSource } = require('../lib/collect/static.js');
  const inNodeModules = path.join(home, 'profiles', 'test', 'node_modules', 'x');
  assert.equal(packageSource('^1.0.0', inNodeModules, home), 'registry');
  assert.equal(packageSource('link:/home/me/x', inNodeModules, home), 'link');
  assert.equal(packageSource('file:../x', inNodeModules, home), 'link');
  assert.equal(packageSource('workspace:*', inNodeModules, home), 'link');
  // The plugin-console mechanism wins over the declaration: the directory is
  // the fact, the spec is the hint.
  assert.equal(packageSource('^1.0.0', path.join(home, '.dsh-plugin', 'x'), home), 'repository');
  assert.equal(packageSource(undefined, null, home), 'registry');
});

test('packageIntegrity hashes content and ignores node_modules, .git and symlinks', () => {
  const { packageIntegrity } = require('../lib/collect/static.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-integrity-'));
  const outside = path.join(os.tmpdir(), `xray-outside-${process.pid}.js`);
  try {
    fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = 1;\n');
    const first = packageIntegrity(dir);
    assert.match(first.integrity, /^sha256-[0-9a-f]{16}$/);
    assert.equal(first.files, 1);

    fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), 'not this package\n');
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(outside, 'belongs to someone else\n');
    fs.symlinkSync(outside, path.join(dir, 'linked.js'));
    assert.deepEqual(packageIntegrity(dir), first, 'excluded subtrees must not move the digest');

    fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = 2;\n');
    const second = packageIntegrity(dir);
    assert.notEqual(second.integrity, first.integrity);
    assert.equal(second.files, 1);

    assert.equal(packageIntegrity(null), null, 'an unresolvable package has no digest to report');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});
