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
  };
}

module.exports = { snapshotRegistry, injectNames, provideNames, stateName };
