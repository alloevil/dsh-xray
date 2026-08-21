#!/usr/bin/env node
'use strict';
// Extract one version's section from CHANGELOG.md (for release notes).
// Usage: node scripts/changelog-notes.mjs 0.6.0
const fs = require('node:fs');
const path = require('node:path');

const version = (process.argv[2] ?? '').replace(/^v/, '');
if (!version) {
  console.error('usage: changelog-notes <version>');
  process.exit(2);
}
const text = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const re = new RegExp(`^## ${version.replace(/\./g, '\\.')}[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm');
const m = text.match(re);
if (!m) {
  console.error(`no CHANGELOG section for ${version}`);
  process.exit(1);
}
process.stdout.write(m[1].trim() + '\n');
