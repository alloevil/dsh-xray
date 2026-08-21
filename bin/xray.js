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
      `\n! ${result.orphans.length} orphan override(s) targeting nonexistent rows (silently skipped by dsh):`,
    );
    for (const o of result.orphans) console.log(`  ${o.id}  in ${o.file}`);
  }
  for (const w of result.warnings) console.log(`! ${w}`);
}

function cmdConflicts(args) {
  const data = collectStatic(args.profile);
  const result = model.conflicts(data);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  if (!result.length) return console.log('no contested rows: every field has a single writer');
  for (const c of result) {
    console.log(`${c.id}`);
    for (const f of c.fields) {
      console.log(
        `  .${f.field}: ${f.writers.map((w) => w.layer).join(' → ')}  (winner: ${f.winner})`,
      );
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
    'orphan overrides (silently skipped)',
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
  const current = model.snapshot(data, dump);
  const againstFile = args.against;
  if (!againstFile) return console.log(JSON.stringify(current, null, 2));

  const fs = require('node:fs');
  const { compareSnapshots } = require('../lib/compare.js');
  const saved = JSON.parse(fs.readFileSync(againstFile, 'utf8'));
  const result = compareSnapshots(saved, current);
  if (args.json) return console.log(JSON.stringify(result, null, 2));

  if (result.identical) {
    return console.log(`composition identical to snapshot from ${result.savedAt}`);
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
    if (p.change === 'added') console.log(`  package + ${p.name}@${p.version}`);
    else if (p.change === 'removed') console.log(`  package - ${p.name}`);
    else console.log(`  package ~ ${p.name}: ${p.from} → ${p.to}`);
  }
  if (result.changes.composed) {
    console.log(
      `  composed tree hash: ${result.changes.composed.from} → ${result.changes.composed.to}`,
    );
  }
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

function panelHint(args) {
  if (!args.json) console.log('\nlive panel: http://localhost:3080/xray');
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

function cmdAudit(args) {
  const { collectAudit } = require('../lib/collect/audit.js');
  const data = collectStatic(args.profile);
  const result = collectAudit(data);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  if (!result.plugins.length) {
    return console.log(
      'no out-of-tree plugins installed (kernel bundles are the trusted baseline)',
    );
  }
  for (const p of result.plugins) {
    console.log(`${p.name}@${p.version} (${p.scannedFiles} file(s) scanned)`);
    if (!p.categories.length) console.log('  no sensitive touchpoints detected');
    for (const c of p.categories) {
      console.log(
        `  ${c.label}: ${c.files.slice(0, 3).join(', ')}${c.files.length > 3 ? ', …' : ''}`,
      );
    }
  }
}

const commands = {
  attribute: cmdAttribute,
  conflicts: cmdConflicts,
  diff: cmdDiff,
  snapshot: cmdSnapshot,
  deps: cmdDeps,
  health: cmdHealth,
  cost: cmdCost,
  shadow: cmdShadow,
  audit: cmdAudit,
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
  audit       static scan of out-of-tree plugins for sensitive touchpoints

deps/health/cost/shadow need the plugin mounted: dsh plugin --profile web add dsh-xray`);
  process.exit(args._[0] ? 2 : 0);
}
try {
  cmd(args);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(2);
}
