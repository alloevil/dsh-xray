// Model layer: pure functions over collector output. No IO here.

const crypto = require('node:crypto');

/**
 * Replay patch layers over an empty row list, recording per-row provenance.
 *
 * Patch entry shapes (verified against dsh-base/web-app bundle patches and
 * dsh's loader semantics: id-targeted whole-config replacement, insert lists):
 *   - { insert: [row, ...] }          append new rows
 *   - { id, config?, disabled?, ... } override an existing row by id
 *
 * @param layers output of collectStatic().layers
 * @returns {{rows: Map<id, row>, orphans: [], provenance: Map<id, [event]>}}
 *   event: {layer, kind, action: 'insert'|'override', file, fields}
 */
function replayLayers(layers) {
  const rows = new Map();
  const provenance = new Map();
  const orphans = []; // overrides targeting an id that does not exist (silently skipped by dsh)

  const record = (id, event) => {
    if (!provenance.has(id)) provenance.set(id, []);
    provenance.get(id).push(event);
  };

  for (const layer of layers) {
    const meta = { layer: layer.name, kind: layer.kind, file: layer.file };
    for (const entry of layer.entries) {
      if (entry && Array.isArray(entry.insert)) {
        for (const row of entry.insert) {
          const id = row.id ?? row.name;
          rows.set(id, { ...row, id });
          record(id, { ...meta, action: 'insert', fields: Object.keys(row) });
        }
      } else if (entry && entry.id !== undefined) {
        const { id, ...rest } = entry;
        if (!rows.has(id)) {
          orphans.push({ ...meta, id, fields: Object.keys(rest) });
          continue;
        }
        // Loader semantics: whole-config replacement, not deep merge.
        rows.set(id, { ...rows.get(id), ...rest });
        record(id, { ...meta, action: 'override', fields: Object.keys(rest) });
      }
    }
  }
  return { rows, provenance, orphans };
}

/** F1: per-row layer attribution table. */
function attribute(staticData) {
  const { rows, provenance, orphans } = replayLayers(staticData.layers);
  const table = [...rows.values()].map((row) => {
    const events = provenance.get(row.id) ?? [];
    const origin = events.find((e) => e.action === 'insert') ?? null;
    return {
      id: row.id,
      name: row.name ?? null,
      disabled: row.disabled === true,
      origin: origin ? { layer: origin.layer, kind: origin.kind } : null,
      overrides: events
        .filter((e) => e.action === 'override')
        .map((e) => ({ layer: e.layer, kind: e.kind, fields: e.fields })),
    };
  });
  return { rows: table, orphans, warnings: staticData.warnings };
}

/** F3: rows written by more than one layer, with the winning writer last. */
function conflicts(staticData) {
  const { provenance } = replayLayers(staticData.layers);
  const out = [];
  for (const [id, events] of provenance) {
    // A conflict needs two writers touching the same field set beyond the insert.
    const writers = events.filter((e) => e.action === 'override');
    if (writers.length === 0) continue;
    const byField = new Map();
    for (const e of events) {
      for (const f of e.fields) {
        if (f === 'id') continue;
        if (!byField.has(f)) byField.set(f, []);
        byField.get(f).push({ layer: e.layer, kind: e.kind, action: e.action });
      }
    }
    const contested = [...byField.entries()].filter(([, w]) => w.length > 1);
    if (contested.length === 0) continue;
    out.push({
      id,
      fields: contested.map(([field, writers]) => ({
        field,
        writers,
        winner: writers[writers.length - 1].layer,
      })),
    });
  }
  return out;
}

/** F2: declared (static replay) vs actual (dump-config) diff. */
function diff(staticData, dumpData) {
  const declared = replayLayers(staticData.layers);
  const actualById = new Map(dumpData.rows.map((r) => [r.id, r]));

  const missingFromActual = []; // declared but dsh dropped it
  const missingFromDeclared = []; // in the boot tree but no static layer declares it
  const disabledMismatch = [];

  for (const [id, row] of declared.rows) {
    const actual = actualById.get(id);
    if (!actual) {
      missingFromActual.push({ id, name: row.name ?? null });
      continue;
    }
    if ((row.disabled === true) !== actual.disabled) {
      disabledMismatch.push({ id, declared: row.disabled === true, actual: actual.disabled });
    }
  }
  for (const row of dumpData.rows) {
    if (!declared.rows.has(row.id)) {
      missingFromDeclared.push({ id: row.id, name: row.name, provenance: row.provenance });
    }
  }

  // Installed out-of-tree plugins whose bundle patch rows never made it in.
  const inactivePackages = staticData.packages
    .filter((p) => p.dsh?.bundle)
    .filter(
      (p) =>
        ![...declared.rows.values()].some((r) => r.name === p.name) &&
        !dumpData.rows.some((r) => r.name === p.name),
    )
    .map((p) => ({ name: p.name, version: p.version }));

  return {
    missingFromActual,
    missingFromDeclared,
    disabledMismatch,
    orphanOverrides: declared.orphans,
    inactivePackages,
  };
}

/** F9: content-addressed snapshot of the effective composition. */
function snapshot(staticData, dumpData) {
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  return {
    schema: 'dsh-xray/snapshot@1',
    createdAt: new Date().toISOString(),
    profile: staticData.profile,
    bundles: staticData.layers
      .filter((l) => l.kind === 'bundle')
      .map((l) => ({ name: l.name, version: l.version, patchHash: sha(l.text) })),
    patches: staticData.layers
      .filter((l) => l.kind !== 'bundle')
      .map((l) => ({ kind: l.kind, file: l.file, hash: sha(l.text) })),
    packages: staticData.packages.map((p) => ({ name: p.name, version: p.version })),
    composedHash: dumpData ? sha(dumpData.raw) : null,
    rowCount: dumpData ? dumpData.rows.length : null,
  };
}

/** F4: service dependency graph from a runtime snapshot. */
function serviceGraph(snap) {
  const services = {}; // service name -> { providers: [], consumers: [] }
  const touch = (s) => (services[s] ??= { providers: [], consumers: [] });
  // Primary source: the reflect store (Impl records — authoritative provider
  // ownership). Callback `provide` fields are a fallback for older snapshots.
  for (const s of snap.services ?? []) {
    const node = touch(s.name);
    if (s.provider && !node.providers.includes(s.provider)) node.providers.push(s.provider);
  }
  const providerOf = new Map(); // plugin name -> provided services
  for (const p of snap.plugins) {
    for (const s of p.provide) {
      const node = touch(s);
      if (!node.providers.includes(p.name)) node.providers.push(p.name);
    }
    for (const s of p.inject) touch(s).consumers.push(p.name);
  }
  for (const [name, node] of Object.entries(services)) {
    for (const provider of node.providers) {
      if (!providerOf.has(provider)) providerOf.set(provider, []);
      providerOf.get(provider).push(name);
    }
  }
  // Cascade: disabling a provider of service S affects every consumer of S,
  // transitively through services those consumers themselves provide.
  const cascade = {};
  for (const [provider, provided] of providerOf) {
    const affected = new Set();
    const queue = [...provided];
    const seen = new Set(queue);
    while (queue.length) {
      const s = queue.shift();
      for (const consumer of services[s]?.consumers ?? []) {
        if (consumer === provider || affected.has(consumer)) continue;
        affected.add(consumer);
        for (const next of providerOf.get(consumer) ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
    }
    if (affected.size) cascade[provider] = [...affected].sort();
  }
  const unsatisfied = [];
  for (const p of snap.plugins) {
    for (const s of p.inject) {
      if (!services[s] || services[s].providers.length === 0) {
        unsatisfied.push({ plugin: p.name, service: s });
      }
    }
  }
  return { services, cascade, unsatisfied };
}

/** F5: unhealthy plugins from fiber states and transition history. */
function health(snap) {
  const healthy = [];
  const waiting = [];
  const unhealthy = [];
  for (const p of snap.plugins) {
    // FAILED = startup threw; a serialization error also counts. PENDING is
    // normal (waiting for services) but surfaces as "waiting" for visibility.
    const bad = p.fibers.filter((f) => f.error || f.state === 'FAILED');
    const pending = p.fibers.filter((f) => f.state === 'PENDING');
    const entry = {
      name: p.name,
      fibers: p.fibers.map((f) => ({ uid: f.uid, state: f.state, error: f.error })),
      transitions: snap.transitions?.[p.name] ?? [],
    };
    if (bad.length) unhealthy.push(entry);
    else if (pending.length) waiting.push(entry);
    else healthy.push(entry);
  }
  return {
    healthy: healthy.map((p) => p.name),
    waiting: waiting.map((p) => ({
      name: p.name,
      inject: snap.plugins.find((x) => x.name === p.name)?.inject ?? [],
    })),
    unhealthy,
    capturedAt: snap.capturedAt,
  };
}

/** F7: same-name registrations where a later writer silently shadows. */
function shadowing(snap) {
  // Service ownership comes from the reflect store; callback `provide` is a
  // secondary source. Cordis rejects same-layer duplicate tools itself, so
  // what we surface is cross-source duplication: one service claimed by
  // multiple plugins (isolation scopes make this legal — and invisible).
  const out = { services: [], registrars: [] };
  const providersByService = new Map();
  for (const s of snap.services ?? []) {
    if (!providersByService.has(s.name)) providersByService.set(s.name, []);
    if (s.provider) providersByService.get(s.name).push(s.provider);
  }
  for (const p of snap.plugins) {
    for (const s of p.provide) {
      const list = providersByService.get(s) ?? [];
      if (!list.includes(p.name)) providersByService.set(s, [...list, p.name]);
    }
  }
  for (const [service, providers] of providersByService) {
    if (providers.length > 1) out.services.push({ service, providers });
  }
  for (const p of snap.plugins) {
    const registrations = p.fibers
      .flatMap((f) => f.effects)
      .filter((e) => /tools\.register|commands?\./.test(e?.label ?? '')).length;
    if (registrations > 0) out.registrars.push({ plugin: p.name, registrations });
  }
  return out;
}

/** F8: estimated context cost — tool schemas plus prompt sections, each
 * attributed to the plugin that registered it (F9: owner join + per-plugin
 * rollup). Owners come from the snapshot's diff-based attribution tables;
 * a missing entry renders as null (`unattributed`), never a guess. */
function contextCost(snap) {
  const sectionOwners = snap.sectionOwners ?? {};
  const toolOwners = snap.toolOwners ?? {};
  const tools = (snap.tools ?? []).slice().sort((a, b) => b.tokens - a.tokens);
  const toolTokens = tools.reduce((sum, t) => sum + t.tokens, 0);
  const sections = (snap.promptAssembly?.sections ?? [])
    .slice()
    .sort((a, b) => b.tokens - a.tokens);
  const sectionTokens = sections.reduce((sum, s) => sum + s.tokens, 0);
  const total = toolTokens + sectionTokens;
  const share = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);

  // Per-plugin rollup: what does each plugin cost per request, and through
  // which entries? This is the context-budget view: sort by tokens, and the
  // top rows are the plugins silently taxing every request.
  const byOwner = new Map();
  const add = (owner, kind, name, tokens) => {
    const key = owner ?? 'unattributed';
    if (!byOwner.has(key))
      byOwner.set(key, { plugin: key, tokens: 0, sections: 0, tools: 0, entries: [] });
    const row = byOwner.get(key);
    row.tokens += tokens;
    row[kind] += 1;
    row.entries.push({ kind: kind === 'sections' ? 'section' : 'tool', name, tokens });
  };
  for (const s of sections) add(sectionOwners[s.name], 'sections', s.name, s.tokens);
  for (const t of tools) add(toolOwners[t.name], 'tools', t.name, t.tokens);
  const owners = [...byOwner.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .map((row) => ({
      ...row,
      share: share(row.tokens),
      entries: row.entries.sort((a, b) => b.tokens - a.tokens),
    }));

  return {
    totalTokens: total,
    toolTokens,
    sectionTokens,
    toolCount: tools.length,
    sectionCount: sections.length,
    tools: tools.map((t) => ({
      name: t.name,
      tokens: t.tokens,
      share: share(t.tokens),
      owner: toolOwners[t.name] ?? null,
    })),
    sections: sections.map((s) => ({
      name: s.name,
      tokens: s.tokens,
      share: share(s.tokens),
      owner: sectionOwners[s.name] ?? null,
    })),
    owners,
    promptObservedAt: snap.promptAssembly?.at ?? null,
    capturedAt: snap.capturedAt,
  };
}

/** F10: skill context cost — the catalog line every request carries per
 * skill, plus each skill's on-load body size. Read-only companion to the
 * ecosystem's skill managers: xray prices, it never toggles. */
function skillCost(snap) {
  const observed = snap.skillCatalog;
  if (!observed) return { available: false, skills: [], totals: null, capturedAt: snap.capturedAt };
  const rows = observed.skills
    .slice()
    .sort((a, b) => b.catalogTokens - a.catalogTokens)
    .map((s) => ({
      name: s.name,
      provider: s.provider,
      source: s.source,
      modelInvocable: s.modelInvocable,
      catalogTokens: s.catalogTokens,
      bodyTokens: s.bodyTokens,
    }));
  const invocable = rows.filter((s) => s.modelInvocable);
  const catalogEntryTokens = invocable.reduce((sum, s) => sum + s.catalogTokens, 0);
  return {
    available: true,
    skills: rows,
    totals: {
      count: rows.length,
      invocable: invocable.length,
      // Only model-invocable skills enter the durable catalog; its framing
      // is a fixed one-off on top of the per-skill lines.
      catalogEntryTokens,
      catalogOverheadTokens: observed.catalogOverheadTokens,
      residentTokens:
        invocable.length > 0 ? catalogEntryTokens + observed.catalogOverheadTokens : 0,
    },
    observedAt: observed.capturedAt,
    capturedAt: snap.capturedAt,
  };
}

/** F11: per-request ledger — one classified bill per LLM call, newest
 * first, with prefix-stability and delta markers. The time axis the static
 * cost view lacks. */
function requestLedger(snap) {
  const observed = snap.requestLedger;
  if (!observed || Object.keys(observed).length === 0)
    return { available: false, sessions: [], capturedAt: snap.capturedAt };
  const sessions = Object.entries(observed)
    .map(([sessionId, entries]) => ({
      sessionId,
      lastAt: entries[entries.length - 1]?.at ?? 0,
      requests: entries
        .slice()
        .reverse()
        .map((e, i, arr) => ({
          seq: entries.length - i,
          at: e.at,
          purpose: e.purpose,
          provider: e.provider,
          model: e.model,
          total: e.total,
          system: e.system,
          toolSchemas: e.toolSchemas,
          history: e.history,
          toolResults: e.toolResults,
          toolResultRows: e.toolResultRows,
          historyMessages: e.historyMessages,
          prefixStable: e.prefixStable,
          deltaTotal: e.deltaTotal,
        })),
    }))
    .sort((a, b) => b.lastAt - a.lastAt);
  return { available: true, sessions, capturedAt: snap.capturedAt };
}

module.exports = {
  replayLayers,
  attribute,
  conflicts,
  diff,
  snapshot,
  serviceGraph,
  health,
  shadowing,
  contextCost,
  skillCost,
  requestLedger,
};
