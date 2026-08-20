# Changelog

## 0.3.0 — 2026-08-20

- `audit`: heuristic static scan of out-of-tree plugins for sensitive
  touchpoints — network egress, subprocess/shell, filesystem, environment
  variables, dynamic evaluation. Kernel `@deepseek-ai/*` bundles are the
  trusted baseline and are not scanned.
- `cost`: estimated context-token footprint per model-facing tool schema,
  sorted with shares.
- `shadow`: services claimed by more than one plugin (legal under isolation
  scopes, and invisible without this), plus per-plugin registration counts.
  Exits 1 when a multi-provider service exists.
- `xray_composition` gains `cost` and `shadow` views; summary now includes
  `toolSchemaTokens`.

## 0.2.0 — 2026-08-20

- Runtime imaging: the mounted plugin maintains `$DSH_HOME/xray/runtime.json`
  (1s-throttled, atomically replaced, refreshed on every `internal/status`
  transition and flushed on unload).
- `deps`: service dependency graph — providers from the reflect store (Impl
  records), consumers from `inject` declarations, transitive disable-cascade,
  unsatisfied injects.
- `health`: per-fiber lifecycle state (PENDING/LOADING/ACTIVE/FAILED named
  from the Cordis enum), startup errors, transition history. Exits 1 on any
  unhealthy plugin.
- `xray_composition` agent tool (views: summary/deps/health): agents can
  introspect their own capability set.

## 0.1.2 — 2026-08-20

- Link the npm package to the GitHub repository (repository/homepage/bugs).

## 0.1.1 — 2026-08-20

- README rewritten for the shipped feature set (0.1.0's tarball still carried
  the name-reservation copy).

## 0.1.0 — 2026-08-20

- Static composition imaging, working even when dsh cannot boot:
  - `attribute`: which layer introduced each row; who patched it since.
  - `conflicts`: fields with multiple writers; last writer wins.
  - `diff`: declared (static layer replay) vs actual (`--dump-config`) tree —
    orphan overrides dsh silently skips, installed-but-inactive packages,
    disabled-state mismatches. Exits 1 on disagreement.
  - `snapshot`: content-addressed lockfile of the effective composition.
- `!!js` loader expressions are parsed as opaque markers, never evaluated.

## 0.0.1 — 2026-08-20

- Name reservation; no-op plugin mount.
