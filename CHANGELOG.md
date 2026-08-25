# Changelog

## 0.7.0 — 2026-08-25

- Client half (`dsh.client` declaration + `exports["./client"]`): the host
  discovers the bundle automatically and mounts an **X-ray tab beside
  Chat / Trajectory** in every session — the five views rendered natively
  in the GUI with host design tokens. Thin renderer over the existing
  `/xray/api/*` endpoints; all computation stays in `lib/model.js`.
- The tab survives what it diagnoses: a view switch renders the stale
  payload as loading instead of throwing (React unmounts a throwing
  subtree — the original "tab disappears on click" bug), and each view
  renderer is wrapped so one bad payload reports inline instead of taking
  the panel down.
- The standalone `/xray` page stays as the degradation path: it needs only
  the web server, not the client-module pipeline it helps diagnose.

## 0.6.0 — 2026-08-21

- Web panel at `/xray` (mounted when the profile composes a webServer):
  summary, health, deps with the disable-cascade table, cost, and shadow
  views, live per request from the running composition. Zero dependencies —
  one self-contained HTML page plus `/xray/api/*` JSON endpoints; no React,
  no client bundle, no build step. Headless profiles skip it silently.

## 0.5.0 — 2026-08-21

- `snapshot --against <lockfile>`: compare the current composition against a
  saved snapshot — bundle version/patch drift, patch-layer content changes,
  package add/remove/version, composed-tree hash. Exits 1 on drift.
- Repository-source attribution: `.dsh-plugin` directories under the harness
  home are collected as a fourth layer kind (`repository`), so rows they
  insert attribute to the repository plugin that owns them.
- Validated end-to-end with a live model: an agent called `xray_composition`
  in a real conversation and reported the composition summary.

## 0.4.1 — 2026-08-21

- Ship `assets/` (README hero and section headers) in the npm tarball so the
  package page renders them; no code change.

## 0.4.0 — 2026-08-21

- `cost` now attributes **prompt sections**: the mounted plugin observes the
  `system-prompt/assemble` waterfall (purely — the assembly passes through
  unmodified) and records per-section token estimates alongside tool schemas.
  Output separates section vs schema totals; empty state explains that one
  agent message is needed before sections appear.
- `xray_composition` summary and `cost` view carry the blended totals.
- README: terminal demo image plus real `cost` output.

## 0.3.2 — 2026-08-20

- README: real-output demo sections for `attribute`/`deps`/`conflicts`/`diff`;
  npm keywords extended for directory-site discovery. No code change.

## 0.3.1 — 2026-08-20

- Tests: plugin integration suite (mock Cordis ctx exercising apply, snapshot
  write, status transitions, and every `xray_composition` view) and a
  skippable real-dsh e2e suite driving the CLI binary.
- Repo: changelog, security policy, tag-driven release workflow with npm
  provenance, SHA-pinned actions, dependabot, badges, `packageManager` pin.
- No library behavior change.

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
