// Runtime collector: snapshots the live Cordis registry from inside a
// mounted plugin. Output is plain JSON, written for the CLI to read.

/** Normalize an inject declaration (array | object | null) to a name list. */
function injectNames(inject) {
  if (!inject) return [];
  if (Array.isArray(inject)) return [...inject];
  // Object form may carry a prototype chain (class-inherited); walk own+proto keys.
  const names = new Set();
  for (let o = inject; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const k of Object.keys(o)) names.add(k);
  }
  return [...names];
}

function provideNames(provide) {
  if (!provide) return [];
  return Array.isArray(provide) ? [...provide] : [provide];
}

// Cordis Fiber.State enum (vendor/cordis/src/fiber.ts): numeric values.
const STATE_NAMES = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'];

function stateName(state) {
  return STATE_NAMES[state] ?? String(state);
}

/** Serialize one fiber defensively: never let a bad fiber break the snapshot. */
function fiberInfo(fiber) {
  const info = { uid: null, state: null, error: null, effects: [] };
  try {
    info.uid = fiber.uid;
    info.state = stateName(fiber.state);
  } catch (err) {
    info.error = `state unreadable: ${err.message}`;
  }
  try {
    const effects = fiber.getEffects?.();
    if (Array.isArray(effects)) {
      info.effects = effects.map((e) => summarizeEffect(e)).filter(Boolean);
    }
  } catch (err) {
    info.error = info.error ?? `effects unreadable: ${err.message}`;
  }
  return info;
}

function summarizeEffect(meta, depth = 0) {
  if (!meta || depth > 3) return null;
  const out = { label: meta.label ?? null };
  const children = Array.isArray(meta.children)
    ? meta.children.map((c) => summarizeEffect(c, depth + 1)).filter(Boolean)
    : [];
  if (children.length) out.children = children;
  return out;
}

/** Rough token estimate: ~4 chars per token for English/JSON. */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/** Capture the model-facing tool schemas (name/description/parameters).
 * Tool plugins mount under each agent's scope (agent-presets refuses
 * unscoped mounts), so `schemas()` on the global view alone misses them:
 * walk the global layer plus every scoped overlay and dedupe by name. */
function snapshotTools(ctx) {
  try {
    const tools = ctx.get?.('tools') ?? ctx.root?.tools;
    if (!tools) return [];
    const byName = new Map();
    const harvest = (definitions) => {
      for (const [name, definition] of definitions?.entries() ?? []) {
        if (byName.has(name)) continue;
        byName.set(name, {
          name,
          description: definition.description ?? '',
          tokens: estimateTokens(
            JSON.stringify({
              name,
              description: definition.description ?? '',
              parameters: definition.parameters ?? {},
            }),
          ),
        });
      }
    };
    harvest(tools.layers?.global?.tools);
    for (const layer of tools.layers?.scoped?.values() ?? []) harvest(layer.tools);
    if (byName.size > 0) return [...byName.values()];
    // Layer shape drifted: fall back to the public global-view projection.
    const schemas = tools.schemas?.();
    if (!Array.isArray(schemas)) return [];
    return schemas.map((s) => ({
      name: s.name,
      description: s.description ?? '',
      tokens: estimateTokens(JSON.stringify(s)),
    }));
  } catch {
    return [];
  }
}

/**
 * Snapshot every registered plugin runtime plus the service store.
 * @param ctx a live Cordis context (any fiber's ctx reaches the shared registry)
 */
function snapshotRegistry(ctx) {
  const plugins = [];
  for (const runtime of ctx.registry.values()) {
    const cb = runtime.callback;
    plugins.push({
      name: runtime.name ?? cb?.name ?? null,
      inject: injectNames(cb?.inject),
      provide: provideNames(cb?.provide),
      fibers: [...runtime.fibers].map(fiberInfo),
    });
  }

  // Service implementations live in the root reflect store (Impl records),
  // not on plugin callbacks: Service subclasses provide via ctx.provide().
  // The store is keyed by isolation-label symbols; values are Impl records.
  const services = [];
  try {
    const store = ctx.root?.reflect?.store ?? ctx.reflect?.store;
    if (store) {
      for (const key of [...Object.getOwnPropertySymbols(store), ...Object.keys(store)]) {
        const impl = store[key];
        if (!impl?.name) continue;
        let provider = null;
        try {
          provider = impl.fiber?.name ?? null;
        } catch {
          /* disposed fiber */
        }
        services.push({ name: impl.name, provider });
      }
    }
  } catch {
    /* reflect layout changed; plugins alone still work */
  }

  return {
    schema: 'dsh-xray/runtime@1',
    capturedAt: new Date().toISOString(),
    registrySize: ctx.registry.size,
    plugins,
    services,
    tools: snapshotTools(ctx),
  };
}

/**
 * Read ONE entry's live text on demand (never persisted): the answer to
 * "what exactly is this ~N tokens?". Sections resolve their text (static
 * string or provider function called with an empty context); tools return
 * the full model-facing schema. Reads the same layers attribution reads.
 * @returns { kind, name, text, chars, tokens, estimator } or null when absent.
 */
function snapshotEntry(ctx, kind, name) {
  const found = (text) => ({
    kind,
    name,
    text,
    chars: text.length,
    tokens: estimateTokens(text),
    estimator: '~4 chars/token',
  });
  const firstAcrossLayers = (layers, pick) => {
    let value = pick(layers.global);
    if (value !== undefined) return value;
    for (const layer of layers.scoped?.values() ?? []) {
      value = pick(layer);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  try {
    if (kind === 'section') {
      const layers = ctx.get?.('systemPrompt')?.layers;
      if (!layers) return null;
      const section = firstAcrossLayers(layers, (layer) => layer?.sections?.get?.(name));
      if (!section) return null;
      const text = typeof section.text === 'function' ? section.text({}) : section.text;
      return found(String(text ?? ''));
    }
    if (kind === 'tool') {
      const layers = ctx.get?.('tools')?.layers;
      if (!layers) return null;
      const definition = firstAcrossLayers(layers, (layer) => layer?.tools?.get?.(name));
      if (!definition) return null;
      return found(
        JSON.stringify(
          {
            name: definition.name,
            description: definition.description ?? '',
            parameters: definition.parameters ?? {},
          },
          null,
          2,
        ),
      );
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = {
  snapshotRegistry,
  snapshotTools,
  snapshotEntry,
  injectNames,
  provideNames,
  stateName,
  estimateTokens,
};
