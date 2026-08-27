// Registry attribution: attribute named entries (prompt sections, tools) to
// the plugin that registered them. Purely observational — nothing here
// mutates the registries.
//
// Both dsh-system-prompt and dsh-tools follow the same ScopedLayers pattern:
// `register()`/`section()` runs `layers.effect(CALLER ctx, ...)` with a fixed
// label ("systemPrompt.section()" / "tools.register()"), and every
// registration/disposal emits a change event ("system-prompt/change" /
// "tools/change"). The effect meta carries only the label, not the entry
// name (cordis EffectMeta is {label, children}), so the name->plugin join is
// reconstructed diff-wise: between two change events, the only fibers whose
// labeled-effect count grew are the registrants of the names that appeared.
// Verified against dsh-system-prompt + cordis in /tmp probes (2026-08-25).
//
// Baseline rule: entries present before observation starts are attributed by
// a one-shot scan only when exactly one already-mounted fiber carries the
// label — otherwise they stay null (`unattributed`) rather than guessing.

/** Count effects with the given label in one fiber's live effect tree. */
function labeledEffectCount(fiber, label) {
  let count = 0;
  const walk = (effect, depth) => {
    if (!effect || depth > 4) return;
    if (effect.label === label) count += 1;
    for (const child of effect.children ?? []) walk(child, depth + 1);
  };
  try {
    for (const effect of fiber.getEffects?.() ?? []) walk(effect, 0);
  } catch {
    /* disposed fiber mid-walk: count what we saw */
  }
  return count;
}

/** Best-effort plugin name for a fiber (entry name first, runtime name second). */
function fiberPluginName(fiber) {
  try {
    return fiber.entry?.options?.name ?? fiber.name ?? null;
  } catch {
    return null;
  }
}

/** Normalize an identifier to comparable word stems: "tool-fs-search" ->
 * ["tool","fs","search"], "tool:glob" -> ["tool","glob"], "get_goal" ->
 * ["get","goal"]. Scope prefixes like @deepseek-ai/dsh- are shed first. */
function stems(identifier) {
  return String(identifier)
    .replace(/^@[^/]+\//, '')
    .replace(/^dsh-/, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Does the name plausibly belong to the fiber? True when they share any
 * non-generic stem ("tool"/"get"/"list" alone prove nothing). */
const GENERIC_STEMS = new Set(['tool', 'tools', 'get', 'set', 'list', 'run', 'app', 'dsh']);
function affine(name, fiberName) {
  const ns = stems(name);
  const fibers = new Set(stems(fiberName));
  return ns.some((s) => !GENERIC_STEMS.has(s) && fibers.has(s));
}

/**
 * Attribute pre-existing names to carrier fibers by stem affinity, accepting
 * a fiber's assignment only when its matched-name count reconciles exactly
 * with its labeled-effect count (so a partial or over-broad match assigns
 * nothing rather than something wrong).
 * @returns Map<name, pluginName> for the names that reconciled.
 */
function baselineByAffinity(names, carriers, counts) {
  const assigned = new Map();
  const claims = new Map(); // fiber -> names it matches
  for (const fiber of carriers) {
    const fname = fiberPluginName(fiber);
    if (!fname) continue;
    const mine = [...names].filter((n) => !assigned.has(n) && affine(n, fname));
    claims.set(fiber, mine);
  }
  // A name claimed by two fibers is ambiguous everywhere it appears: drop it.
  const claimCount = new Map();
  for (const mine of claims.values())
    for (const n of mine) claimCount.set(n, (claimCount.get(n) ?? 0) + 1);
  for (const [fiber, mine] of claims) {
    const unambiguous = mine.filter((n) => claimCount.get(n) === 1);
    if (unambiguous.length > 0 && unambiguous.length === (counts.get(fiber) ?? 0)) {
      const fname = fiberPluginName(fiber);
      for (const n of unambiguous) assigned.set(n, fname);
    }
  }
  return assigned;
}

/**
 * Install one diff-based attribution observer.
 * @param ctx - the mounted plugin's context (reaches registry + events).
 * @param spec - { event, effectLabel, names } where `names(ctx)` reads the
 * registry's current global-layer name set.
 * @returns { table, dispose } — `table` is a live Map<name, pluginName|null>.
 */
function installAttribution(ctx, spec) {
  const table = new Map();
  const fibers = new Set();
  const counts = new Map(); // fiber -> last seen labeled-effect count

  try {
    for (const runtime of ctx.registry.values()) {
      for (const fiber of runtime.fibers) fibers.add(fiber);
    }
  } catch {
    /* registry unreadable: event stream alone still works */
  }
  const disposePlugin = ctx.on('internal/plugin', (fiber) => {
    try {
      fibers.add(fiber);
    } catch {
      /* never break the host */
    }
  });

  // Baseline: entries registered before observation started. The diff trick
  // cannot see the past, but the effect COUNTS per fiber survive: a fiber
  // carrying N labeled effects registered exactly N of the pre-existing
  // names. Names follow strong conventions (fiber "tool-goal" registers
  // section "tool:goal" and tools "get_goal"/"create_goal"/...), so match
  // names to fibers by normalized-stem affinity — and accept a fiber's
  // matches ONLY when their count equals that fiber's effect count exactly
  // (per-fiber bookkeeping must reconcile). Anything left over stays null
  // (`unattributed`) rather than guessed.
  let prevNames = spec.names(ctx);
  const carriers = [];
  for (const fiber of fibers) {
    const count = labeledEffectCount(fiber, spec.effectLabel);
    counts.set(fiber, count);
    if (count > 0) carriers.push(fiber);
  }
  if (carriers.length === 1) {
    for (const name of prevNames) table.set(name, fiberPluginName(carriers[0]));
  } else {
    const assigned = baselineByAffinity(prevNames, carriers, counts);
    for (const name of prevNames) table.set(name, assigned.get(name) ?? null);
  }

  const disposeChange = ctx.on(spec.event, () => {
    try {
      const names = spec.names(ctx);
      const added = [...names].filter((n) => !prevNames.has(n));
      const removed = [...prevNames].filter((n) => !names.has(n));
      const registrants = [];
      for (const fiber of fibers) {
        const now = labeledEffectCount(fiber, spec.effectLabel);
        const before = counts.get(fiber) ?? 0;
        if (now > before) registrants.push(fiber);
        counts.set(fiber, now);
      }
      // One grown fiber owns every added name in this tick (change fires per
      // registration); multiple grown fibers between coalesced ticks would
      // be ambiguous — attribute only the unambiguous case.
      for (const name of added) {
        table.set(name, registrants.length === 1 ? fiberPluginName(registrants[0]) : null);
      }
      for (const name of removed) table.delete(name);
      prevNames = names;
    } catch {
      /* diagnostics must never break the host path */
    }
  });

  return {
    table,
    dispose: () => {
      disposePlugin();
      disposeChange();
    },
  };
}

/** All names across the global layer plus every scoped overlay. Tool plugins
 * mount under each agent's scope (agent-presets refuses unscoped mounts), so
 * the global layer alone misses every per-agent registration. */
function allLayerNames(layers, pick) {
  const names = new Set();
  if (!layers) return names;
  try {
    for (const key of pick(layers.global)?.keys() ?? []) names.add(key);
    for (const layer of layers.scoped?.values() ?? []) {
      for (const key of pick(layer)?.keys() ?? []) names.add(key);
    }
  } catch {
    /* layer shape drifted: return what we saw */
  }
  return names;
}

/** Prompt section names (global + every agent scope). */
function sectionNames(ctx) {
  try {
    return allLayerNames(ctx.get?.('systemPrompt')?.layers, (layer) => layer?.sections);
  } catch {
    return new Set();
  }
}

/** Tool names (global + every agent scope). */
function toolNames(ctx) {
  try {
    return allLayerNames(ctx.get?.('tools')?.layers, (layer) => layer?.tools);
  } catch {
    return new Set();
  }
}

/**
 * Install both attribution observers (sections + tools).
 * @returns { sections, tools, dispose } — two live Map<name, plugin|null>.
 */
function installSectionAttribution(ctx) {
  const sections = installAttribution(ctx, {
    event: 'system-prompt/change',
    effectLabel: 'systemPrompt.section()',
    names: sectionNames,
  });
  const tools = installAttribution(ctx, {
    event: 'tools/change',
    effectLabel: 'tools.register()',
    names: toolNames,
  });
  return {
    table: sections.table,
    toolTable: tools.table,
    dispose: () => {
      sections.dispose();
      tools.dispose();
    },
  };
}

module.exports = { installSectionAttribution, installAttribution, labeledEffectCount };
