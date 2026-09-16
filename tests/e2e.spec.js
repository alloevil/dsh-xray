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
  assert.equal(out.schema, 'dsh-xray/snapshot@2');
  assert.ok(out.bundles.every((b) => /^[0-9a-f]{16}$/.test(b.patchHash)));
  assert.ok(
    out.packages.every((p) => p.source && p.integrity?.startsWith('sha256-')),
    'every installed plugin carries provenance and a content hash',
  );
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
  assert.equal(out.schema, 'dsh-xray/audit@2');
  const self = out.plugins.find((p) => p.name === 'dsh-xray');
  if (!self) return; // not link-installed on this machine — nothing to assert
  const ids = self.capabilities.map((c) => c.capability);
  assert.ok(ids.includes('process.spawn'), 'dump collector spawns dsh — must be flagged');
  assert.ok(ids.includes('filesystem.read'), 'collectors read files — must be flagged');
  for (const c of self.capabilities) {
    assert.ok(['high', 'medium', 'low'].includes(c.confidence), `confidence: ${c.confidence}`);
    assert.ok(c.hits.length > 0, `${c.capability} reported with no evidence`);
    assert.ok(
      c.hits.every((h) => h.file && Number.isInteger(h.line) && h.line > 0 && h.text),
      `${c.capability} hits must carry file:line and the matched text`,
    );
  }
});

test('e2e: verify reconciles services and tools against the declared rows', {
  skip: !hasRuntime,
}, () => {
  const out = JSON.parse(cli('verify', '--json'));
  assert.equal(out.schema, 'dsh-xray/verify@2');
  assert.ok(out.services.checked > 0, 'a booted profile provides services');
  assert.ok(out.tools.checked >= 0 && Array.isArray(out.tools.rows));
  assert.ok(out.notes.length > 0, 'the static-side boundary is stated, not implied');
});

test('e2e: why walks a real tool chain to the kernel roots', { skip: !hasRuntime }, () => {
  const snap = JSON.parse(fs.readFileSync(path.join(home, 'xray', 'runtime.json'), 'utf8'));
  const tool = Object.keys(snap.toolOwners ?? {})[0];
  if (!tool) return; // no attribution observed yet — nothing to assert
  const out = JSON.parse(cli('why', tool, '--json'));
  assert.equal(out.schema, 'dsh-xray/why@1');
  assert.equal(out.found, true);
  assert.equal(out.rows[0].name, tool);
  assert.equal(out.rows[0].kind, 'tool');
  assert.ok(
    out.rows.some((r) => r.kind === 'plugin'),
    'the chain names the registering plugin',
  );
});
