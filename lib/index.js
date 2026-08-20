'use strict';

const name = 'dsh-xray';

/**
 * dsh-xray — X-ray for your DeepSeek Harness.
 *
 * 0.1.x: static imaging ships in the CLI (bin/xray.js) — layer attribution,
 * declared-vs-actual diff, conflict detection, composition snapshot.
 * This Cordis entry is a mount point; runtime imaging (dependency graph,
 * health, context cost, agent self-introspection) lands here in 0.2.0.
 */
function apply(ctx) {
  ctx.logger(name).info('dsh-xray mounted; run `npx dsh-xray` for static composition imaging (runtime imaging lands in 0.2.0)');
}

module.exports = { name, apply };
module.exports.default = module.exports;
