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
    "const cp = require('node:child_process');\nexecSync('git status');\nfetch('https://x.example');\nconst key = process.env.SECRET;\n",
  );
  fs.writeFileSync(path.join(pkgDir, 'lib', 'clean.js'), 'exports.add = (a, b) => a + b;\n');
  // import-only: reachable, but nothing says which half of node:fs is used
  fs.writeFileSync(path.join(pkgDir, 'lib', 'import-only.js'), "const fs = require('node:fs');\n");
  // call-only + import: every capability path, and two hits in one file
  fs.writeFileSync(
    path.join(pkgDir, 'lib', 'mixed.js'),
    [
      "import { readFileSync } from 'node:fs';",
      "readFileSync('a');",
      'spawnSync(process.execPath, []);',
      'execFileSync(process.execPath, []);',
      '',
    ].join('\n'),
  );
  // a matched line longer than the snippet budget
  fs.writeFileSync(
    path.join(pkgDir, 'lib', 'long.js'),
    `fs.writeFileSync('/tmp/x', '${'y'.repeat(200)}');\n`,
  );
  // node_modules must be skipped even when it contains scary code
  fs.mkdirSync(path.join(pkgDir, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'node_modules', 'dep', 'index.js'), 'eval("1");');
});

after(() => {
  fs.rmSync(pkgDir, { recursive: true, force: true });
});

const capability = (out, id) => out.capabilities.find((c) => c.capability === id);

test('auditPackage reports capabilities with file:line evidence and skips node_modules', () => {
  const out = auditPackage(pkgDir);
  const ids = out.capabilities.map((c) => c.capability).sort();
  assert.deepEqual(ids, [
    'env.read',
    'filesystem.read',
    'filesystem.write',
    'network.outbound',
    'process.spawn',
  ]);
  assert.equal(
    out.capabilities.some((c) => c.capability === 'code.eval'),
    false,
  );
  const main = capability(out, 'process.spawn');
  assert.deepEqual(main.hits, [
    {
      file: path.join('lib', 'main.js'),
      line: 1,
      text: "const cp = require('node:child_process');",
    },
    { file: path.join('lib', 'main.js'), line: 2, text: "execSync('git status');" },
    { file: path.join('lib', 'mixed.js'), line: 3, text: 'spawnSync(process.execPath, []);' },
    { file: path.join('lib', 'mixed.js'), line: 4, text: 'execFileSync(process.execPath, []);' },
  ]);
  assert.equal(capability(out, 'network.outbound').hits[0].line, 3, 'line numbers are 1-based');
});

test('auditPackage grades confidence from import + call site, per capability', () => {
  const out = auditPackage(pkgDir);
  // import (main.js:1) + call site (main.js:2) somewhere in the package
  assert.equal(capability(out, 'process.spawn').confidence, 'high');
  assert.equal(capability(out, 'filesystem.read').confidence, 'high', 'mixed.js imports and calls');
  assert.equal(
    capability(out, 'filesystem.write').confidence,
    'high',
    'the fs import covers write, and long.js writes',
  );
  // only a call site: it may be a same-named local function
  assert.equal(capability(out, 'network.outbound').confidence, 'medium');
  // process.env has no import to corroborate it and no read/write distinction
  assert.equal(capability(out, 'env.read').confidence, 'low');
});

test('auditPackage falls back to medium when only one side of the pair is present', () => {
  const importOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-import-only-'));
  fs.writeFileSync(path.join(importOnly, 'index.js'), "import fs from 'node:fs';\n");
  const a = auditPackage(importOnly);
  assert.equal(capability(a, 'filesystem.read').confidence, 'medium');
  assert.equal(capability(a, 'filesystem.write').confidence, 'medium');
  fs.rmSync(importOnly, { recursive: true, force: true });

  const callOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-call-only-'));
  fs.writeFileSync(path.join(callOnly, 'index.js'), "spawnSync('git', []);\neval('1');\n");
  const b = auditPackage(callOnly);
  assert.equal(capability(b, 'process.spawn').confidence, 'medium');
  assert.equal(capability(b, 'code.eval').confidence, 'medium');
  fs.rmSync(callOnly, { recursive: true, force: true });
});

test('auditPackage keeps two hits of one capability in one file', () => {
  const out = auditPackage(pkgDir);
  const spawn = capability(out, 'process.spawn');
  assert.equal(spawn.hits.filter((h) => h.file === path.join('lib', 'mixed.js')).length, 2);
});

test('auditPackage truncates long matched lines to the snippet budget', () => {
  const out = auditPackage(pkgDir);
  const hit = capability(out, 'filesystem.write').hits.find(
    (h) => h.file === path.join('lib', 'long.js'),
  );
  assert.equal(hit.text.length, 80);
  assert.ok(hit.text.endsWith('…'), `snippet not marked truncated: ${hit.text}`);
  assert.ok(hit.text.startsWith('fs.writeFileSync('), 'snippet keeps the match at its head');
});

test('auditPackage on a clean package reports nothing', () => {
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-clean-'));
  fs.writeFileSync(path.join(clean, 'index.js'), 'module.exports = 1;\n');
  const out = auditPackage(clean);
  assert.deepEqual(out.capabilities, []);
  fs.rmSync(clean, { recursive: true, force: true });
});
