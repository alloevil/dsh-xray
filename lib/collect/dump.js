'use strict';
// Dump collector: runs `dsh --profile <p> --dump-config` and parses the
// composed tree, preserving dsh's own provenance comments (`# == <layer>`),
// which annotate the row group that follows them.

const { execFileSync } = require('node:child_process');
const YAML = require('yaml');

const jsTag = { tag: 'tag:yaml.org,2002:js', resolve: (str) => ({ $js: str }) };

function runDump(profileName, { dshBin = 'dsh' } = {}) {
  return execFileSync(dshBin, ['--profile', profileName, '--dump-config'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * @returns {{rows: [{id, name, config, disabled, provenance: string|null}], raw}}
 * provenance is dsh's own `# ==` annotation, e.g.
 * "@deepseek-ai/dsh-base, patched by @deepseek-ai/dsh-web-app".
 */
function parseDump(text) {
  const docs = YAML.parse(text, { customTags: [jsTag] });
  if (!Array.isArray(docs)) throw new Error('dump-config did not yield a YAML array');

  // Map each top-level row start line -> most recent `# ==` header.
  const headerByLine = [];
  let current = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^# == (.+)$/);
    if (m) current = m[1].trim();
    if (/^- /.test(lines[i])) headerByLine.push(current);
  }

  const rows = docs.map((row, i) => ({
    id: row.id ?? null,
    name: row.name ?? null,
    config: row.config,
    disabled: row.disabled === true,
    provenance: headerByLine[i] ?? null,
  }));
  return { rows, raw: text };
}

function collectDump(profileName, opts) {
  return parseDump(runDump(profileName, opts));
}

module.exports = { collectDump, parseDump };
