// Snapshot comparison: current composition vs a saved lockfile.
//
// Accepts @1 and @2 locks. Fields the saved lock does not carry (a @1 lock has
// no integrity/source, a static-only @2 lock has no runtime sections) cannot be
// compared — they are reported in `notices` instead of being silently treated
// as equal, which would make an unverifiable lock look verified.

const SCHEMAS = ['dsh-xray/snapshot@1', 'dsh-xray/snapshot@2'];

function indexBy(list, key) {
  const m = new Map();
  for (const item of list ?? []) m.set(item[key], item);
  return m;
}

/** Providers of one service, joined for display: several records may share a name. */
function providersOf(rows) {
  return rows
    .map((r) => r.provider)
    .filter(Boolean)
    .sort()
    .join(', ');
}

function face(p) {
  return { version: p.version, source: p.source ?? null, integrity: p.integrity ?? null };
}

function comparePackages(saved, current, savedSchema, changes) {
  const savedPkgs = indexBy(saved.packages, 'name');
  const currentPkgs = indexBy(current.packages, 'name');
  for (const [name, p] of currentPkgs) {
    const old = savedPkgs.get(name);
    if (!old) {
      changes.packages.push({ name, change: 'added', ...face(p) });
      continue;
    }
    const from = face(old);
    const to = face(p);
    if (from.version !== to.version) {
      changes.packages.push({ name, change: 'version', from, to });
      continue;
    }
    if (savedSchema === 'dsh-xray/snapshot@1') continue; // that record carries versions only
    if (from.source !== to.source) {
      changes.packages.push({ name, change: 'source', from, to });
      continue;
    }
    if (from.integrity !== to.integrity) {
      changes.packages.push({ name, change: 'integrity', from, to });
    }
  }
  for (const name of savedPkgs.keys()) {
    if (!currentPkgs.has(name)) changes.packages.push({ name, change: 'removed' });
  }
}

function compareServices(saved, current, changes) {
  const savedServices = new Map();
  const currentServices = new Map();
  for (const s of saved.services) {
    savedServices.set(s.name, [...(savedServices.get(s.name) ?? []), s]);
  }
  for (const s of current.services) {
    currentServices.set(s.name, [...(currentServices.get(s.name) ?? []), s]);
  }
  for (const [name, rows] of currentServices) {
    const old = savedServices.get(name);
    if (!old) {
      changes.services.push({ name, change: 'added', provider: providersOf(rows) });
      continue;
    }
    const from = providersOf(old);
    const to = providersOf(rows);
    if (from !== to) changes.services.push({ name, change: 'providers', from, to });
  }
  for (const name of savedServices.keys()) {
    if (!currentServices.has(name)) changes.services.push({ name, change: 'removed' });
  }
}

function compareTools(saved, current, changes) {
  const savedTools = indexBy(saved.tools, 'name');
  const currentTools = indexBy(current.tools, 'name');
  for (const [name, t] of currentTools) {
    const old = savedTools.get(name);
    if (!old) {
      changes.tools.push({ name, change: 'added', owner: t.owner ?? null });
      continue;
    }
    if ((old.owner ?? null) !== (t.owner ?? null)) {
      changes.tools.push({ name, change: 'owner', from: old.owner ?? null, to: t.owner ?? null });
    } else if (old.tokens !== t.tokens) {
      changes.tools.push({ name, change: 'tokens', from: old.tokens, to: t.tokens });
    }
  }
  for (const name of savedTools.keys()) {
    if (!currentTools.has(name)) changes.tools.push({ name, change: 'removed' });
  }
}

/**
 * F9b: compare a live snapshot against a saved one (`xray snapshot > lock.json`).
 * Returns per-category changes; `identical` is true only when everything both
 * locks carry matches.
 */
function compareSnapshots(saved, current) {
  const savedSchema = saved?.schema;
  if (!SCHEMAS.includes(savedSchema)) {
    throw new Error(`not a dsh-xray snapshot: schema=${savedSchema ?? 'missing'}`);
  }
  const notices = [];
  if (savedSchema === 'dsh-xray/snapshot@1') {
    notices.push(
      'saved lock is schema@1: package source/integrity and runtime sections not compared',
    );
  } else if (!saved.packages?.some((p) => p.integrity)) {
    notices.push(
      'saved lock records no package integrity: package content drift cannot be detected',
    );
  }

  const changes = {
    bundles: [],
    patches: [],
    packages: [],
    services: [],
    tools: [],
    composed: null,
  };

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

  comparePackages(saved, current, savedSchema, changes);

  // services / tools: absent or null on either side means that lock cannot
  // speak to the section (static-only mode, or a schema@1 lock, whose notice
  // above already covers both sections).
  for (const section of ['services', 'tools']) {
    const missingInSaved = !Array.isArray(saved[section]);
    const missingInCurrent = !Array.isArray(current[section]);
    if (!missingInSaved && !missingInCurrent) {
      if (section === 'services') compareServices(saved, current, changes);
      else compareTools(saved, current, changes);
    } else if (savedSchema === 'dsh-xray/snapshot@2') {
      notices.push(
        missingInSaved
          ? `saved lock carries no ${section} section: not compared`
          : `current snapshot carries no ${section} section: not compared`,
      );
    }
  }

  if (saved.composedHash && current.composedHash && saved.composedHash !== current.composedHash) {
    changes.composed = { from: saved.composedHash, to: current.composedHash };
  }

  const identical = Object.values(changes).every(
    (section) => section === null || section.length === 0,
  );
  return {
    schema: 'dsh-xray/snapshot-diff@2',
    identical,
    savedAt: saved.createdAt,
    profile: saved.profile,
    savedSchema,
    notices,
    changes,
  };
}

module.exports = { compareSnapshots };
