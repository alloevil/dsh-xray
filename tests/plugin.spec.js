// Integration test of the plugin entry: mounts apply() against a mock Cordis
// context and exercises the full path — status subscription, snapshot write,
// tool registration, and every xray_composition view. No dsh required.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let home;
let ctx;
let registeredTool = null;
let statusListener = null;
let assembleListener = null;

function makeFiber(name, state, effects = []) {
  return { uid: 1, name, state, getEffects: () => effects };
}

before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-e2e-'));
  process.env.DSH_HOME = home;

  // Borrow the real machine's profile closure when present, so the plugin
  // resolves the genuine @deepseek-ai/dsh-tools defineTool. Absent (CI),
  // the degradation branch is what gets tested.
  const realClosure = path.join(os.homedir(), '.dsh', 'profiles', 'node_modules');
  if (fs.existsSync(realClosure)) {
    fs.mkdirSync(path.join(home, 'profiles'), { recursive: true });
    fs.symlinkSync(realClosure, path.join(home, 'profiles', 'node_modules'));
  }

  // Minimal but honest mock of the Cordis surface the plugin touches.
  const runtimes = [
    {
      name: 'ToolRuntime',
      callback: { inject: [], provide: [] },
      fibers: [makeFiber('ToolRuntime', 2)],
    },
    {
      name: 'AgentLoop',
      callback: { inject: ['tools', 'llm'], provide: [] },
      fibers: [makeFiber('AgentLoop', 2)],
    },
    {
      name: 'Broken',
      callback: { inject: [], provide: [] },
      fibers: [makeFiber('Broken', 3)],
    },
  ];
  const store = {
    tools: { name: 'tools', fiber: { name: 'ToolRuntime' } },
    llm: { name: 'llm', fiber: { name: 'LlmService' } },
  };
  ctx = {
    registry: { size: runtimes.length, values: () => runtimes },
    reflect: { store },
    root: null,
    logger: () => ({ info: () => {}, warn: () => {} }),
    effect(execute) {
      const disposers = execute();
      return () => {
        for (const d of Array.isArray(disposers) ? disposers : [disposers]) d();
      };
    },
    on(event, listener) {
      if (event === 'internal/status') statusListener = listener;
      if (event === 'system-prompt/assemble') assembleListener = listener;
      return () => {};
    },
    plugin(obj) {
      // The tool subplugin: run it immediately with a tools mock.
      obj.apply({ tools: { register: (def) => (registeredTool = def) } });
    },
    get: (name) =>
      name === 'tools'
        ? { schemas: () => [{ name: 'read_file', description: 'x'.repeat(120), parameters: {} }] }
        : undefined,
  };
  ctx.root = ctx;
});

after(() => {
  delete process.env.DSH_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

test('apply() mounts, records transitions, and writes the snapshot on unload', async () => {
  const { apply } = require('../lib/index.js');
  // dsh-tools is not installed in this repo, so registration must degrade
  // gracefully — unless resolvable, in which case registeredTool is set.
  const dispose = await new Promise((resolve) => {
    const origEffect = ctx.effect;
    ctx.effect = (execute, label) => {
      const d = origEffect.call(ctx, execute, label);
      resolve(d);
      return d;
    };
    apply(ctx);
    ctx.effect = origEffect;
  });

  assert.ok(statusListener, 'internal/status listener registered');
  assert.ok(assembleListener, 'system-prompt/assemble listener registered');
  statusListener(makeFiber('Broken', 3)); // one FAILED transition
  // Simulate one prompt assembly flowing through the waterfall unmodified.
  const assembly = {
    sections: [
      { name: 'deployment:persona', text: 'x'.repeat(400) },
      { name: 'skills', text: 'y'.repeat(200) },
    ],
  };
  const passedThrough = await assembleListener(assembly, {}, async () => assembly);
  assert.equal(passedThrough, assembly, 'assembly returned unmodified');
  dispose(); // unload → flushes the final snapshot synchronously

  const file = path.join(home, 'xray', 'runtime.json');
  assert.ok(fs.existsSync(file), 'runtime.json written');
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(snap.schema, 'dsh-xray/runtime@1');
  assert.equal(snap.plugins.length, 3);
  assert.equal(snap.plugins.find((p) => p.name === 'Broken').fibers[0].state, 'FAILED');
  assert.deepEqual(snap.transitions.Broken, [
    { state: 'FAILED', at: snap.transitions.Broken[0].at },
  ]);
  assert.ok(snap.services.some((s) => s.name === 'tools' && s.provider === 'ToolRuntime'));
  assert.equal(snap.tools[0].name, 'read_file');
  assert.equal(snap.promptAssembly.sections[0].name, 'deployment:persona');
  assert.equal(snap.promptAssembly.sections[0].tokens, 100); // 400 chars / 4
});

test('xray_composition execute returns every view from live ctx data', async (t) => {
  if (!registeredTool) {
    // dsh-tools not resolvable outside a dsh home — the degradation branch
    // itself is the behavior under test then.
    t.skip('dsh-tools not resolvable; degradation branch exercised instead');
    return;
  }
  assert.equal(registeredTool.name, 'xray_composition');

  const summary = await registeredTool.execute({});
  assert.equal(summary.plugins, 3);
  assert.equal(summary.unhealthy, 1);
  assert.ok(summary.toolSchemaTokens > 0);

  const deps = await registeredTool.execute({ view: 'deps' });
  assert.deepEqual(deps.services.tools.consumers, ['AgentLoop']);
  assert.deepEqual(deps.cascade.ToolRuntime, ['AgentLoop']);

  const health = await registeredTool.execute({ view: 'health' });
  assert.equal(health.unhealthy[0].name, 'Broken');

  const cost = await registeredTool.execute({ view: 'cost' });
  assert.equal(cost.tools[0].name, 'read_file');

  const shadow = await registeredTool.execute({ view: 'shadow' });
  assert.ok(Array.isArray(shadow.services));
});
