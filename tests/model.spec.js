'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { replayLayers, attribute, conflicts, diff } = require('../lib/model.js');
const { parseDump } = require('../lib/collect/dump.js');

const layer = (kind, name, entries) => ({ kind, name, file: `/x/${name}.yml`, entries, text: '' });

const base = layer('bundle', 'base', [
  { insert: [{ id: 'a', name: 'plugin-a' }, { id: 'b', name: 'plugin-b', config: { x: 1 } }] },
]);

test('insert then override attributes origin and patch chain', () => {
  const app = layer('bundle', 'app', [{ id: 'b', config: { x: 2 } }]);
  const result = attribute({ layers: [base, app], packages: [], warnings: [] });
  const b = result.rows.find((r) => r.id === 'b');
  assert.equal(b.origin.layer, 'base');
  assert.deepEqual(b.overrides.map((o) => o.layer), ['app']);
});

test('override of missing id is an orphan, not a new row', () => {
  const p = layer('profile-patch', 'profile-patch', [{ id: 'ghost', config: {} }]);
  const { rows, orphans } = replayLayers([base, p]);
  assert.equal(rows.has('ghost'), false);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].id, 'ghost');
});

test('last writer wins per contested field', () => {
  const l1 = layer('bundle', 'app', [{ id: 'b', config: { x: 2 } }]);
  const l2 = layer('profile-patch', 'profile-patch', [{ id: 'b', config: { x: 3 } }]);
  const out = conflicts({ layers: [base, l1, l2] });
  const field = out.find((c) => c.id === 'b').fields.find((f) => f.field === 'config');
  assert.equal(field.winner, 'profile-patch');
  assert.equal(field.writers.length, 3); // insert + two overrides
});

test('later insert with same id replaces the row (still an insert event)', () => {
  const l = layer('profile-patch', 'profile-patch', [{ insert: [{ id: 'a', name: 'plugin-a2' }] }]);
  const { rows, provenance } = replayLayers([base, l]);
  assert.equal(rows.get('a').name, 'plugin-a2');
  assert.equal(provenance.get('a').filter((e) => e.action === 'insert').length, 2);
});

test('diff flags undeclared and missing rows plus disabled mismatch', () => {
  const dump = parseDump([
    '# == base',
    '- id: a',
    "  name: 'plugin-a'",
    '- id: extra',
    "  name: 'plugin-extra'",
  ].join('\n'));
  // declared: a, b(disabled declared false, absent from dump)
  const staticData = { layers: [base], packages: [], warnings: [] };
  const d = diff(staticData, dump);
  assert.deepEqual(d.missingFromActual.map((r) => r.id), ['b']);
  assert.deepEqual(d.missingFromDeclared.map((r) => r.id), ['extra']);
  assert.equal(d.missingFromDeclared[0].provenance, 'base');
});

test('parseDump maps provenance headers to following rows', () => {
  const { rows } = parseDump([
    '# == layer-one',
    '- id: r1',
    '- id: r2',
    '# == layer-two',
    '- id: r3',
  ].join('\n'));
  assert.deepEqual(rows.map((r) => r.provenance), ['layer-one', 'layer-one', 'layer-two']);
});

test('!!js expressions parse as opaque markers', () => {
  const { rows } = parseDump("- id: r1\n  config:\n    root: !!js dshHomePath('sessions')\n");
  assert.deepEqual(rows[0].config.root, { $js: "dshHomePath('sessions')" });
});
