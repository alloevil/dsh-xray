#!/usr/bin/env node

// dsh-xray CLI. Static analysis works even when dsh cannot boot;
// commands needing the composed tree degrade with a clear notice.

const { collectStatic } = require('../lib/collect/static.js');
const { collectDump } = require('../lib/collect/dump.js');
const model = require('../lib/model.js');

function parseArgs(argv) {
  const args = { _: [], profile: 'web', json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile' || a === '-p') args.profile = argv[++i];
    else if (a === '--against') args.against = argv[++i];
    else if (a === '--plugin') args.plugin = argv[++i];
    else if (a === '--json') args.json = true;
    else args._.push(a);
  }
  return args;
}

function tryDump(profile) {
  try {
    return { dump: collectDump(profile), error: null };
  } catch (err) {
    return {
      dump: null,
      error: `dump-config unavailable (${err.message.split('\n')[0]}); static-only mode`,
    };
  }
}

const pad = (s, n) => String(s ?? '').padEnd(n);

function cmdAttribute(args) {
  const data = collectStatic(args.profile);
  const result = model.attribute(data);
  if (args.json) return console.log(JSON.stringify(result, null, 2));

  console.log(`# ${result.rows.length} rows in profile "${args.profile}"\n`);
  for (const row of result.rows) {
    const flags = row.disabled ? ' [disabled]' : '';
    const over = row.overrides.length
      ? `  ← patched by ${row.overrides.map((o) => o.layer).join(', ')}`
      : '';
    console.log(`${pad(row.id, 28)} ${pad(row.origin?.layer, 32)}${over}${flags}`);
  }
  if (result.orphans.length) {
    console.log(
      `\n! ${result.orphans.length} orphan override(s) targeting nonexistent rows (dsh warns and skips them):`,
    );
    for (const o of result.orphans) console.log(`  ${o.id}  in ${o.file}`);
  }
  for (const w of result.warnings) console.log(`! ${w}`);
}

function cmdConflicts(args) {
  const data = collectStatic(args.profile);
  const result = model.conflicts(data);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  if (!result.conflicts.length)
    return console.log('no contested rows: every field has a single writer');
  const path = require('node:path');
  const show = (v) => {
    const s = JSON.stringify(v) ?? '(unset)';
    return s.length > 48 ? `${s.slice(0, 45)}…` : s;
  };
  for (const c of result.conflicts) {
    console.log(`${c.id}`);
    for (const f of c.fields) {
      console.log(`  .${f.field} — winner: ${f.winner} (last writer wins)`);
      for (const w of f.writers) {
        const loc = w.file
          ? `  ${path.relative(data.home, w.file)}${w.line ? `:${w.line}` : ''}`
          : '';
        console.log(`    ${pad(w.layer, 24)} ${pad(w.action, 9)} ${pad(show(w.value), 48)}${loc}`);
      }
      console.log(`    effective: ${show(f.effective)}`);
    }
  }
}

function cmdDiff(args) {
  const data = collectStatic(args.profile);
  const { dump, error } = tryDump(args.profile);
  if (error) {
    console.error(`! ${error}`);
    process.exitCode = 1;
    return;
  }
  const result = model.diff(data, dump);
  if (args.json) return console.log(JSON.stringify(result, null, 2));

  const section = (title, items, fmt) => {
    if (!items.length) return;
    console.log(`\n${title} (${items.length})`);
    for (const it of items) console.log(`  ${fmt(it)}`);
  };
  section('declared but not in boot tree', result.missingFromActual, (r) => `${r.id} (${r.name})`);
  section(
    'in boot tree but undeclared',
    result.missingFromDeclared,
    (r) => `${r.id} (${r.name}) — dump says: ${r.provenance}`,
  );
  section(
    'disabled-state mismatch',
    result.disabledMismatch,
    (r) => `${r.id}: declared=${r.declared} actual=${r.actual}`,
  );
  section(
    'orphan overrides (dsh warns and skips them)',
    result.orphanOverrides,
    (r) => `${r.id} in ${r.file}`,
  );
  section(
    'installed but inactive packages',
    result.inactivePackages,
    (r) => `${r.name}@${r.version}`,
  );
  const total =
    result.missingFromActual.length +
    result.missingFromDeclared.length +
    result.disabledMismatch.length +
    result.orphanOverrides.length +
    result.inactivePackages.length;
  if (total === 0) console.log('declared and actual trees agree');
  else process.exitCode = 1;
}

function cmdSnapshot(args) {
  const data = collectStatic(args.profile);
  const { dump } = tryDump(args.profile);
  const snap = tryRuntimeSnapshot();
  const current = model.snapshot(data, dump, snap);
  const againstFile = args.against;
  if (!againstFile) {
    if (!snap)
      console.error(
        '! no runtime snapshot found: services/tools are recorded as null (mount the plugin and open a session to include them)',
      );
    return console.log(JSON.stringify(current, null, 2));
  }

  const fs = require('node:fs');
  const { compareSnapshots } = require('../lib/compare.js');
  const saved = JSON.parse(fs.readFileSync(againstFile, 'utf8'));
  const result = compareSnapshots(saved, current);
  if (args.json) return console.log(JSON.stringify(result, null, 2));

  if (result.identical) {
    console.log(`composition identical to snapshot from ${result.savedAt}`);
    // Still say what the saved lock could not answer for: "identical" over an
    // unchecked field is exactly the claim this command exists to refuse.
    for (const notice of result.notices) console.log(`  ! ${notice}`);
    return;
  }
  console.log(`composition drifted from snapshot (${result.savedAt}):`);
  for (const b of result.changes.bundles) {
    if (b.change === 'added') console.log(`  bundle + ${b.name}@${b.version}`);
    else if (b.change === 'removed') console.log(`  bundle - ${b.name}`);
    else
      console.log(
        `  bundle ~ ${b.name}: ${b.change} ${b.from.version ?? b.from.patchHash} → ${b.to.version ?? b.to.patchHash}`,
      );
  }
  for (const p of result.changes.patches) {
    console.log(
      `  patch ${p.change === 'added' ? '+' : p.change === 'removed' ? '-' : '~'} ${p.kind}${p.change === 'content' ? `: ${p.from} → ${p.to}` : ''}`,
    );
  }
  for (const p of result.changes.packages) {
    if (p.change === 'added')
      console.log(
        `  package + ${p.name}@${p.version} (${p.source}, ${p.integrity ?? 'no integrity'})`,
      );
    else if (p.change === 'removed') console.log(`  package - ${p.name}`);
    else if (p.change === 'version')
      console.log(`  package ~ ${p.name}: ${p.from.version} → ${p.to.version}`);
    else if (p.change === 'source')
      console.log(`  package ~ ${p.name}: source ${p.from.source} → ${p.to.source}`);
    else console.log(`  package ~ ${p.name}: integrity ${p.from.integrity} → ${p.to.integrity}`);
  }
  for (const s of result.changes.services) {
    if (s.change === 'added') console.log(`  service + ${s.name} ← ${s.provider}`);
    else if (s.change === 'removed') console.log(`  service - ${s.name}`);
    else console.log(`  service ~ ${s.name}: ${s.from} → ${s.to}`);
  }
  for (const t of result.changes.tools) {
    if (t.change === 'added')
      console.log(`  tool + ${t.name} (owner ${t.owner ?? 'unattributed'})`);
    else if (t.change === 'removed') console.log(`  tool - ${t.name}`);
    else if (t.change === 'owner')
      console.log(
        `  tool ~ ${t.name}: owner ${t.from ?? 'unattributed'} → ${t.to ?? 'unattributed'}`,
      );
    else console.log(`  tool ~ ${t.name}: ~${t.from} tokens → ~${t.to}`);
  }
  if (result.changes.composed) {
    console.log(
      `  composed tree hash: ${result.changes.composed.from} → ${result.changes.composed.to}`,
    );
  }
  for (const notice of result.notices) console.log(`  ! ${notice}`);
  process.exitCode = 1;
}

function readRuntimeSnapshot() {
  const fs = require('node:fs');
  const path = require('node:path');
  const { xrayDir } = require('../lib/index.js');
  const file = path.join(xrayDir(), 'runtime.json');
  if (!fs.existsSync(file)) {
    throw new Error(
      `no runtime snapshot at ${file} — mount the plugin first: dsh plugin --profile web add dsh-xray`,
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Same read, but a missing or unparsable snapshot is a fact to record (the
 * lockfile writes null), not a reason to fail a static command. */
function tryRuntimeSnapshot() {
  try {
    return readRuntimeSnapshot();
  } catch {
    return null;
  }
}

function panelHint(args) {
  if (!args.json) console.log('\nlive panel: http://127.0.0.1:3080/xray (default bind)');
}

function cmdDeps(args) {
  const snap = readRuntimeSnapshot();
  const result = model.serviceGraph(snap);
  if (args.json) return console.log(JSON.stringify(result, null, 2));

  const filter = args._[1];
  for (const [service, node] of Object.entries(result.services)) {
    if (filter && service !== filter) continue;
    console.log(`${service}`);
    console.log(`  provided by: ${node.providers.join(', ') || '(nobody)'}`);
    if (node.consumers.length) console.log(`  consumed by: ${node.consumers.join(', ')}`);
  }
  if (!filter && Object.keys(result.cascade).length) {
    console.log('\n# disable-cascade (transitive consumers of each provider):');
    for (const [plugin, affected] of Object.entries(result.cascade)) {
      console.log(
        `  ${plugin} → ${affected.length} plugin(s): ${affected.slice(0, 6).join(', ')}${affected.length > 6 ? ', …' : ''}`,
      );
    }
  }
  if (result.unsatisfied.length) {
    console.log(`\n! ${result.unsatisfied.length} unsatisfied inject(s):`);
    for (const u of result.unsatisfied) console.log(`  ${u.plugin} wants ${u.service}`);
  }
  panelHint(args);
}

function cmdHealth(args) {
  const snap = readRuntimeSnapshot();
  const result = model.health(snap);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  console.log(
    `captured ${result.capturedAt}: ${result.healthy.length} healthy, ${result.unhealthy.length} unhealthy`,
  );
  for (const p of result.unhealthy) {
    console.log(`\n${p.name}`);
    for (const f of p.fibers)
      console.log(`  fiber ${f.uid}: ${f.state}${f.error ? ` (${f.error})` : ''}`);
    for (const t of p.transitions.slice(-5)) {
      console.log(`  ${new Date(t.at).toISOString()} ${t.state}`);
    }
  }
  if (result.unhealthy.length) process.exitCode = 1;
  panelHint(args);
}

function cmdCost(args) {
  const snap = readRuntimeSnapshot();
  const result = model.contextCost(snap);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  console.log(
    `~${result.totalTokens} tokens: ${result.toolCount} tool schema(s) ~${result.toolTokens} + ${result.sectionCount} prompt section(s) ~${result.sectionTokens} (captured ${result.capturedAt})\n`,
  );
  const bar = (share) => '█'.repeat(Math.max(1, Math.round(share / 2)));
  if (result.sections.length) {
    console.log('# prompt sections (observed at last assembly):');
    for (const s of result.sections) {
      console.log(
        `${pad(s.name, 32)} ${pad(`~${s.tokens}`, 8)} ${pad(`${s.share}%`, 7)} ${bar(s.share)}`,
      );
    }
    console.log();
  } else {
    console.log('# no prompt assembly observed yet — send one agent message first\n');
  }
  console.log('# tool schemas:');
  for (const t of result.tools) {
    console.log(
      `${pad(t.name, 32)} ${pad(`~${t.tokens}`, 8)} ${pad(`${t.share}%`, 7)} ${bar(t.share)}`,
    );
  }
  panelHint(args);
}

function cmdShadow(args) {
  const snap = readRuntimeSnapshot();
  const result = model.shadowing(snap);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  if (!result.services.length) console.log('no service is provided by more than one plugin');
  for (const s of result.services) {
    console.log(`${s.service}: provided by ${s.providers.join(' AND ')}`);
  }
  if (result.registrars.length) {
    console.log('\n# tool/command registrars:');
    for (const r of result.registrars) {
      console.log(`  ${r.plugin}: ${r.registrations} registration(s)`);
    }
  }
  if (result.services.length) process.exitCode = 1;
  panelHint(args);
}

function cmdVerify(args) {
  const data = collectStatic(args.profile);
  const snap = readRuntimeSnapshot();
  const fs = require('node:fs');
  let staticMtimeMs = null;
  for (const l of data.layers) {
    try {
      staticMtimeMs = Math.max(staticMtimeMs ?? 0, fs.statSync(l.file).mtimeMs);
    } catch {
      /* unreadable layer file: leave staleness unknown for it */
    }
  }
  const result = model.verify(data, snap, { staticMtimeMs });
  if (args.json) return console.log(JSON.stringify(result, null, 2));

  const declared = result.matched.length + result.declaredNotRunning.length;
  console.log(`runtime snapshot captured ${result.capturedAt}`);
  if (result.stale) {
    console.log(
      '! static layers changed after this snapshot — restart dsh or wait for the next refresh',
    );
  }
  const mark = result.declaredNotRunning.length ? '⚠' : '✓';
  console.log(
    `${mark} declared enabled plugins observed at runtime: ${result.matched.length}/${declared}`,
  );
  for (const r of result.declaredNotRunning) console.log(`  missing: ${r.id} (${r.name})`);
  if (result.disabledButRunning.length) {
    console.log(`✗ disabled but running (${result.disabledButRunning.length}):`);
    for (const r of result.disabledButRunning) {
      console.log(`  ${r.id} (${r.name}) — runtime: ${r.runtime}`);
    }
  }
  if (result.undeclaredRuntime.length) {
    console.log(
      `+ ${result.undeclaredRuntime.length} runtime-only plugin(s) (programmatic subplugins are normal): ${result.undeclaredRuntime.slice(0, 6).join(', ')}${result.undeclaredRuntime.length > 6 ? ', …' : ''}`,
    );
  }
  if (result.unsatisfied.length) {
    console.log(`! ${result.unsatisfied.length} unsatisfied inject(s):`);
    for (const u of result.unsatisfied) console.log(`  ${u.plugin} wants ${u.service}`);
  }
  // Service and tool reconciliation. Only three classes exist, and the
  // runtime-only one is the norm on a healthy boot (kernel plugins register
  // under their callback names), so it is summarised; the declared-disabled
  // class is the one worth reading row by row.
  const svc = result.services;
  console.log(
    `\n✓ services reconciled against the declared rows: ${svc.checked} (${svc.checked - svc.providerUndeclared.length - svc.providerDisabled.length} declared, ${svc.providerDisabled.length} declared-disabled, ${svc.providerUndeclared.length} runtime-only)`,
  );
  for (const s of svc.providerDisabled) {
    console.log(`  ✗ ${s.name}: provider ${s.provider} is declared disabled (row ${s.id})`);
  }
  if (svc.providerUndeclared.length) {
    const names = [...new Set(svc.providerUndeclared.map((s) => s.provider))];
    console.log(
      `  + runtime-only providers (${svc.providerUndeclared.length} service(s) from ${names.length} plugin(s)): ${names.slice(0, 6).join(', ')}${names.length > 6 ? ', …' : ''}`,
    );
  }
  const tools = result.tools;
  console.log(
    `\n✓ tool registrations reconciled against the declared rows: ${tools.checked} (${tools.checked - tools.ownerUndeclared.length - tools.ownerDisabled.length} declared, ${tools.ownerDisabled.length} declared-disabled, ${tools.ownerUndeclared.length} runtime-only)`,
  );
  const disabledOwners = new Map();
  for (const t of tools.ownerDisabled) {
    disabledOwners.set(t.owner, [...(disabledOwners.get(t.owner) ?? []), t.name]);
  }
  for (const [owner, names] of disabledOwners) {
    console.log(
      `  ✗ ${names.length} tool(s) from ${owner}, whose row is declared disabled (row ${tools.ownerDisabled.find((t) => t.owner === owner).id})`,
    );
  }
  if (tools.ownerUndeclared.length) {
    console.log(
      `  + runtime-only owners (${tools.ownerUndeclared.length}): ${[...new Set(tools.ownerUndeclared.map((t) => t.owner))].slice(0, 6).join(', ')}`,
    );
  }
  if (tools.unattributed.length) {
    console.log(
      `  ? ${tools.unattributed.length} tool(s) with no attribution entry (never guessed): ${tools.unattributed.slice(0, 6).join(', ')}${tools.unattributed.length > 6 ? ', …' : ''}`,
    );
  }
  for (const note of result.notes) console.log(`\n# ${note}`);
  // Exit 1 stays where it was: a declared plugin that never mounted, or a
  // disabled one that is running. The service/tool classes above are
  // scope-dependent (a disabled profile row can be mounted in an agent scope,
  // which is exactly how the harness ships its tool plugins) — reported, not
  // failed, matching how runtime-only plugins are already treated.
  if (result.declaredNotRunning.length || result.disabledButRunning.length) process.exitCode = 1;
  panelHint(args);
}

function cmdWhy(args) {
  const snap = readRuntimeSnapshot();
  const name = args._[1];
  if (!name) {
    console.error('usage: dsh-xray why <tool> [--profile web] [--json]');
    process.exitCode = 2;
    return;
  }
  const result = model.whyTool(snap, name);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  if (!result.found) {
    console.log(`no tool named "${name}" is attributed in the runtime snapshot`);
    const known = Object.keys(snap.toolOwners ?? {}).sort();
    console.log(
      known.length
        ? `attributed tools (${known.length}): ${known.join(', ')}`
        : 'no tool attribution yet — send one agent request first, the table is built from observed registrations',
    );
    process.exitCode = 1;
    return;
  }
  for (const row of result.rows) {
    const indent = '  '.repeat(row.depth);
    if (row.kind === 'tool') {
      console.log(
        `${indent}${row.name}${row.tokens != null ? ` (~${row.tokens} tokens in every request)` : ''}`,
      );
    } else if (row.kind === 'plugin') {
      const note = row.root
        ? ' — injects nothing (bundle root)'
        : row.revisited
          ? ' — already expanded above'
          : row.unresolved
            ? ' — not present in this snapshot'
            : '';
      console.log(`${indent}registered by ${row.name}${note}`);
      if (row.injects?.length) console.log(`${indent}  injects ${row.injects.join(', ')}`);
    } else {
      console.log(
        `${indent}provided by ${row.providers.join(', ') || '(nobody — this plugin waits forever)'}`,
      );
    }
  }
  panelHint(args);
}

function cmdAudit(args) {
  const { collectAudit } = require('../lib/collect/audit.js');
  const data = collectStatic(args.profile);
  const result = collectAudit(data);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  if (!result.plugins.length) return console.log('no out-of-tree plugins installed (kernel bundles are the trusted baseline)');
  for (const p of result.plugins) {
    console.log(`${p.name}@${p.version} (${p.scannedFiles} file(s) scanned)`);
    if (!p.capabilities.length) console.log('  no sensitive touchpoints detected');
    for (const c of p.capabilities) {
      console.log(`\n  ${c.capability}  confidence: ${c.confidence}`);
      for (const h of c.hits) console.log(`    ${pad(`${h.file}:${h.line}`, 32)} ${h.text}`);
    }
  }
}

function cmdGovernance(args) {
  const snap = readRuntimeSnapshot();
  const view = args._[0];
  const result = view === 'slo' ? model.contextSlo(snap) : view === 'graph' ? model.evidenceGraph(snap) : view === 'impact' ? model.impactAssessment(snap, args.plugin ?? args._[1] ?? '') : model.compositionDiff(snap, null);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

const commands = {
  attribute: cmdAttribute, conflicts: cmdConflicts, diff: cmdDiff, snapshot: cmdSnapshot,
  deps: cmdDeps, health: cmdHealth, cost: cmdCost, shadow: cmdShadow, verify: cmdVerify,
  why: cmdWhy, audit: cmdAudit,
  slo: cmdGovernance, graph: cmdGovernance, impact: cmdGovernance,
};

const args = parseArgs(process.argv.slice(2));
const cmd = commands[args._[0]];
if (!cmd) {
  console.log(`dsh-xray — X-ray for your DeepSeek Harness

Usage: dsh-xray <command> [--profile web] [--json]

Commands:
  attribute   which layer introduced each row, and who patched it since
  conflicts   rows whose fields have multiple writers, and who wins
  diff        declared (static layers) vs actual (dump-config) tree
  snapshot    content-addressed lockfile; --against <file> diffs a saved one
  deps        service dependency graph from the live runtime snapshot
  health      plugin lifecycle health from the live runtime snapshot
  cost        estimated context-token cost of each model-facing tool schema
  shadow      services provided by multiple plugins, and per-plugin registrations
  verify      declared (static) rows reconciled against the runtime registry
  why         provenance chain for one tool: who registered it, who provides its injects
  audit       static scan of out-of-tree plugins for sensitive touchpoints

deps/health/cost/shadow/verify/why need the plugin mounted: dsh plugin --profile web add dsh-xray`);
  process.exit(args._[0] ? 2 : 0);
}
try {
  cmd(args);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(2);
}
