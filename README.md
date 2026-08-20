# dsh-xray

X-ray for your [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — see what's actually loaded, why, and what it costs you.

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
```

All commands take `--profile <name>` (default `web`) and `--json`. `diff` exits `1` when the trees disagree; `health` exits `1` when any plugin is unhealthy. `attribute`, `conflicts`, and `snapshot` are fully static: they work even when dsh cannot start. `deps` and `health` read the runtime snapshot the mounted plugin maintains at `$DSH_HOME/xray/runtime.json`.

## Agent tool

Mounted in the tree, dsh-xray registers an `xray_composition` tool (`view: summary | deps | health`), so an agent can answer "what capabilities do I have / what plugin provides X / why is Y unavailable" about itself.

## Capabilities

Diagnostic imaging for a running composition — complementary to [dsh-doctor](https://www.npmjs.com/package/dsh-doctor) (rescue & recovery).

Shipped in 0.2.x:

- **Layer attribution** — which layer introduced each active plugin: kernel bundle, profile dependency, `cordis.patch.yml` insert, or repository source
- **Declared vs. actual diff** — installed-but-inactive, uninstalled-but-lingering patch rows
- **Conflict detection** — plugins patching the same config row, and which one silently wins
- **Composition snapshot** — export the effective composition as a lockfile; reproduce it elsewhere
- **Service dependency graph** — who provides and consumes each service; what cascades if you disable X (`deps`)
- **Runtime health** — per-plugin fiber lifecycle state, startup failures, transition history (`health`)
- **Agent self-introspection** — the `xray_composition` tool lets agents inspect their own capability set

Planned:

- **Capability audit** — what installed plugins actually touch: network egress, shell, filesystem, env; permission diff across updates
- **Command/tool shadowing** — plugins registering the same command/tool, and which one silently wins
- **Context cost** — tokens each plugin injects into agent context: tool schemas, prompt sections, skills

## Install

```sh
dsh plugin --profile web add dsh-xray
```

## License

MIT
