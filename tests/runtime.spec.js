const { test } = require('node:test');
const assert = require('node:assert');
const { serviceGraph, health } = require('../lib/model.js');
const { injectNames, snapshotRegistry } = require('../lib/collect/runtime.js');

const snap = (plugins, transitions = {}) => ({
  schema: 'dsh-xray/runtime@1',
  capturedAt: '2026-08-20T00:00:00Z',
  plugins,
  transitions,
});

const plugin = (name, { inject = [], provide = [], fibers } = {}) => ({
  name,
  inject,
  provide,
  fibers: fibers ?? [{ uid: 1, state: 'ACTIVE', error: null, effects: [] }],
});

test('serviceGraph prefers reflect-store providers over callback provide', () => {
  const s = snap([plugin('AgentLoop', { inject: ['tools'] })]);
  s.services = [{ name: 'tools', provider: 'ToolRuntime' }];
  const g = serviceGraph(s);
  assert.deepEqual(g.services.tools.providers, ['ToolRuntime']);
  assert.deepEqual(g.cascade.ToolRuntime, ['AgentLoop']);
  assert.deepEqual(g.unsatisfied, []);
});

test('serviceGraph maps providers and consumers per service', () => {
  const g = serviceGraph(
    snap([plugin('tools-impl', { provide: ['tools'] }), plugin('my-tool', { inject: ['tools'] })]),
  );
  assert.deepEqual(g.services.tools.providers, ['tools-impl']);
  assert.deepEqual(g.services.tools.consumers, ['my-tool']);
});

test('cascade is transitive through re-provided services', () => {
  const g = serviceGraph(
    snap([
      plugin('a', { provide: ['s1'] }),
      plugin('b', { inject: ['s1'], provide: ['s2'] }),
      plugin('c', { inject: ['s2'] }),
    ]),
  );
  assert.deepEqual(g.cascade.a, ['b', 'c']);
  assert.deepEqual(g.cascade.b, ['c']);
});

test('unsatisfied inject is reported', () => {
  const g = serviceGraph(snap([plugin('lonely', { inject: ['ghost-service'] })]));
  assert.deepEqual(g.unsatisfied, [{ plugin: 'lonely', service: 'ghost-service' }]);
});

test('health separates active, pending, and failed fibers', () => {
  const h = health(
    snap(
      [
        plugin('ok', { fibers: [{ uid: 1, state: 'ACTIVE', error: null, effects: [] }] }),
        plugin('broken', { fibers: [{ uid: 2, state: 'FAILED', error: 'boom', effects: [] }] }),
        plugin('stuck', {
          inject: ['ghost'],
          fibers: [{ uid: 3, state: 'PENDING', error: null, effects: [] }],
        }),
      ],
      { broken: [{ state: 'FAILED', at: 1 }] },
    ),
  );
  assert.deepEqual(h.healthy, ['ok']);
  assert.equal(h.unhealthy.length, 1);
  assert.equal(h.unhealthy[0].name, 'broken');
  assert.equal(h.unhealthy[0].transitions.length, 1);
  assert.deepEqual(h.waiting, [{ name: 'stuck', inject: ['ghost'] }]);
});

test('injectNames handles array, object, and prototype-chained forms', () => {
  assert.deepEqual(injectNames(['a', 'b']), ['a', 'b']);
  assert.deepEqual(injectNames({ a: null, b: { opt: 1 } }).sort(), ['a', 'b']);
  const base = Object.create(null);
  base.inherited = null;
  const derived = Object.create(base);
  derived.own = null;
  assert.deepEqual(injectNames(derived).sort(), ['inherited', 'own']);
  assert.deepEqual(injectNames(null), []);
});

test('snapshotRegistry serializes a registry-shaped object defensively', () => {
  const fakeFiber = {
    uid: 7,
    state: 'active',
    getEffects: () => [{ label: 'my-effect', children: [] }],
  };
  const fakeCtx = {
    registry: {
      size: 1,
      values: () => [
        { name: 'p1', callback: { inject: ['tools'], provide: 'svc' }, fibers: [fakeFiber] },
      ],
    },
  };
  const s = snapshotRegistry(fakeCtx);
  assert.equal(s.plugins[0].name, 'p1');
  assert.deepEqual(s.plugins[0].provide, ['svc']);
  assert.equal(s.plugins[0].fibers[0].effects[0].label, 'my-effect');
});
