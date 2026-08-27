const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  snapshotRegistry,
  snapshotEntry,
  stateName,
  estimateTokens,
} = require('./collect/runtime.js');
const { installSectionAttribution } = require('./collect/attribution.js');
const { serviceGraph, health, shadowing, contextCost } = require('./model.js');

const name = 'dsh-xray';

function xrayDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'xray');
}

/**
 * dsh-xray — X-ray for your DeepSeek Harness.
 *
 * Mounted in the tree, this plugin:
 * 1. writes a runtime snapshot to $DSH_HOME/xray/runtime.json (throttled,
 *    refreshed on every fiber status change) for the CLI to read;
 * 2. counts status transitions and HMR updates per plugin;
 * 3. registers an `xray_composition` tool when `ctx.tools` is available,
 *    so agents can introspect their own capability set.
 */
function apply(ctx) {
  const logger = ctx.logger(name);
  const dir = xrayDir();
  const file = path.join(dir, 'runtime.json');
  const transitions = new Map(); // plugin name -> [{state, at}] ring buffer
  let lastAssembly = null; // latest system-prompt assembly observation
  let attribution = null; // section name -> plugin name (live table)

  let timer = null;
  const writeSnapshot = () => {
    timer = null;
    try {
      const snap = snapshotRegistry(ctx);
      snap.transitions = Object.fromEntries(transitions);
      snap.promptAssembly = lastAssembly;
      snap.sectionOwners = attribution ? Object.fromEntries(attribution.table) : {};
      snap.toolOwners = attribution ? Object.fromEntries(attribution.toolTable) : {};
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(snap, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      logger.warn(`snapshot write failed: ${err.message}`);
    }
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(writeSnapshot, 1000);
  };

  ctx.effect(() => {
    // internal/status fires on every fiber lifecycle transition.
    const disposeStatus = ctx.on('internal/status', (fiber) => {
      try {
        const key = fiber.name ?? 'unknown';
        if (!transitions.has(key)) transitions.set(key, []);
        const log = transitions.get(key);
        log.push({ state: stateName(fiber.state), at: Date.now() });
        if (log.length > 20) log.shift();
      } catch {
        /* never break the host on a diagnostic path */
      }
      schedule();
    });
    // system-prompt/assemble is an expert waterfall: delegate via next(),
    // then observe the final assembly. Purely observational — the assembly
    // is returned unmodified.
    const disposeAssemble = ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
      const result = await next();
      try {
        lastAssembly = {
          at: Date.now(),
          sections: (result?.sections ?? []).map((s) => ({
            name: s.name,
            tokens: estimateTokens(s.text ?? ''),
          })),
        };
      } catch {
        /* observation must never break assembly */
      }
      schedule();
      return result;
    });
    schedule(); // initial snapshot
    // Section attribution: diff-based name->plugin table over
    // system-prompt/change (see collect/attribution.js for the strategy).
    attribution = installSectionAttribution(ctx);
    return [
      disposeStatus,
      disposeAssemble,
      () => {
        attribution.dispose();
        attribution = null;
      },
      () => {
        clearTimeout(timer);
        writeSnapshot(); // final state on unload
      },
    ];
  }, 'xray-runtime-snapshot');

  // Web panel: mounts when the profile composes a webServer (dsh web).
  // Headless profiles simply never activate this subplugin.
  ctx.plugin({
    name: 'dsh-xray-panel',
    inject: ['webServer'],
    apply: (wctx) => {
      const { mountPanel } = require('./panel.js');
      const freshSnap = () => {
        const snap = snapshotRegistry(ctx);
        snap.transitions = Object.fromEntries(transitions);
        snap.promptAssembly = lastAssembly;
        snap.sectionOwners = attribution ? Object.fromEntries(attribution.table) : {};
        snap.toolOwners = attribution ? Object.fromEntries(attribution.toolTable) : {};
        return snap;
      };
      wctx.effect(
        () =>
          mountPanel(
            wctx.webServer,
            {
              summary: () => {
                const snap = freshSnap();
                return {
                  plugins: snap.plugins.length,
                  unhealthy: health(snap).unhealthy.length,
                  services: Object.keys(serviceGraph(snap).services).length,
                  toolSchemaTokens: contextCost(snap).totalTokens,
                  capturedAt: snap.capturedAt,
                };
              },
              deps: () => serviceGraph(freshSnap()),
              health: () => health(freshSnap()),
              cost: () => contextCost(freshSnap()),
              shadow: () => shadowing(freshSnap()),
            },
            // Entry text is computed per request from the live registries and
            // never persisted — the audit answer to "what exactly is ~N tokens?".
            (kind, entryName) => snapshotEntry(ctx, kind, entryName),
          ),
        'xray-panel-routes',
      );
      logger.info('xray panel mounted at /xray');
    },
  });

  // Agent self-introspection tool: only when a tool registry exists
  // (headless/web both have one; keep it optional so xray mounts anywhere).
  ctx.plugin({
    name: 'dsh-xray-tool',
    inject: ['tools'],
    apply: (tctx) => {
      // Resolve dsh-tools through the profile's flat closure too: a `link:`
      // installed plugin cannot see $DSH_HOME/profiles/node_modules from its
      // own directory (the documented dual-anchor rule covers loader mounting,
      // not require() from inside the plugin).
      let defineTool;
      try {
        const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
        const resolved = require.resolve('@deepseek-ai/dsh-tools', {
          paths: [__dirname, path.join(home, 'profiles')],
        });
        ({ defineTool } = require(resolved));
      } catch {
        logger.info('dsh-tools not resolvable; xray_composition tool not registered');
        return;
      }
      tctx.tools.register(
        defineTool({
          name: 'xray_composition',
          description:
            'Introspect the live plugin composition of this harness: every mounted plugin, ' +
            'the services it requires (inject) and provides, its lifecycle state, and ' +
            'unhealthy plugins with their last transitions. Use to answer "what capabilities ' +
            'do I have / what plugin provides X / why is Y unavailable". A human-browsable ' +
            'panel with the same data is served at /xray on this harness.',
          parameters: {
            view: {
              type: 'string',
              description: 'summary | deps | health | cost | shadow (default summary)',
            },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
          },
          async execute(args) {
            const snap = snapshotRegistry(ctx);
            snap.transitions = Object.fromEntries(transitions);
            snap.promptAssembly = lastAssembly;
            snap.sectionOwners = attribution ? Object.fromEntries(attribution.table) : {};
            snap.toolOwners = attribution ? Object.fromEntries(attribution.toolTable) : {};
            if (args.view === 'deps') return serviceGraph(snap);
            if (args.view === 'health') return health(snap);
            if (args.view === 'cost') return contextCost(snap);
            if (args.view === 'shadow') return shadowing(snap);
            return {
              plugins: snap.plugins.length,
              unhealthy: health(snap).unhealthy.length,
              services: Object.keys(serviceGraph(snap).services).length,
              toolSchemaTokens: contextCost(snap).totalTokens,
              capturedAt: snap.capturedAt,
            };
          },
        }),
      );
    },
  });
}

module.exports = { name, apply, xrayDir };
module.exports.default = module.exports;
