const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { shadowing, contextCost } = require('../lib/model.js');
const { auditPackage } = require('../lib/collect/audit.js');
const { estimateTokens } = require('../lib/collect/runtime.js');

// -- F7 shadowing --------------------------------------------------------

test('shadowing flags a service provided by two plugins', () => {
  const snap = {
    plugins: [
      { name: 'p1', inject: [], provide: ['storage'], fibers: [] },
      { name: 'p2', inject: [], provide: [], fibers: [] },
    ],
    services: [{ name: 'storage', provider: 'p2' }],
  };
  const out = shadowing(snap);
  assert.equal(out.services.length, 1);
  assert.deepEqual(out.services[0].providers.sort(), ['p1', 'p2']);
});

test('shadowing counts tool registrations from effect labels', () => {
  const snap = {
    plugins: [
      {
        name: 'toolful',
        inject: [],
        provide: [],
        fibers: [{ effects: [{ label: 'tools.register()' }, { label: 'tools.register()' }] }],
      },
      { name: 'quiet', inject: [], provide: [], fibers: [{ effects: [] }] },
    ],
    services: [],
  };
  const out = shadowing(snap);
  assert.deepEqual(out.registrars, [{ plugin: 'toolful', registrations: 2 }]);
  assert.equal(out.services.length, 0);
});

// -- F8 context cost ------------------------------------------------------

test('contextCost sorts by tokens and computes shares', () => {
  const out = contextCost({
    capturedAt: 'now',
    tools: [
      { name: 'small', tokens: 100 },
      { name: 'big', tokens: 300 },
    ],
  });
  assert.equal(out.totalTokens, 400);
  assert.deepEqual(
    out.tools.map((t) => t.name),
    ['big', 'small'],
  );
  assert.equal(out.tools[0].share, 75);
});

test('contextCost blends prompt sections into the total', () => {
  const out = contextCost({
    capturedAt: 'now',
    tools: [{ name: 'tool-a', tokens: 100 }],
    promptAssembly: {
      at: 123,
      sections: [
        { name: 'deployment:persona', tokens: 200 },
        { name: 'skills', tokens: 100 },
      ],
    },
  });
  assert.equal(out.totalTokens, 400);
  assert.equal(out.sectionTokens, 300);
  assert.equal(out.sections[0].name, 'deployment:persona');
  assert.equal(out.sections[0].share, 50);
  assert.equal(out.promptObservedAt, 123);
});

test('contextCost tolerates a snapshot without tools', () => {
  const out = contextCost({ capturedAt: 'now' });
  assert.equal(out.totalTokens, 0);
  assert.deepEqual(out.tools, []);
});

test('estimateTokens is ceil(chars/4)', () => {
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
});

// -- F6 audit -------------------------------------------------------------

let pkgDir;

before(() => {
  pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-audit-'));
  fs.mkdirSync(path.join(pkgDir, 'lib'));
  fs.writeFileSync(
    path.join(pkgDir, 'lib', 'main.js'),
    "const cp = require('node:child_process');\nfetch('https://x.example');\nconst key = process.env.SECRET;\n",
  );
  fs.writeFileSync(path.join(pkgDir, 'lib', 'clean.js'), 'exports.add = (a, b) => a + b;\n');
  // node_modules must be skipped even when it contains scary code
  fs.mkdirSync(path.join(pkgDir, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'node_modules', 'dep', 'index.js'), 'eval("1");');
});

after(() => {
  fs.rmSync(pkgDir, { recursive: true, force: true });
});

test('auditPackage detects categories and skips node_modules', () => {
  const out = auditPackage(pkgDir);
  const ids = out.categories.map((c) => c.id).sort();
  assert.deepEqual(ids, ['env', 'network', 'shell']);
  assert.equal(
    out.categories.some((c) => c.id === 'eval'),
    false,
  );
  const network = out.categories.find((c) => c.id === 'network');
  assert.deepEqual(network.files, [path.join('lib', 'main.js')]);
});

test('auditPackage on a clean package reports nothing', () => {
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-clean-'));
  fs.writeFileSync(path.join(clean, 'index.js'), 'module.exports = 1;\n');
  const out = auditPackage(clean);
  assert.deepEqual(out.categories, []);
  fs.rmSync(clean, { recursive: true, force: true });
});
