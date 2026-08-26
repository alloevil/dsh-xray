// dsh-xray browser half. React panel registered as one conversation view tab
// (`conversation.view` list slot, beside Chat / Trajectory); data comes from
// the same-origin /xray/api/* endpoints the node half already serves, so this
// layer stays a thin renderer — every computation lives in lib/model.js.
//
// Skeleton note: authored directly in ModuleLoader factory form (plain
// React.createElement, no build step) to prove the wiring; migrate to
// src/client/*.tsx + tsdown once the surface stabilizes.
window.__ModuleLoader__.load({
  id: 'dsh-xray',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    const react = require('react');
    const h = react.createElement;

    //#region styles (host design tokens; auto-claimed by client-modules)
    const css = [
      // The panel owns its scrolling: the tab fills the host view area
      // (flex column, overflow on .xray-body) instead of growing inside the
      // host scrollport. View switches then change only the inner scroll
      // height — the page-level scroll position never jumps, however tall
      // deps/cost render. .xray-stale dims outgoing content while the next
      // payload is in flight.
      '.xray-panel{flex:1;min-height:0;display:flex;flex-direction:column;max-width:920px;width:100%;margin:0 auto;padding:16px 20px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.xray-body{flex:1;min-height:0;overflow-y:auto}',
      '.xray-stale{opacity:.45;transition:opacity .15s;pointer-events:none}',
      '.xray-sub{color:var(--dsw-alias-label-tertiary);margin:0 0 14px;font-size:12px}',
      '.xray-nav{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}',
      '.xray-nav button{font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 10px;cursor:pointer}',
      '.xray-nav button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      // active view: the host's own tab-active family (state-business-*) —
      // visible in both themes, unlike brand-primary which resolves to
      // near-white in dark mode (white-on-white active buttons).
      '.xray-nav button.active{color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary);border-color:var(--dsw-alias-state-business-primary);font-weight:600}',
      '.xray-table{border-collapse:collapse;width:100%;margin-top:6px}',
      '.xray-table th,.xray-table td{text-align:left;padding:4px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top}',
      '.xray-table th{color:var(--dsw-alias-label-tertiary);font-weight:normal}',
      '.xray-num{text-align:right}',
      '.xray-warn{color:var(--dsw-alias-state-error-primary,#f85149)}',
      '.xray-ok{color:var(--dsw-alias-state-success-primary,#3fb950)}',
      '.xray-muted{color:var(--dsw-alias-label-tertiary)}',
      '.xray-bar{background:var(--dsw-alias-state-business-primary);height:10px;border-radius:2px;display:inline-block}',
      '.xray-h3{font-size:13px;font-weight:600;margin:14px 0 4px}',
    ].join('\n');
    if (
      typeof document !== 'undefined' &&
      document.querySelector('style[data-plugin-css="dsh-xray/panel"]') === null
    ) {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-xray';
      tag.dataset.pluginCss = 'dsh-xray/panel';
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    //#endregion

    //#region tiny view primitives
    const VIEWS = ['summary', 'health', 'deps', 'cost', 'shadow'];
    function Table({ headers, rows }) {
      return h(
        'table',
        { className: 'xray-table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            headers.map((head, i) => h('th', { key: i }, head)),
          ),
        ),
        h('tbody', null, rows),
      );
    }
    function Bar({ share }) {
      return h('span', { className: 'xray-bar', style: { width: `${Math.max(2, share * 2)}px` } });
    }
    function Row(key, cells) {
      return h(
        'tr',
        { key },
        cells.map((cell, i) =>
          h(
            'td',
            { key: i, className: cell?.cls ? cell.cls : void 0 },
            cell && cell.cls !== void 0 ? cell.text : cell,
          ),
        ),
      );
    }
    //#endregion

    //#region per-view renderers (mirror lib/panel.js, as components)
    const renderers = {
      summary: (d) =>
        h(
          react.Fragment,
          null,
          h(Table, {
            headers: ['metric', 'value'],
            rows: [
              Row('p', ['plugins mounted', { cls: 'xray-num', text: String(d.plugins) }]),
              Row('u', [
                'unhealthy',
                {
                  cls: `xray-num ${d.unhealthy ? 'xray-warn' : 'xray-ok'}`,
                  text: String(d.unhealthy),
                },
              ]),
              Row('s', ['services', { cls: 'xray-num', text: String(d.services) }]),
              Row('t', [
                'context tokens (tools + sections)',
                { cls: 'xray-num', text: `~${d.toolSchemaTokens}` },
              ]),
            ],
          }),
          h('p', { className: 'xray-muted', style: { marginTop: 12 } }, `captured ${d.capturedAt}`),
        ),

      health: (d) =>
        h(
          react.Fragment,
          null,
          h(
            'p',
            null,
            h('span', { className: 'xray-ok' }, `${d.healthy.length} healthy`),
            d.waiting.length ? ` · ${d.waiting.length} waiting` : null,
            d.unhealthy.length
              ? h(
                  react.Fragment,
                  null,
                  ' · ',
                  h('span', { className: 'xray-warn' }, `${d.unhealthy.length} unhealthy`),
                )
              : null,
          ),
          d.unhealthy.length
            ? h(Table, {
                headers: ['plugin', 'fiber', 'state', 'error'],
                rows: d.unhealthy.flatMap((p) =>
                  p.fibers.map((f) =>
                    Row(`${p.name}/${f.uid}`, [
                      p.name,
                      { cls: 'xray-num', text: String(f.uid) },
                      { cls: 'xray-warn', text: f.state },
                      f.error ?? '',
                    ]),
                  ),
                ),
              })
            : null,
          d.waiting.length
            ? h(Table, {
                headers: ['waiting plugin', 'wants'],
                rows: d.waiting.map((p) => Row(p.name, [p.name, p.inject.join(', ')])),
              })
            : null,
        ),

      deps: (d) =>
        h(
          react.Fragment,
          null,
          d.unsatisfied.length
            ? h('p', { className: 'xray-warn' }, `${d.unsatisfied.length} unsatisfied inject(s)`)
            : null,
          Object.keys(d.cascade).length
            ? h(
                react.Fragment,
                null,
                h('div', { className: 'xray-h3' }, 'disable-cascade'),
                h(Table, {
                  headers: ['provider', 'affects'],
                  rows: Object.entries(d.cascade).map(([provider, affected]) =>
                    Row(provider, [provider, affected.join(', ')]),
                  ),
                }),
              )
            : null,
          h('div', { className: 'xray-h3' }, 'services'),
          h(Table, {
            headers: ['service', 'provided by', 'consumed by'],
            rows: Object.entries(d.services).map(([name, node]) =>
              Row(name, [name, node.providers.join(', ') || '—', node.consumers.join(', ') || '—']),
            ),
          }),
        ),

      cost: (d) =>
        h(
          react.Fragment,
          null,
          h(
            'p',
            null,
            `~${d.totalTokens} tokens: ${d.toolCount} tool schema(s) ~${d.toolTokens} + ${d.sectionCount} prompt section(s) ~${d.sectionTokens}`,
          ),
          d.sections.length
            ? h(
                react.Fragment,
                null,
                h('div', { className: 'xray-h3' }, 'prompt sections'),
                h(Table, {
                  headers: ['section', 'tokens', 'share', ''],
                  rows: d.sections.map((s) =>
                    Row(s.name, [
                      s.name,
                      { cls: 'xray-num', text: `~${s.tokens}` },
                      { cls: 'xray-num', text: `${s.share}%` },
                      h(Bar, { share: s.share }),
                    ]),
                  ),
                }),
              )
            : h(
                'p',
                { className: 'xray-muted' },
                'no prompt assembly observed yet — send one agent message first',
              ),
          h('div', { className: 'xray-h3' }, 'tool schemas'),
          h(Table, {
            headers: ['tool', 'tokens', 'share', ''],
            rows: d.tools.map((t) =>
              Row(t.name, [
                t.name,
                { cls: 'xray-num', text: `~${t.tokens}` },
                { cls: 'xray-num', text: `${t.share}%` },
                h(Bar, { share: t.share }),
              ]),
            ),
          }),
        ),

      shadow: (d) =>
        h(
          react.Fragment,
          null,
          d.services.length
            ? h(Table, {
                headers: ['service', 'providers'],
                rows: d.services.map((s) =>
                  Row(s.service, [
                    s.service,
                    { cls: 'xray-warn', text: s.providers.join(' AND ') },
                  ]),
                ),
              })
            : h('p', { className: 'xray-ok' }, 'no service is provided by more than one plugin'),
          d.registrars.length
            ? h(
                react.Fragment,
                null,
                h('div', { className: 'xray-h3' }, 'registrars'),
                h(Table, {
                  headers: ['plugin', 'registrations'],
                  rows: d.registrars.map((r) =>
                    Row(r.plugin, [r.plugin, { cls: 'xray-num', text: String(r.registrations) }]),
                  ),
                }),
              )
            : null,
        ),
    };
    //#endregion

    //#region panel (one conversation.view tab)
    function XrayPanel() {
      const [view, setView] = react.useState('summary');
      // `for` stamps which view the payload belongs to: a click flips `view`
      // synchronously while `state` still carries the previous view's data —
      // rendering that mismatch with the new renderer throws and unmounts
      // the whole tab. During the switch the previous view's content stays
      // up (dimmed) and is replaced in one paint when the payload lands, so
      // the layout changes once per click instead of collapsing to a
      // one-line loading row and re-expanding.
      const [state, setState] = react.useState({ phase: 'loading', for: 'summary' });
      react.useEffect(() => {
        let alive = true;
        fetch(`/xray/api/${view}`)
          .then(async (res) => {
            if (!res.ok) throw new Error(await res.text());
            return res.json();
          })
          .then((data) => {
            if (alive) setState({ phase: 'ready', for: view, data });
          })
          .catch((err) => {
            if (alive)
              setState({
                phase: 'error',
                for: view,
                message: err instanceof Error ? err.message : String(err),
              });
          });
        return () => {
          alive = false;
        };
      }, [view]);
      // Render whatever payload we HAVE (state.for), not the view the user
      // just requested — the stale content keeps the scaffold stable while
      // the fresh payload is in flight.
      const settled = state.phase !== 'loading';
      let body;
      if (!settled) body = h('p', { className: 'xray-muted' }, `loading ${view}…`);
      else if (state.phase === 'error') body = h('p', { className: 'xray-warn' }, state.message);
      else {
        // A diagnostic surface must never take itself down on one bad
        // payload: render the failure, keep the tab and its nav alive.
        try {
          body = renderers[state.for](state.data);
        } catch (err) {
          body = h(
            'p',
            { className: 'xray-warn' },
            `render failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      const stale = settled && state.for !== view;
      return h(
        'div',
        { className: 'xray-panel' },
        h('p', { className: 'xray-sub' }, 'composition X-ray — live from this harness'),
        h(
          'nav',
          { className: 'xray-nav' },
          VIEWS.map((name) =>
            h(
              'button',
              { key: name, className: name === view ? 'active' : '', onClick: () => setView(name) },
              name,
            ),
          ),
        ),
        h('div', { className: stale ? 'xray-body xray-stale' : 'xray-body' }, body),
      );
    }
    //#endregion

    const inject = ['slots'];
    /** Mount the X-ray tab into the conversation view ring (beside Chat / Trajectory). */
    function apply(ctx) {
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          { name: 'conversation.view', id: 'xray', order: 20, label: 'X-ray' },
          XrayPanel,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
