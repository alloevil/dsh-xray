// Attribution: name -> registering plugin, reconstructed by diffing the
// registry name-set against fiber effect counts across change events.
// Integration-tested against the REAL cordis + dsh-system-prompt + dsh-tools
// from the machine's profile closure; skipped where that closure is absent.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { installSectionAttribution, labeledEffectCount } = require('../lib/collect/attribution.js');

const CLOSURE = path.join(os.homedir(), '.dsh', 'profiles', 'node_modules');
const hasClosure = fs.existsSync(path.join(CLOSURE, '@deepseek-ai', 'cordis'));

// -- unit: labeledEffectCount ---------------------------------------------

test('labeledEffectCount counts nested labeled effects, capped by depth', () => {
  const fiber = {
    getEffects: () => [
      { label: 'systemPrompt.section()', children: [] },
      {
        label: 'outer',
        children: [{ label: 'systemPrompt.section()', children: [] }],
      },
      { label: 'tools.register()', children: [] },
    ],
  };
  assert.equal(labeledEffectCount(fiber, 'systemPrompt.section()'), 2);
  assert.equal(labeledEffectCount(fiber, 'tools.register()'), 1);
});

test('labeledEffectCount survives a throwing fiber', () => {
  assert.equal(
    labeledEffectCount(
      {
        getEffects: () => {
          throw new Error('gone');
        },
      },
      'x',
    ),
    0,
  );
});

// -- unit: baseline affinity ------------------------------------------------

test('baseline affinity reconciles names to pre-mounted fibers', () => {
  const { installAttribution } = require('../lib/collect/attribution.js');
  const SECTION = 'systemPrompt.section()';
  const mkFiber = (name, count) => ({
    entry: { options: { name } },
    getEffects: () => Array.from({ length: count }, () => ({ label: SECTION, children: [] })),
  });
  // three fibers, all mounted BEFORE observation starts
  const fibers = [mkFiber('tool-goal', 1), mkFiber('tool-fs-search', 2), mkFiber('persona', 1)];
  const names = new Set(['tool:goal', 'tool:glob', 'tool:grep', 'deployment:persona']);
  const ctx = {
    registry: { values: () => [{ fibers }] },
    on: () => () => {},
    get: () => null,
  };
  const { table, dispose } = installAttribution(ctx, {
    event: 'x/change',
    effectLabel: SECTION,
    names: () => names,
  });
  assert.equal(table.get('tool:goal'), 'tool-goal');
  assert.equal(table.get('deployment:persona'), 'persona');
  // fs-search carries 2 effects; glob+grep don't stem-match "fs-search",
  // so they stay unattributed rather than being guessed.
  assert.equal(table.get('tool:glob'), null);
  assert.equal(table.get('tool:grep'), null);
  dispose();
});

test('baseline affinity refuses a fiber whose claim count does not reconcile', () => {
  const { installAttribution } = require('../lib/collect/attribution.js');
  const SECTION = 'systemPrompt.section()';
  // "tool-web" matches one name by affinity but carries 2 effects: refuse.
  const fiber = {
    entry: { options: { name: 'tool-web' } },
    getEffects: () => [
      { label: SECTION, children: [] },
      { label: SECTION, children: [] },
    ],
  };
  const fiber2 = {
    entry: { options: { name: 'unrelated' } },
    getEffects: () => [{ label: SECTION, children: [] }],
  };
  const ctx = {
    registry: { values: () => [{ fibers: [fiber, fiber2] }] },
    on: () => () => {},
    get: () => null,
  };
  const { table, dispose } = installAttribution(ctx, {
    event: 'x/change',
    effectLabel: SECTION,
    names: () => new Set(['tool:web']),
  });
  assert.equal(table.get('tool:web'), null);
  dispose();
});

// -- integration: real registries -----------------------------------------

test('sections and tools attribute to their registering plugins', {
  skip: !hasClosure,
}, async () => {
  const { Context } = await import(path.join(CLOSURE, '@deepseek-ai/cordis/lib/index.js'));
  const sp = await import(path.join(CLOSURE, '@deepseek-ai/dsh-system-prompt/lib/index.js'));

  const root = new Context();
  root.plugin(sp.default ?? sp);
  await new Promise((r) => setTimeout(r, 20));

  // Install the observer BEFORE the plugins under test mount, as xray does
  // for everything that loads after it.
  const attribution = installSectionAttribution(root);

  root.plugin({
    name: 'plugin-alpha',
    inject: ['systemPrompt'],
    apply: (ctx) => {
      ctx.systemPrompt.section({ name: 'tool:alpha', order: 10, text: 'alpha' });
    },
  });
  root.plugin({
    name: 'plugin-beta',
    inject: ['systemPrompt'],
    apply: (ctx) => {
      ctx.systemPrompt.section({ name: 'app:beta', order: 20, text: 'beta' });
      ctx.systemPrompt.section({ name: 'app:beta2', order: 21, text: 'beta2' });
    },
  });
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(attribution.table.get('tool:alpha'), 'plugin-alpha');
  assert.equal(attribution.table.get('app:beta'), 'plugin-beta');
  assert.equal(attribution.table.get('app:beta2'), 'plugin-beta');
  attribution.dispose();
});

test('a disposed registration leaves the table', { skip: !hasClosure }, async () => {
  const { Context } = await import(path.join(CLOSURE, '@deepseek-ai/cordis/lib/index.js'));
  const sp = await import(path.join(CLOSURE, '@deepseek-ai/dsh-system-prompt/lib/index.js'));

  const root = new Context();
  root.plugin(sp.default ?? sp);
  await new Promise((r) => setTimeout(r, 20));
  const attribution = installSectionAttribution(root);

  const fiber = root.plugin({
    name: 'plugin-gamma',
    inject: ['systemPrompt'],
    apply: (ctx) => {
      ctx.systemPrompt.section({ name: 'tool:gamma', order: 30, text: 'gamma' });
    },
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(attribution.table.get('tool:gamma'), 'plugin-gamma');

  await fiber.dispose();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(attribution.table.has('tool:gamma'), false);
  attribution.dispose();
});

// -- model join ------------------------------------------------------------

test('contextCost joins owners and rolls up per plugin', () => {
  const { contextCost } = require('../lib/model.js');
  const snap = {
    capturedAt: 'now',
    tools: [
      { name: 'get_goal', tokens: 100 },
      { name: 'mystery', tokens: 50 },
    ],
    promptAssembly: {
      at: 1,
      sections: [
        { name: 'tool:goal', tokens: 200 },
        { name: 'app:web-surface', tokens: 150 },
      ],
    },
    sectionOwners: { 'tool:goal': 'dsh-tool-goal', 'app:web-surface': 'dsh-web-app' },
    toolOwners: { get_goal: 'dsh-tool-goal' },
  };
  const out = contextCost(snap);
  const bySection = Object.fromEntries(out.sections.map((s) => [s.name, s.owner]));
  assert.equal(bySection['tool:goal'], 'dsh-tool-goal');
  assert.equal(bySection['app:web-surface'], 'dsh-web-app');
  const byTool = Object.fromEntries(out.tools.map((t) => [t.name, t.owner]));
  assert.equal(byTool.get_goal, 'dsh-tool-goal');
  assert.equal(byTool.mystery, null);

  const rollup = Object.fromEntries(out.owners.map((o) => [o.plugin, o]));
  assert.equal(rollup['dsh-tool-goal'].tokens, 300); // 200 section + 100 tool
  assert.equal(rollup['dsh-tool-goal'].sections, 1);
  assert.equal(rollup['dsh-tool-goal'].tools, 1);
  assert.equal(rollup['dsh-web-app'].tokens, 150);
  assert.equal(rollup.unattributed.tokens, 50); // the mystery tool
  // sorted by tokens desc
  assert.equal(out.owners[0].plugin, 'dsh-tool-goal');
});

// -- entry inspection --------------------------------------------------------

test('snapshotEntry reads a live section and a live tool, misses cleanly', () => {
  const { snapshotEntry } = require('../lib/collect/runtime.js');
  const ctx = {
    get: (name) => {
      if (name === 'systemPrompt')
        return {
          layers: {
            global: {
              sections: new Map([
                ['tool:goal', { name: 'tool:goal', order: 1, text: 'goal guidance text' }],
              ]),
            },
            scoped: new Map(),
          },
        };
      if (name === 'tools')
        return {
          layers: {
            global: { tools: new Map() },
            scoped: new Map([
              [
                'scope-a',
                {
                  tools: new Map([
                    [
                      'get_goal',
                      { name: 'get_goal', description: 'reads the goal', parameters: {} },
                    ],
                  ]),
                },
              ],
            ]),
          },
        };
      return null;
    },
  };
  const section = snapshotEntry(ctx, 'section', 'tool:goal');
  assert.equal(section.text, 'goal guidance text');
  assert.ok(section.tokens > 0);
  assert.equal(section.estimator, '~4 chars/token');
  const tool = snapshotEntry(ctx, 'tool', 'get_goal'); // found in a scoped layer
  assert.ok(tool.text.includes('reads the goal'));
  assert.equal(snapshotEntry(ctx, 'section', 'no-such'), null);
  assert.equal(snapshotEntry(ctx, 'bogus', 'x'), null);
});

test('snapshotEntry resolves a function-valued section text', () => {
  const { snapshotEntry } = require('../lib/collect/runtime.js');
  const ctx = {
    get: (name) =>
      name === 'systemPrompt'
        ? {
            layers: {
              global: {
                sections: new Map([['dyn', { name: 'dyn', order: 1, text: () => 'computed' }]]),
              },
              scoped: new Map(),
            },
          }
        : null,
  };
  assert.equal(snapshotEntry(ctx, 'section', 'dyn').text, 'computed');
});
