// Golden tests: each fixture is a complete input composition — a synthetic
// DSH_HOME tree, a captured runtime snapshot, or both — paired with the exact
// expected output of every command that reads it. A parser or model refactor
// that changes ANY observable result shows up here as a diff, not silently.
//
// Regenerate after an intentional behavior change:  UPDATE_GOLDEN=1 npm test
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const model = require('../lib/model.js');
const { collectAudit } = require('../lib/collect/audit.js');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

/** Strip machine-specific path prefixes so goldens are portable. */
function normalize(value, home) {
  return JSON.parse(JSON.stringify(value).replaceAll(home, '<HOME>'));
}

function check(dir, actual) {
  const file = path.join(dir, 'expected.json');
  if (UPDATE) {
    fs.writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  assert.ok(fs.existsSync(file), `missing golden: ${file} — run UPDATE_GOLDEN=1 npm test`);
  assert.deepEqual(actual, JSON.parse(fs.readFileSync(file, 'utf8')));
}

function collectWithHome(home) {
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { collectStatic } = require('../lib/collect/static.js');
    return collectStatic('test');
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
  }
}

for (const name of fs.readdirSync(FIXTURES).sort()) {
  const dir = path.join(FIXTURES, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  const home = path.join(dir, 'home');
  const snapFile = path.join(dir, 'runtime.json');
  const hasHome = fs.existsSync(home);
  const hasSnap = fs.existsSync(snapFile);
  // Only composition fixtures belong here: a fixture with neither a synthetic
  // home nor a captured snapshot (e.g. fixtures/lock-drift, which pins the
  // `snapshot --against` report in tests/compare.spec.js) has no command
  // output for this runner to pin.
  if (!hasHome && !hasSnap) continue;

  test(`golden: ${name}`, () => {
    const actual = {};
    // Static side: fixtures/<name>/home is a synthetic DSH_HOME with a
    // profile named "test"; covers every fully static command.
    const staticData = hasHome ? collectWithHome(home) : null;
    if (staticData) {
      actual.attribute = model.attribute(staticData);
      actual.conflicts = model.conflicts(staticData);
      actual.audit = collectAudit(staticData);
      // The audit is the one collector that stamps wall-clock time; the golden
      // pins the shape, not the moment it ran.
      actual.audit.capturedAt = '<TS>';
    }
    // Runtime side: fixtures/<name>/runtime.json is a captured snapshot
    // (capturedAt frozen in the fixture, so outputs are deterministic).
    if (hasSnap) {
      const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
      actual.deps = model.serviceGraph(snap);
      actual.health = model.health(snap);
      actual.cost = model.contextCost(snap);
      actual.shadow = model.shadowing(snap);
      actual.skills = model.skillCost(snap);
      actual.requests = model.requestLedger(snap);
      // Every attributed tool gets its provenance chain pinned, so a change in
      // how a chain is walked shows up as a diff in this fixture.
      const owned = Object.keys(snap.toolOwners ?? {}).sort();
      if (owned.length) {
        actual.why = Object.fromEntries(owned.map((tool) => [tool, model.whyTool(snap, tool)]));
      }
      // Both sides present: the fixture also pins static↔runtime reconciliation.
      if (staticData) actual.verify = model.verify(staticData, snap);
    }
    check(dir, normalize(actual, home));
  });
}
