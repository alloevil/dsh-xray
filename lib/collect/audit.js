// Audit collector: static scan of installed plugin sources for sensitive
// capability touchpoints. Heuristic by design — a flag means "this pattern
// appears in the shipped code", not "this plugin is malicious".
//
// Every hit carries file:line plus the matched line (≤80 chars), and every
// capability carries a confidence derived from two independently checkable
// facts: does the source import the module this capability needs, and does it
// contain a call site? The rule is the output — there is no scoring model, so
// "why high?" is always answerable by opening the two hits.

const fs = require('node:fs');
const path = require('node:path');

const MAX_HITS_PER_CAPABILITY = 5; // enough evidence to check, not a dump
const MAX_SNIPPET = 80;

// Read/write share the `node:fs` import: the module says nothing about which
// half is used, so an import-only file is reported on both, at medium.
const FS_IMPORTS = [
  /require\(['"](?:node:)?fs(?:\/promises)?['"]\)/,
  /from\s+['"](?:node:)?fs(?:\/promises)?['"]/,
];
const FS_READ_CALLS = [
  /\b(?:fs|fsp|fsPromises|promises)\.(?:readFileSync|readFile|readdirSync|readdir|createReadStream|existsSync|statSync|stat|lstatSync|lstat|accessSync|access|openSync|open|watch|watchFile)\b/,
  /\b(?:readFileSync|readFile|readdirSync|readdir|createReadStream|existsSync|statSync|lstatSync|accessSync|openSync)\s*\(/,
];
const FS_WRITE_CALLS = [
  /\b(?:fs|fsp|fsPromises|promises)\.(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|mkdirSync|mkdir|rmSync|rm|rmdirSync|rmdir|unlinkSync|unlink|renameSync|rename|copyFileSync|copyFile|chmodSync|chmod|symlinkSync|symlink|truncateSync|truncate|utimesSync|utimes|writeSync|write)\b/,
  /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|mkdirSync|rmSync|rmdirSync|unlinkSync|renameSync|copyFileSync|chmodSync|symlinkSync|truncateSync|utimesSync)\s*\(/,
];

/**
 * Capabilities, in report order.
 *   imports        — module bindings that make the capability reachable
 *   calls          — use sites (may be a same-named local: hence medium)
 *   maxConfidence  — ceiling for capabilities with no importable module
 *   gate           — union of the above, tested against the whole file first
 *                    so a file that cannot match never gets split into lines
 */
const CAPABILITIES = [
  {
    id: 'process.spawn',
    label: 'subprocess / shell',
    imports: [
      /require\(['"](?:node:)?child_process['"]\)/,
      /from\s+['"](?:node:)?child_process['"]/,
      /\bnode-pty\b/,
    ],
    calls: [
      /\bexecSync\s*\(/,
      /\bexecFileSync\s*\(/,
      /\bexecFile\s*\(/,
      /\bspawnSync\s*\(/,
      /\bspawn\s*\(/,
      /\bnode-pty\b/,
    ],
  },
  {
    id: 'network.outbound',
    label: 'network egress',
    imports: [
      /require\(['"](?:node:)?https?['"]\)/,
      /from\s+['"](?:node:)?https?['"]/,
      /\baxios\b/,
      /\bnode-fetch\b/,
    ],
    calls: [/\bfetch\s*\(/, /\bWebSocket\b/, /\baxios\s*[.(]/, /\bhttps?\.(?:get|request)\s*\(/],
  },
  {
    id: 'filesystem.read',
    label: 'filesystem read',
    imports: FS_IMPORTS,
    calls: FS_READ_CALLS,
  },
  {
    id: 'filesystem.write',
    label: 'filesystem write',
    imports: FS_IMPORTS,
    calls: FS_WRITE_CALLS,
  },
  {
    id: 'env.read',
    label: 'environment variables',
    // No module to import and no way to tell a read from a lookup for
    // configuration: every hit is capped at low.
    imports: [],
    calls: [/\bprocess\.env\b/],
    maxConfidence: 'low',
  },
  {
    id: 'code.eval',
    label: 'dynamic code evaluation',
    // `eval`/`new Function` need no import, so a call site is all there is.
    imports: [],
    calls: [/\beval\s*\(/, /new\s+Function\s*\(/],
    maxConfidence: 'medium',
  },
];

for (const cap of CAPABILITIES) {
  const sources = [...cap.imports, ...cap.calls].map((p) => p.source);
  cap.gate = new RegExp(sources.join('|'));
  cap.maxConfidence = cap.maxConfidence ?? 'high';
}

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
  // Sorted: hit order is part of the report (and of the committed goldens), so
  // it must not depend on the filesystem's readdir order.
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full, depth + 1);
    else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) yield full;
  }
}

function snippet(line) {
  const trimmed = line.trim();
  return trimmed.length > MAX_SNIPPET ? `${trimmed.slice(0, MAX_SNIPPET - 1)}…` : trimmed;
}

/**
 * Confidence from the two facts the scan can observe, per capability:
 *   import + call site   → high
 *   import only / call only → medium (a call may be a same-named local function)
 *   no importable module → the capability's own ceiling (env.read: low)
 */
function confidenceOf(cap, kinds) {
  if (cap.imports.length === 0) return cap.maxConfidence;
  if (kinds.has('import') && kinds.has('call')) return 'high';
  return 'medium';
}

/** Scan one plugin package directory. Returns per-capability hits. */
function auditPackage(dir) {
  const state = new Map(); // capability id -> { hits, kinds }
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
    const candidates = CAPABILITIES.filter((cap) => cap.gate.test(text));
    if (!candidates.length) continue;
    const rel = path.relative(dir, file);
    const lines = text.split('\n');
    for (const cap of candidates) {
      let st = state.get(cap.id);
      for (const [index, line] of lines.entries()) {
        const isCall = cap.calls.some((p) => p.test(line));
        const isImport = cap.imports.some((p) => p.test(line));
        if (!isCall && !isImport) continue;
        // A line can be both (require inside a call); record the fact once.
        st ??= { hits: [], kinds: new Set() };
        if (isCall) st.kinds.add('call');
        if (isImport) st.kinds.add('import');
        if (st.hits.length < MAX_HITS_PER_CAPABILITY) {
          st.hits.push({ file: rel, line: index + 1, text: snippet(line) });
        }
      }
      if (st) state.set(cap.id, st);
    }
  }
  return {
    scannedFiles: scanned,
    capabilities: CAPABILITIES.filter((c) => state.has(c.id)).map((c) => ({
      capability: c.id,
      label: c.label,
      confidence: confidenceOf(c, state.get(c.id).kinds),
      hits: state.get(c.id).hits,
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
  return { schema: 'dsh-xray/audit@2', capturedAt: new Date().toISOString(), plugins: results };
}

module.exports = { collectAudit, auditPackage, CAPABILITIES };
