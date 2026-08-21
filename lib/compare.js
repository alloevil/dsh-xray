// Snapshot comparison: current composition vs a saved lockfile.

function indexBy(list, key) {
  const m = new Map();
  for (const item of list ?? []) m.set(item[key], item);
  return m;
}

/**
 * F9b: compare a live snapshot against a saved one (`xray snapshot > lock.json`).
 * Returns per-category changes; `identical` is true only when everything matches.
 */
function compareSnapshots(saved, current) {
  if (saved?.schema !== 'dsh-xray/snapshot@1') {
    throw new Error(`not a dsh-xray snapshot: schema=${saved?.schema ?? 'missing'}`);
  }
  const changes = { bundles: [], patches: [], packages: [], composed: null };

  const savedBundles = indexBy(saved.bundles, 'name');
  const currentBundles = indexBy(current.bundles, 'name');
  for (const [name, b] of currentBundles) {
    const old = savedBundles.get(name);
    if (!old) changes.bundles.push({ name, change: 'added', version: b.version });
    else if (old.version !== b.version || old.patchHash !== b.patchHash) {
      changes.bundles.push({
        name,
        change: old.version !== b.version ? 'version' : 'patch-content',
        from: { version: old.version, patchHash: old.patchHash },
        to: { version: b.version, patchHash: b.patchHash },
      });
    }
  }
  for (const name of savedBundles.keys()) {
    if (!currentBundles.has(name)) changes.bundles.push({ name, change: 'removed' });
  }

  const savedPatches = indexBy(saved.patches, 'kind');
  const currentPatches = indexBy(current.patches, 'kind');
  for (const [kind, p] of currentPatches) {
    const old = savedPatches.get(kind);
    if (!old) changes.patches.push({ kind, change: 'added' });
    else if (old.hash !== p.hash)
      changes.patches.push({ kind, change: 'content', from: old.hash, to: p.hash });
  }
  for (const kind of savedPatches.keys()) {
    if (!currentPatches.has(kind)) changes.patches.push({ kind, change: 'removed' });
  }

  const savedPkgs = indexBy(saved.packages, 'name');
  const currentPkgs = indexBy(current.packages, 'name');
  for (const [name, p] of currentPkgs) {
    const old = savedPkgs.get(name);
    if (!old) changes.packages.push({ name, change: 'added', version: p.version });
    else if (old.version !== p.version) {
      changes.packages.push({ name, change: 'version', from: old.version, to: p.version });
    }
  }
  for (const name of savedPkgs.keys()) {
    if (!currentPkgs.has(name)) changes.packages.push({ name, change: 'removed' });
  }

  if (saved.composedHash && current.composedHash && saved.composedHash !== current.composedHash) {
    changes.composed = { from: saved.composedHash, to: current.composedHash };
  }

  const identical =
    !changes.bundles.length &&
    !changes.patches.length &&
    !changes.packages.length &&
    !changes.composed;
  return { identical, savedAt: saved.createdAt, profile: saved.profile, changes };
}

module.exports = { compareSnapshots };
