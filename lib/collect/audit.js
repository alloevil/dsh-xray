// Audit collector: static scan of installed plugin sources for sensitive
// capability touchpoints. Heuristic by design — a flag means "this pattern
// appears in the shipped code", not "this plugin is malicious".

const fs = require('node:fs');
const path = require('node:path');

const CATEGORIES = [
  {
    id: 'network',
    label: 'network egress',
    patterns: [
      /\bfetch\s*\(/,
      /require\(['"](?:node:)?https?['"]\)/,
      /from\s+['"](?:node:)?https?['"]/,
      /\bWebSocket\b/,
      /\baxios\b/,
      /\bnode-fetch\b/,
    ],
  },
  {
    id: 'shell',
    label: 'subprocess / shell',
    patterns: [
      /require\(['"](?:node:)?child_process['"]\)/,
      /from\s+['"](?:node:)?child_process['"]/,
      /\bexecSync|\bexecFile|\bspawnSync?\b/,
      /\bnode-pty\b/,
    ],
  },
  {
    id: 'fs',
    label: 'filesystem',
    patterns: [
      /require\(['"](?:node:)?fs(?:\/promises)?['"]\)/,
      /from\s+['"](?:node:)?fs(?:\/promises)?['"]/,
    ],
  },
  {
    id: 'env',
    label: 'environment variables',
    patterns: [/\bprocess\.env\b/],
  },
  {
    id: 'eval',
    label: 'dynamic code evaluation',
    patterns: [/\beval\s*\(/, /new\s+Function\s*\(/],
  },
];

const SCAN_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts']);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 400;

function* walkFiles(dir, depth = 0) {
  if (depth > 6) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full, depth + 1);
    else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) yield full;
  }
}

/** Scan one plugin package directory. Returns per-category file hits. */
function auditPackage(dir) {
  const hits = new Map(); // category id -> Set of relative files
  let scanned = 0;
  for (const file of walkFiles(dir)) {
    if (++scanned > MAX_FILES) break;
    let text;
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const cat of CATEGORIES) {
      if (hits.get(cat.id)?.size >= 5) continue; // enough evidence
      if (cat.patterns.some((p) => p.test(text))) {
        if (!hits.has(cat.id)) hits.set(cat.id, new Set());
        hits.get(cat.id).add(path.relative(dir, file));
      }
    }
  }
  return {
    scannedFiles: scanned,
    categories: CATEGORIES.filter((c) => hits.has(c.id)).map((c) => ({
      id: c.id,
      label: c.label,
      files: [...hits.get(c.id)],
    })),
  };
}

/**
 * Audit every out-of-tree plugin in a profile (kernel @deepseek-ai/* packages
 * are the trusted baseline; auditing them adds noise, not signal).
 */
function collectAudit(staticData) {
  const results = [];
  for (const pkg of staticData.packages) {
    if (!pkg.dir) continue;
    results.push({ name: pkg.name, version: pkg.version, ...auditPackage(pkg.dir) });
  }
  return { schema: 'dsh-xray/audit@1', capturedAt: new Date().toISOString(), plugins: results };
}

module.exports = { collectAudit, auditPackage, CATEGORIES };
