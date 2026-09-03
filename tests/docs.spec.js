// Docs-drift guard: every CLI command and long flag must be documented in
// BOTH READMEs. A feature that lives only in `--help` output, the CHANGELOG,
// an SVG demo, or one language's README is invisible to most readers —
// an external review already missed `snapshot --against` exactly this way.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const binSource = read(path.join('bin', 'xray.js'));
const README_FILES = ['README.md', path.join('docs', 'README.zh.md')];
const readmes = Object.fromEntries(README_FILES.map((f) => [f, read(f)]));

// Commands come from the dispatch table, flags from parseArgs — the same
// source the binary executes, so this list can never go stale.
const dispatch = binSource.match(/const commands = \{([^}]*)\}/);
const commands = [...dispatch[1].matchAll(/(\w+):/g)].map((m) => m[1]);
const flags = [...new Set([...binSource.matchAll(/=== '(--[\w-]+)'/g)].map((m) => m[1]))];

test('extraction found the real CLI surface', () => {
  assert.ok(commands.length >= 9, `commands parsed: ${commands.join(', ')}`);
  assert.ok(flags.includes('--against'), `flags parsed: ${flags.join(', ')}`);
});

test('every CLI command is documented in both READMEs', () => {
  for (const [file, text] of Object.entries(readmes)) {
    for (const cmd of commands) {
      assert.ok(text.includes(`dsh-xray ${cmd}`), `${file} never mentions command "${cmd}"`);
    }
  }
});

test('every CLI flag is documented in both READMEs', () => {
  for (const [file, text] of Object.entries(readmes)) {
    for (const flag of flags) {
      assert.ok(text.includes(flag), `${file} never mentions flag "${flag}"`);
    }
  }
});

test('agent tool view list in both READMEs matches the tool definition', () => {
  const src = read(path.join('lib', 'index.js'));
  const declared = src.match(/description:\s*\n?\s*'([^']*\(default summary\))'/)?.[1];
  assert.ok(declared, 'view description not found in lib/index.js');
  const views = declared.replace(/\s*\(default summary\)/, '').trim();
  for (const [file, text] of Object.entries(readmes)) {
    assert.ok(text.includes(`view: ${views}`), `${file} lists stale tool views (want: ${views})`);
  }
});
