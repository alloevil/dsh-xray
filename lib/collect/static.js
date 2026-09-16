// Static collector: reads the layer stack from DSH_HOME without running dsh.
// Layers, in application order: each profile bundle's patch, the profile's
// cordis.patch.yml, the home-level cordis.patch.yml.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const YAML = require('yaml');

// `!!js` expressions are loader-evaluated; statically we keep them as opaque
// markers so comparison logic can treat them as "dynamic, not comparable".
const jsTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (str) => ({ $js: str }),
};

function parseYaml(text, file) {
  try {
    const lineCounter = new YAML.LineCounter();
    const doc = YAML.parseDocument(text, { customTags: [jsTag], lineCounter });
    if (doc.errors.length) {
      return { value: null, lines: [], error: `${file}: ${doc.errors[0].message}` };
    }
    // One source line per top-level patch entry, for evidence output.
    const lines = YAML.isSeq(doc.contents)
      ? doc.contents.items.map((item) =>
          item?.range ? lineCounter.linePos(item.range[0]).line : null,
        )
      : [];
    return { value: doc.toJS(), lines, error: null };
  } catch (err) {
    return { value: null, lines: [], error: `${file}: ${err.message}` };
  }
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Resolve a bundle package dir: profile node_modules flat closure. */
function resolveBundleDir(home, profileDir, name) {
  const candidates = [
    path.join(profileDir, 'node_modules', name),
    path.join(home, 'profiles', 'node_modules', name),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  }
  return null;
}

/**
 * How an installed package got here, from its declaration and its resolved
 * path: `link:`/`file:`/`workspace:`/`portal:` specs are working copies,
 * `.dsh-plugin` repositories are the plugin-console mechanism, everything
 * else came from the registry.
 */
function packageSource(spec, dir, home) {
  if (dir?.startsWith(path.join(home, '.dsh-plugin') + path.sep)) return 'repository';
  if (typeof spec === 'string' && /^(?:file|link|workspace|portal):/.test(spec)) return 'link';
  return 'registry';
}

function* walkPackageFiles(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    // node_modules and .git are the two subtrees that are not this package's
    // content; symlinks are skipped so a link inside cannot pull in a tree
    // that belongs to another package.
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield* walkPackageFiles(full, depth + 1);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Content hash of a package directory: sha256 over the sorted
 * `<relative path>\\0<sha256 of contents>` lines, excluding node_modules and
 * .git. `files` reports how many files the digest covers, so the scope of the
 * number is checkable rather than assumed.
 */
function packageIntegrity(dir) {
  if (!dir) return null;
  const files = [];
  for (const file of walkPackageFiles(dir)) files.push(file);
  const digest = crypto.createHash('sha256');
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file);
    } catch {
      continue; // unreadable file: excluded from both hash and count, deterministically
    }
    digest.update(`${path.relative(dir, file)}\0`);
    digest.update(crypto.createHash('sha256').update(content).digest('hex'));
    digest.update('\n');
  }
  return { integrity: `sha256-${digest.digest('hex').slice(0, 16)}`, files: files.length };
}

/**
 * Collect the static layer stack for a profile.
 * @returns {{home, profile, layers, packages, warnings}}
 *   layers: [{kind: 'bundle'|'profile-patch'|'home-patch', name, file, entries, hash}]
 *   packages: profile dependencies with a `dsh` field (mounted or not)
 */
function collectStatic(profileName) {
  const home = dshHome();
  const profileDir = path.join(home, 'profiles', profileName);
  const warnings = [];
  const layers = [];

  const manifestFile = path.join(profileDir, 'package.json');
  const manifest = readJson(manifestFile);
  if (!manifest) {
    throw new Error(`profile manifest not found: ${manifestFile}`);
  }
  const bundles = manifest.dsh?.profile?.bundles ?? [];

  for (const name of bundles) {
    const dir = resolveBundleDir(home, profileDir, name);
    if (!dir) {
      warnings.push(`bundle not resolvable: ${name}`);
      continue;
    }
    const pkg = readJson(path.join(dir, 'package.json'));
    const rel = pkg?.dsh?.bundle?.patch;
    if (!rel) {
      warnings.push(`bundle ${name} has no dsh.bundle.patch`);
      continue;
    }
    const file = path.join(dir, rel);
    const text = fs.readFileSync(file, 'utf8');
    const { value, lines, error } = parseYaml(text, file);
    if (error) warnings.push(error);
    layers.push({
      kind: 'bundle',
      name,
      version: pkg.version ?? null,
      file,
      entries: Array.isArray(value) ? value : [],
      lines,
      text,
    });
  }

  for (const [kind, file] of [
    ['profile-patch', path.join(profileDir, 'cordis.patch.yml')],
    ['home-patch', path.join(home, 'cordis.patch.yml')],
  ]) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const { value, lines, error } = parseYaml(text, file);
    if (error) warnings.push(error);
    layers.push({
      kind,
      name: kind,
      version: null,
      file,
      entries: Array.isArray(value) ? value : [],
      lines,
      text,
    });
  }

  // Repository plugins: the third-party plugin-console mechanism mounts
  // `.dsh-plugin` directories under the harness home; each carries its own
  // patch file. Not dsh core — absence is normal.
  const repoRoot = path.join(home, '.dsh-plugin');
  if (fs.existsSync(repoRoot)) {
    let entries = [];
    try {
      entries = fs.readdirSync(repoRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      /* unreadable repository root: skip */
    }
    for (const e of entries) {
      const dir = path.join(repoRoot, e.name);
      const pkg = readJson(path.join(dir, 'package.json'));
      const rel = pkg?.dsh?.bundle?.patch;
      if (!rel) continue;
      const file = path.join(dir, rel);
      if (!fs.existsSync(file)) {
        warnings.push(`repository plugin ${e.name}: patch missing (${rel})`);
        continue;
      }
      const text = fs.readFileSync(file, 'utf8');
      const { value, lines, error } = parseYaml(text, file);
      if (error) warnings.push(error);
      layers.push({
        kind: 'repository',
        name: pkg.name ?? e.name,
        version: pkg.version ?? null,
        file,
        entries: Array.isArray(value) ? value : [],
        lines,
        text,
      });
    }
  }

  // Out-of-tree plugins: profile dependencies carrying a `dsh` field.
  const packages = [];
  for (const [dep, spec] of Object.entries(manifest.dependencies ?? {})) {
    const dir = resolveBundleDir(home, profileDir, dep);
    const pkg = dir ? readJson(path.join(dir, 'package.json')) : null;
    if (pkg?.dsh) {
      const integrity = packageIntegrity(dir);
      packages.push({
        name: dep,
        version: pkg.version ?? null,
        dir,
        dsh: pkg.dsh,
        source: packageSource(spec, dir, home),
        integrity: integrity?.integrity ?? null,
        files: integrity?.files ?? null,
      });
    }
    if (!dir) warnings.push(`dependency not installed: ${dep}`);
  }

  return { home, profile: profileName, manifestFile, bundles, layers, packages, warnings };
}

module.exports = { collectStatic, dshHome, packageSource, packageIntegrity };
