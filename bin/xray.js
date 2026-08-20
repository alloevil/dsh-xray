#!/usr/bin/env node
'use strict';
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
    else if (a === '--json') args.json = true;
    else args._.push(a);
  }
  return args;
}

function tryDump(profile) {
  try {
    return { dump: collectDump(profile), error: null };
  } catch (err) {
    return { dump: null, error: `dump-config unavailable (${err.message.split('\n')[0]}); static-only mode` };
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
    console.log(`\n! ${result.orphans.length} orphan override(s) targeting nonexistent rows (silently skipped by dsh):`);
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
      console.log(`  .${f.field}: ${f.writers.map((w) => w.layer).join(' → ')}  (winner: ${f.winner})`);
    }
  }
}

function cmdDiff(args) {
  const data = collectStatic(args.profile);
  const { dump, error } = tryDump(args.profile);
  if (error) { console.error(`! ${error}`); process.exitCode = 1; return; }
  const result = model.diff(data, dump);
  if (args.json) return console.log(JSON.stringify(result, null, 2));

  const section = (title, items, fmt) => {
    if (!items.length) return;
    console.log(`\n${title} (${items.length})`);
    for (const it of items) console.log(`  ${fmt(it)}`);
  };
  section('declared but not in boot tree', result.missingFromActual, (r) => `${r.id} (${r.name})`);
  section('in boot tree but undeclared', result.missingFromDeclared, (r) => `${r.id} (${r.name}) — dump says: ${r.provenance}`);
  section('disabled-state mismatch', result.disabledMismatch, (r) => `${r.id}: declared=${r.declared} actual=${r.actual}`);
  section('orphan overrides (silently skipped)', result.orphanOverrides, (r) => `${r.id} in ${r.file}`);
  section('installed but inactive packages', result.inactivePackages, (r) => `${r.name}@${r.version}`);
  const total = result.missingFromActual.length + result.missingFromDeclared.length
    + result.disabledMismatch.length + result.orphanOverrides.length + result.inactivePackages.length;
  if (total === 0) console.log('declared and actual trees agree');
  else process.exitCode = 1;
}

function cmdSnapshot(args) {
  const data = collectStatic(args.profile);
  const { dump } = tryDump(args.profile);
  console.log(JSON.stringify(model.snapshot(data, dump), null, 2));
}

const commands = {
  attribute: cmdAttribute,
  conflicts: cmdConflicts,
  diff: cmdDiff,
  snapshot: cmdSnapshot,
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
  snapshot    content-addressed lockfile of the effective composition`);
  process.exit(args._[0] ? 2 : 0);
}
try {
  cmd(args);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(2);
}
