// Request ledger: observe the `llm/stream` waterfall and record ONE
// classified bill per LLM call — system prompt, tool schemas, conversation
// history, tool results — plus prefix stability. Purely observational: the
// options object passes through `next()` untouched, and nothing but counts,
// names, and hashes is retained (never message text).
//
// Every request in the process flows through here: main sessions, subagents,
// compaction and title calls (tagged by `purpose`). Entries bucket per
// sessionId in a bounded ring so one fan-out cannot evict another session's
// history.

const crypto = require('node:crypto');

/** Rough token estimate mirroring collect/runtime.js (~4 chars/token). */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/** Serialize one content block to its model-facing text size, recursively. */
function blockChars(block) {
  if (!block || typeof block !== 'object') return 0;
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return String(block.text ?? '').length;
    case 'image':
      // Images are billed by the provider in provider units; approximate by
      // the transported payload size so the ledger at least ranks them.
      return String(block.data ?? block.url ?? '').length;
    case 'tool-call':
      return String(block.name ?? '').length + String(block.arguments ?? '').length;
    case 'tool-result':
      return (block.content ?? []).reduce((sum, inner) => sum + blockChars(inner), 0);
    default:
      try {
        return JSON.stringify(block).length;
      } catch {
        return 0;
      }
  }
}

/** Short content hash for prefix-stability comparison (never stored text). */
function digest(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/**
 * Classify one GenerateOptions into the ledger entry. Tool results resolve
 * their tool name through the preceding assistant tool-call blocks.
 */
function classify(options) {
  const system = String(options.system ?? '');
  const toolsJson = JSON.stringify(options.tools ?? []);
  const callNames = new Map(); // callId -> tool name
  let historyChars = 0;
  let historyMessages = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  const toolResults = new Map(); // tool name -> {count, chars}
  for (const message of options.messages ?? []) {
    const content = message.content ?? [];
    for (const block of content) {
      if (block?.type === 'tool-call') callNames.set(block.id, block.name);
    }
    const isToolResult =
      message.source?.kind === 'tool' || content.some((b) => b?.type === 'tool-result');
    const chars = content.reduce((sum, block) => sum + blockChars(block), 0);
    if (isToolResult) {
      let name = 'unknown';
      for (const block of content) {
        if (block?.type === 'tool-result') {
          name = callNames.get(block.toolCallId) ?? 'unknown';
          break;
        }
      }
      const row = toolResults.get(name) ?? { count: 0, chars: 0 };
      row.count += 1;
      row.chars += chars;
      toolResults.set(name, row);
    } else {
      historyChars += chars;
      historyMessages += 1;
      if (message.role === 'user') userMessages += 1;
      else if (message.role === 'assistant') assistantMessages += 1;
    }
  }
  const toolResultRows = [...toolResults.entries()]
    .map(([name, row]) => ({
      name,
      count: row.count,
      tokens: estimateTokens(' '.repeat(row.chars)),
    }))
    .sort((a, b) => b.tokens - a.tokens);
  const toolResultTokens = toolResultRows.reduce((sum, r) => sum + r.tokens, 0);
  const entry = {
    at: Date.now(),
    provider: options.provider ?? null,
    model: options.model ?? null,
    purpose: options.purpose ?? null,
    system: estimateTokens(system),
    toolSchemas: estimateTokens(toolsJson),
    toolCount: (options.tools ?? []).length,
    history: estimateTokens(' '.repeat(historyChars)),
    historyMessages,
    userMessages,
    assistantMessages,
    toolResults: toolResultTokens,
    toolResultRows: toolResultRows.slice(0, 8),
    prefixDigest: digest(system + '\u0000' + toolsJson),
  };
  entry.total = entry.system + entry.toolSchemas + entry.history + entry.toolResults;
  return entry;
}

/**
 * Install the ledger observer.
 * @param ctx - the mounted plugin's context.
 * @param options - { maxPerSession } ring bound (default 50).
 * @returns { sessions, dispose } — sessions: Map<sessionId, entries[]>.
 */
function installRequestLedger(ctx, options = {}) {
  const maxPerSession = options.maxPerSession ?? 50;
  const sessions = new Map(); // sessionId -> [entry, ...] (oldest first)
  const dispose = ctx.on('llm/stream', (generateOptions, next) => {
    try {
      const key = String(generateOptions.sessionId ?? 'unscoped');
      const entry = classify(generateOptions);
      const ring = sessions.get(key) ?? [];
      const prev = ring[ring.length - 1];
      entry.prefixStable = prev === undefined ? null : prev.prefixDigest === entry.prefixDigest;
      entry.deltaTotal = prev === undefined ? null : entry.total - prev.total;
      ring.push(entry);
      if (ring.length > maxPerSession) ring.shift();
      sessions.set(key, ring);
      // Bound the session table itself: keep the most recently active 20.
      if (sessions.size > 20) {
        const oldest = [...sessions.entries()].sort(
          (a, b) => (a[1][a[1].length - 1]?.at ?? 0) - (b[1][b[1].length - 1]?.at ?? 0),
        )[0];
        if (oldest) sessions.delete(oldest[0]);
      }
    } catch {
      /* the ledger must never break a model call */
    }
    return next();
  });
  return { sessions, dispose };
}

module.exports = { installRequestLedger, classify, blockChars };
