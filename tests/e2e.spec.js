// True end-to-end: drives the CLI binary against the machine's real dsh
// installation. Skips (cleanly, per test) when dsh or the web profile is
// absent — CI has neither; a developer box has both.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const BIN = path.join(__dirname, '..', 'bin', 'xray.js');
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const hasProfile = fs.existsSync(path.join(home, 'profiles', 'web', 'package.json'));
const hasRuntime = fs.existsSync(path.join(home, 'xray', 'runtime.json'));

function cli(...args) {
  return execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60_000 });
}

test('e2e: attribute lists rows with layer origins', { skip: !hasProfile }, () => {
  const out = JSON.parse(cli('attribute', '--json'));
  assert.ok(out.rows.length > 50, `expected a real tree, got ${out.rows.length} rows`);
  assert.ok(
    out.rows.every((r) => r.origin?.layer),
    'every row has an origin layer',
  );
});

test('e2e: conflicts reports multi-writer fields with winners', { skip: !hasProfile }, () => {
  const out = JSON.parse(cli('conflicts', '--json'));
  for (const c of out.conflicts) {
    for (const f of c.fields) {
      assert.equal(f.winner, f.writers[f.writers.length - 1].layer, 'last writer wins');
    }
  }
});

test('e2e: diff agrees on an untouched tree (spawns dsh)', { skip: !hasProfile }, () => {
  const out = JSON.parse(cli('diff', '--json'));
  assert.deepEqual(out.missingFromActual, []);
  assert.deepEqual(out.orphanOverrides, []);
});

test('e2e: snapshot emits the lockfile schema', { skip: !hasProfile }, () => {
  const out = JSON.parse(cli('snapshot'));
  assert.equal(out.schema, 'dsh-xray/snapshot@1');
  assert.ok(out.bundles.every((b) => /^[0-9a-f]{16}$/.test(b.patchHash)));
});

test('e2e: deps resolves core services from the live snapshot', { skip: !hasRuntime }, () => {
  const out = JSON.parse(cli('deps', '--json'));
  assert.ok(out.services.tools?.providers.length > 0, 'tools has a provider');
  assert.deepEqual(out.unsatisfied, [], 'no unsatisfied injects on a healthy boot');
});

test('e2e: health reports the live tree', { skip: !hasRuntime }, () => {
  const out = JSON.parse(cli('health', '--json'));
  assert.ok(out.healthy.length > 50, 'a booted web profile has many active plugins');
});

test('e2e: cost accounts for at least the xray tool itself', { skip: !hasRuntime }, () => {
  const out = JSON.parse(cli('cost', '--json'));
  assert.ok(out.tools.some((t) => t.name === 'xray_composition'));
  assert.ok(out.totalTokens > 0);
});

test('e2e: audit scans the link-installed plugin', { skip: !hasProfile }, () => {
  const out = JSON.parse(cli('audit', '--json'));
  const self = out.plugins.find((p) => p.name === 'dsh-xray');
  if (!self) return; // not link-installed on this machine — nothing to assert
  const ids = self.categories.map((c) => c.id);
  assert.ok(ids.includes('shell'), 'dump collector spawns dsh — must be flagged');
  assert.ok(ids.includes('fs'), 'collectors read files — must be flagged');
});
