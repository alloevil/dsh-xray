// Static collector: reads the layer stack from DSH_HOME without running dsh.
// Layers, in application order: each profile bundle's patch, the profile's
// cordis.patch.yml, the home-level cordis.patch.yml.

const fs = require('node:fs');
const path = require('node:path');
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
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    const dir = resolveBundleDir(home, profileDir, dep);
    const pkg = dir ? readJson(path.join(dir, 'package.json')) : null;
    if (pkg?.dsh) packages.push({ name: dep, version: pkg.version ?? null, dir, dsh: pkg.dsh });
    if (!dir) warnings.push(`dependency not installed: ${dep}`);
  }

  return { home, profile: profileName, manifestFile, bundles, layers, packages, warnings };
}

module.exports = { collectStatic, dshHome };
