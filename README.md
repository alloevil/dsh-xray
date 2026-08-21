# dsh-xray

[![npm](https://img.shields.io/npm/v/dsh-xray)](https://www.npmjs.com/package/dsh-xray)
[![CI](https://github.com/alloevil/dsh-xray/actions/workflows/check.yml/badge.svg)](https://github.com/alloevil/dsh-xray/actions/workflows/check.yml)
[![license](https://img.shields.io/npm/l/dsh-xray)](./LICENSE)

X-ray for your [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — see what's actually loaded, why, and what it costs you.

![dsh-xray demo](./docs/demo.svg)

[中文](./README.zh.md)

> **Status: 0.2.x — static + runtime imaging.** Static commands work even when dsh cannot boot; `deps`/`health` and the agent tool need the plugin mounted.

`dsh --dump-config` shows you the composed tree. The plugin panel shows you a flat list. Neither tells you *why* a plugin is there, *what breaks* if you disable it, or *what it silently costs you*. dsh-xray does.

## CLI

```sh
npx dsh-xray attribute   # which layer introduced each row, and who patched it since
npx dsh-xray conflicts   # rows whose fields have multiple writers, and who wins
npx dsh-xray diff        # declared (static layers) vs actual (dump-config) tree
npx dsh-xray snapshot    # content-addressed lockfile of the effective composition
npx dsh-xray deps [svc]  # service dependency graph: providers, consumers, disable-cascade
npx dsh-xray health      # plugin lifecycle health: failed fibers, pending injects, transitions
npx dsh-xray cost        # estimated context-token cost per model-facing tool schema
npx dsh-xray shadow      # services provided by multiple plugins
npx dsh-xray audit       # static scan of out-of-tree plugins for sensitive touchpoints
```

All commands take `--profile <name>` (default `web`) and `--json`. `diff` exits `1` when the trees disagree; `health` exits `1` when any plugin is unhealthy. `attribute`, `conflicts`, and `snapshot` are fully static: they work even when dsh cannot start. `deps` and `health` read the runtime snapshot the mounted plugin maintains at `$DSH_HOME/xray/runtime.json`.

## What it looks like

Every row of the booted tree, attributed to the layer that introduced it — and who patched it since:

```console
$ npx dsh-xray attribute
# 130 rows in profile "web"

timer                        @deepseek-ai/dsh-base
hmr                          @deepseek-ai/dsh-base    ← patched by @deepseek-ai/dsh-web-app [disabled]
llm                          @deepseek-ai/dsh-base
session-query-sqlite         @deepseek-ai/dsh-base    ← patched by @deepseek-ai/dsh-web-app
...
```

What breaks if you disable a provider — computed from the live service store, not guesses:

```console
$ npx dsh-xray deps
# disable-cascade (transitive consumers of each provider):
  Loader → 5 plugin(s): AgentPresets, ClientModuleRegistry, Hmr, Include, PluginInventoryGateway
  TimerService → 1 plugin(s): Hmr
  SessionProjectionRegistry → 1 plugin(s): SessionProjectionCache
```

Which fields have multiple writers, and who silently wins:

```console
$ npx dsh-xray conflicts
session-query-sqlite
  .config: @deepseek-ai/dsh-base → @deepseek-ai/dsh-web-app  (winner: @deepseek-ai/dsh-web-app)
tool-bash
  .disabled: @deepseek-ai/dsh-base → @deepseek-ai/dsh-web-app  (winner: @deepseek-ai/dsh-web-app)
```

What every request actually carries — prompt sections observed at assembly, blended with tool schemas:

```console
$ npx dsh-xray cost
~1625 tokens: 1 tool schema(s) ~121 + 19 prompt section(s) ~1504

# prompt sections (observed at last assembly):
app:web-surface                  ~248     15.3%   ████████
tool:goal                        ~184     11.3%   ██████
tool:ralph                       ~109     6.7%    ███
harness:source                   ~94      5.8%    ███
...
```

And when a patch row targets an id that doesn't exist (dsh skips it silently), `diff` catches it:

```console
$ npx dsh-xray diff
orphan overrides (silently skipped) (1)
  no-such-row in ~/.dsh/profiles/web/cordis.patch.yml
```

## Agent tool

Mounted in the tree, dsh-xray registers an `xray_composition` tool (`view: summary | deps | health | cost | shadow`), so an agent can answer "what capabilities do I have / what plugin provides X / why is Y unavailable" about itself.

## Safety stance

dsh-xray reads; it never runs. Loader `!!js` expressions in patch files are parsed as opaque markers and never evaluated, the CLI never executes plugin code (`audit` is a pattern scan over source text), and the mounted plugin writes only under `$DSH_HOME/xray/`. See [SECURITY.md](./SECURITY.md).

## Capabilities

Diagnostic imaging for a running composition — complementary to [dsh-doctor](https://www.npmjs.com/package/dsh-doctor) (rescue & recovery).

Shipped in 0.3.x:

- **Layer attribution** — which layer introduced each active plugin: kernel bundle, profile dependency, `cordis.patch.yml` insert, or repository source
- **Declared vs. actual diff** — installed-but-inactive, uninstalled-but-lingering patch rows
- **Conflict detection** — plugins patching the same config row, and which one silently wins
- **Composition snapshot** — export the effective composition as a lockfile; reproduce it elsewhere
- **Service dependency graph** — who provides and consumes each service; what cascades if you disable X (`deps`)
- **Runtime health** — per-plugin fiber lifecycle state, startup failures, transition history (`health`)
- **Agent self-introspection** — the `xray_composition` tool lets agents inspect their own capability set

- **Capability audit** — heuristic static scan of out-of-tree plugins: network egress, shell, filesystem, env, eval (`audit`)
- **Service shadowing** — services claimed by multiple plugins, per-plugin tool/command registrations (`shadow`)
- **Context cost** — estimated tokens each model-facing tool schema occupies (`cost`)

## Install

```sh
dsh plugin --profile web add dsh-xray
```

## License

MIT
