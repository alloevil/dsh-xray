# Security Policy

## Supported versions

Only the latest minor release receives fixes.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/alloevil/dsh-xray/security/advisories/new).
Do not open a public issue for security reports.

## Scope notes

- dsh-xray is a **diagnostic** tool. The `audit` command is a heuristic
  pattern scan: a flag means "this pattern appears in shipped code", never
  "this plugin is safe" — absence of findings is not a clearance.
- The collectors parse YAML with `!!js` loader expressions as opaque,
  never-evaluated markers, and the CLI never executes plugin code.
- The mounted plugin writes only under `$DSH_HOME/xray/` and registers one
  read-only tool; it takes no network, shell, or session access.
- The `/xray/api/entry` endpoint returns composition-layer text only — the
  prompt sections and tool schemas plugins contribute to every request,
  computed live per request and never persisted. It never returns session
  messages or any user conversation content.
