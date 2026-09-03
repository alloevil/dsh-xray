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

  test(`golden: ${name}`, () => {
    const actual = {};
    // Static side: fixtures/<name>/home is a synthetic DSH_HOME with a
    // profile named "test"; covers every fully static command.
    const staticData = hasHome ? collectWithHome(home) : null;
    if (staticData) {
      actual.attribute = model.attribute(staticData);
      actual.conflicts = model.conflicts(staticData);
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
      // Both sides present: the fixture also pins static↔runtime reconciliation.
      if (staticData) actual.verify = model.verify(staticData, snap);
    }
    check(dir, normalize(actual, home));
  });
}
