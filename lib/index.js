const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { snapshotRegistry, stateName } = require('./collect/runtime.js');
const { serviceGraph, health } = require('./model.js');

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

  let timer = null;
  const writeSnapshot = () => {
    timer = null;
    try {
      const snap = snapshotRegistry(ctx);
      snap.transitions = Object.fromEntries(transitions);
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
    schedule(); // initial snapshot
    return [
      disposeStatus,
      () => {
        clearTimeout(timer);
        writeSnapshot(); // final state on unload
      },
    ];
  }, 'xray-runtime-snapshot');

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
            'do I have / what plugin provides X / why is Y unavailable".',
          parameters: {
            view: {
              type: 'string',
              description: 'summary | deps | health (default summary)',
            },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
          },
          async execute(args) {
            const snap = snapshotRegistry(ctx);
            snap.transitions = Object.fromEntries(transitions);
            if (args.view === 'deps') return serviceGraph(snap);
            if (args.view === 'health') return health(snap);
            return {
              plugins: snap.plugins.length,
              unhealthy: health(snap).unhealthy.length,
              services: Object.keys(serviceGraph(snap).services).length,
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
