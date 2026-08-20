# dsh-xray

X-ray for your [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — see what's actually loaded, why, and what it costs you.

[中文](./README.zh.md)

> **Status: 0.1.x — static imaging.** The CLI works today, even when dsh cannot boot. Runtime imaging (dependency graph, health, context cost) lands in 0.2.0.

`dsh --dump-config` shows you the composed tree. The plugin panel shows you a flat list. Neither tells you *why* a plugin is there, *what breaks* if you disable it, or *what it silently costs you*. dsh-xray does.

## CLI

```sh
npx dsh-xray attribute   # which layer introduced each row, and who patched it since
npx dsh-xray conflicts   # rows whose fields have multiple writers, and who wins
npx dsh-xray diff        # declared (static layers) vs actual (dump-config) tree
npx dsh-xray snapshot    # content-addressed lockfile of the effective composition
```

All commands take `--profile <name>` (default `web`) and `--json`. `diff` exits `1` when the trees disagree — orphan patch rows silently skipped by dsh, installed-but-inactive plugins, disabled-state mismatches. `attribute`, `conflicts`, and `snapshot` are fully static: they work even when dsh cannot start.

## Capabilities

Diagnostic imaging for a running composition — complementary to [dsh-doctor](https://www.npmjs.com/package/dsh-doctor) (rescue & recovery).

Shipped in 0.1.x:

- **Layer attribution** — which layer introduced each active plugin: kernel bundle, profile dependency, `cordis.patch.yml` insert, or repository source
- **Declared vs. actual diff** — installed-but-inactive, uninstalled-but-lingering patch rows
- **Conflict detection** — plugins patching the same config row, and which one silently wins
- **Composition snapshot** — export the effective composition as a lockfile; reproduce it elsewhere

Planned:

- **Service dependency graph** — who `inject`s whose service; what cascades if you disable X
- **Runtime health** — per-plugin scope state: activation failures, stacks, load time, HMR reloads
- **Capability audit** — what installed plugins actually touch: network egress, shell, filesystem, env; permission diff across updates
- **Command/tool shadowing** — plugins registering the same command/tool, and which one silently wins
- **Context cost** — tokens each plugin injects into agent context: tool schemas, prompt sections, skills
- **Agent self-introspection** — expose the composition as a tool so agents know what capabilities they have

## Install

```sh
dsh plugin --profile web add dsh-xray
```

## License

MIT
