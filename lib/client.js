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
      // entry inspection: clickable names + a centered modal with the raw text
      '.xray-entry-link{font:inherit;color:var(--dsw-alias-state-business-primary);background:none;border:none;padding:0;cursor:pointer;text-align:left}',
      '.xray-entry-link:hover{text-decoration:underline}',
      '.xray-entry-overlay{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}',
      '.xray-entry-modal{width:min(760px,90vw);max-height:80vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px 20px}',
      '.xray-entry-head{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}',
      '.xray-entry-name{font-weight:600;word-break:break-all}',
      '.xray-entry-stats{color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.xray-entry-close{margin-left:auto;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:2px 10px;cursor:pointer}',
      '.xray-entry-text{flex:1;min-height:0;overflow:auto;margin:0;padding:12px;background:var(--dsw-alias-bg-layer-3);border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}',
      '.xray-owner-entry{display:inline-block;padding-left:22px}',
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
    const VIEWS = ['summary', 'health', 'deps', 'cost', 'shadow', 'skills', 'requests'];
    const NS = 'xray';

    /** English messages (also the key vocabulary; zh mirrors every key). */
    const en = {
      'view.xray': 'X-Ray',
      'panel.sub': 'composition X-ray — live from this harness',
      'panel.loading': 'loading {view}…',
      'panel.renderFailed': 'render failed: {message}',
      // one question per view: what am I looking at, what does trouble look like?
      'intro.summary':
        'Composition at a glance. A non-zero "unhealthy" count means some plugin failed to start — see the health view.',
      'intro.health':
        'Plugin lifecycle. "Waiting" plugins declared a dependency that no active plugin provides yet; "unhealthy" fibers failed to start and their features are absent.',
      'intro.deps':
        'Who provides and consumes each service. The disable-cascade table answers: if I disable this plugin, which dependents stop working with it?',
      'intro.cost':
        'What every LLM request carries before your message: prompt sections + tool schemas, attributed to the plugin that registered each. "By plugin" is each plugin\'s per-request context tax.',
      'intro.shadow':
        'Same-name registrations. A service provided by two plugins means one silently wins — usually intended (an override), occasionally a conflict.',
      // hover glossary (native title tooltips), keyed by column header
      'tip.share':
        'Percentage of the total estimated context (sections + tool schemas) this row costs on every request',
      'tip.tokens': 'Rough estimate: ~4 characters per token',
      'tip.owner': 'The plugin whose registration put this entry into the context',
      'tip.unattributed':
        'Registered before dsh-xray mounted and not reconcilable to a single plugin — mount dsh-xray earlier in the profile to shrink this row',
      'tip.wants':
        'Services this plugin declared via inject that are not (yet) provided by any active plugin',
      'tip.fiber': 'One mounted instance of the plugin (a Cordis fiber uid)',
      'tip.state': 'Cordis lifecycle state: ACTIVE is healthy; FAILED means apply() threw',
      'tip.affects': 'Transitive consumers: disabling the provider takes these down with it',
      'tip.providers':
        'Every plugin claiming this service name; the last one to load wins silently',
      'tip.registrations':
        'How many tools/commands this plugin registered on the shared registries',
      'tip.sections': 'Prompt sections this plugin contributes to the system prompt',
      'tip.tools': 'Tool schemas this plugin registers (each costs context on every request)',
      // column headers / row labels
      'col.metric': 'metric',
      'col.value': 'value',
      'col.plugin': 'plugin',
      'col.fiber': 'fiber',
      'col.state': 'state',
      'col.error': 'error',
      'col.waitingPlugin': 'waiting plugin',
      'col.wants': 'wants',
      'col.service': 'service',
      'col.providedBy': 'provided by',
      'col.consumedBy': 'consumed by',
      'col.provider': 'provider',
      'col.affects': 'affects',
      'col.section': 'section',
      'col.tool': 'tool',
      'col.owner': 'owner',
      'col.tokens': 'tokens',
      'col.share': 'share',
      'col.sections': 'sections',
      'col.tools': 'tools',
      'col.providers': 'providers',
      'col.registrations': 'registrations',
      'row.pluginsMounted': 'plugins mounted',
      'row.unhealthy': 'unhealthy',
      'row.services': 'services',
      'row.contextTokens': 'context tokens (tools + sections)',
      'summary.captured': 'captured {at}',
      'health.healthy': '{n} healthy',
      'health.waiting': '{n} waiting',
      'health.unhealthy': '{n} unhealthy',
      'deps.unsatisfied':
        '{n} unsatisfied inject(s) — these plugins wait forever unless a provider is added',
      'h3.disableCascade': 'disable-cascade',
      'h3.services': 'services',
      'h3.byPlugin': 'by plugin',
      'h3.promptSections': 'prompt sections',
      'h3.toolSchemas': 'tool schemas',
      'h3.registrars': 'registrars',
      'cost.headline':
        '~{total} tokens: {toolCount} tool schema(s) ~{toolTokens} + {sectionCount} prompt section(s) ~{sectionTokens}',
      'cost.noAssembly': 'no prompt assembly observed yet — send one agent message first',
      'cost.unattributed': 'unattributed',
      'shadow.clean': 'no service is provided by more than one plugin',
      'intro.skills':
        'What each skill costs: its catalog line rides every request once any model-invocable skill exists; its body is billed only when loaded. Pricing only — to enable/disable skills, use a skill manager.',
      'tip.catalog':
        "Tokens of this skill's line in the durable session catalog, carried on every request",
      'tip.body':
        'Tokens of the full rendered skill body, billed per load and then resident in history',
      'tip.invocable':
        'Whether the model may load this skill itself; user-only skills stay out of the catalog',
      'col.skill': 'skill',
      'col.provider2': 'provider',
      'col.catalog': 'catalog',
      'col.body': 'body',
      'col.invocable': 'invocable',
      'skills.summary':
        '{count} skill(s), {invocable} model-invocable · resident catalog ~{resident} tokens (~{entries} entries + ~{framing} framing) on every request',
      'skills.none':
        'no skill observation yet — the skills service is absent or discovery has not run',
      'skills.yes': 'yes',
      'skills.userOnly': 'user-only',
      'intro.requests':
        'One bill per LLM call, newest first: system + tool schemas + history + tool results. ⚡ = the system/tools prefix matched the previous request (cache-friendly); ✂ = the prefix changed. Δ is the total against the previous request.',
      'col.seq': '#',
      'col.when': 'when',
      'col.purpose': 'purpose',
      'col.total': 'total',
      'col.system': 'system',
      'col.toolSchemas2': 'tools',
      'col.history': 'history',
      'col.results': 'results',
      'col.prefix': 'prefix',
      'col.delta': 'Δ',
      'tip.total': 'Estimated tokens of the whole request payload (~4 chars/token)',
      'tip.history': 'Conversation messages (user + assistant), excluding tool results',
      'tip.results': 'Tool-result messages, aggregated per tool (hover a cell for the top tools)',
      'tip.prefix':
        'Whether system prompt + tool schemas were byte-identical to the previous request in this session (⚡ cache-friendly, ✂ prefix broken)',
      'requests.none': 'no requests observed yet — send one agent message first',
      'requests.session': 'session {id} ({n} request(s))',
      'requests.chat': 'chat',
      'entry.loading': 'loading entry…',
      'entry.stats': '{chars} chars · ~{tokens} tokens ({estimator})',
      'entry.close': 'close',
      'tip.clickEntry': 'Click to view the exact text this entry puts into every request',
      'tip.expandPlugin':
        'A plugin has no single text — its cost is the sum of the entries it registered; click to unfold them',
      'tip.contextTokens':
        'Estimated tokens every request carries before your message — see the cost view for the full breakdown',
    };

    /** Simplified Chinese mirror of every en key. */
    const zh = {
      'view.xray': 'X 光',
      'panel.sub': '组合 X 光——实时来自当前 harness',
      'panel.loading': '正在加载 {view}…',
      'panel.renderFailed': '渲染失败:{message}',
      'intro.summary': '组合总览。"unhealthy" 非零表示有插件启动失败——去 health 视图查看。',
      'intro.health':
        '插件生命周期。"waiting" 表示插件声明的依赖服务尚无活跃提供者;"unhealthy" 表示 fiber 启动失败,其功能缺失。',
      'intro.deps':
        '每个服务由谁提供、被谁消费。disable-cascade 表回答:禁用某插件后,哪些依赖它的插件会随之失效?',
      'intro.cost':
        '每次 LLM 请求在你的消息之前携带的内容:prompt sections + 工具 schema,并归因到注册它们的插件。"by plugin" 是每个插件的每请求上下文税。',
      'intro.shadow':
        '同名注册。一个服务被两个插件同时提供意味着有一方静默胜出——通常是有意覆盖,偶尔是冲突。',
      'tip.share': '本行在每次请求中占估算总上下文(sections + 工具 schema)的百分比',
      'tip.tokens': '粗略估算:约 4 个字符折合 1 token',
      'tip.owner': '把这个条目注入上下文的插件',
      'tip.unattributed':
        '在 dsh-xray 挂载之前注册、无法唯一归因到某个插件——把 dsh-xray 在 profile 中提前挂载可缩小此行',
      'tip.wants': '该插件通过 inject 声明、但当前没有任何活跃插件提供的服务',
      'tip.fiber': '插件的一个挂载实例(Cordis fiber uid)',
      'tip.state': 'Cordis 生命周期状态:ACTIVE 为健康;FAILED 表示 apply() 抛出了异常',
      'tip.affects': '传递消费者:禁用该提供者会连带使这些插件失效',
      'tip.providers': '声明提供此服务的全部插件;后加载者静默胜出',
      'tip.registrations': '该插件在共享注册表上注册的工具/命令数量',
      'tip.sections': '该插件贡献给 system prompt 的 sections',
      'tip.tools': '该插件注册的工具 schema(每个都在每次请求中占用上下文)',
      'col.metric': '指标',
      'col.value': '值',
      'col.plugin': '插件',
      'col.fiber': 'fiber',
      'col.state': '状态',
      'col.error': '错误',
      'col.waitingPlugin': '等待中的插件',
      'col.wants': '等待的服务',
      'col.service': '服务',
      'col.providedBy': '提供者',
      'col.consumedBy': '消费者',
      'col.provider': '提供者',
      'col.affects': '波及',
      'col.section': 'section',
      'col.tool': '工具',
      'col.owner': '归属',
      'col.tokens': 'tokens',
      'col.share': '占比',
      'col.sections': 'sections',
      'col.tools': '工具',
      'col.providers': '提供者',
      'col.registrations': '注册数',
      'row.pluginsMounted': '已挂载插件',
      'row.unhealthy': '不健康',
      'row.services': '服务',
      'row.contextTokens': '上下文 tokens(工具 + sections)',
      'summary.captured': '采集于 {at}',
      'health.healthy': '{n} 个健康',
      'health.waiting': '{n} 个等待中',
      'health.unhealthy': '{n} 个不健康',
      'deps.unsatisfied': '{n} 个未满足的 inject——除非补上提供者,这些插件将永远等待',
      'h3.disableCascade': '停用级联',
      'h3.services': '服务',
      'h3.byPlugin': '按插件',
      'h3.promptSections': 'prompt sections',
      'h3.toolSchemas': '工具 schema',
      'h3.registrars': '注册方',
      'cost.headline':
        '约 {total} tokens:{toolCount} 个工具 schema 约 {toolTokens} + {sectionCount} 个 prompt section 约 {sectionTokens}',
      'cost.noAssembly': '尚未观测到 prompt 装配——先发送一条 agent 消息',
      'cost.unattributed': '未归因',
      'shadow.clean': '没有服务被多个插件同时提供',
      'intro.skills':
        '每个 skill 的价格:只要存在模型可调用的 skill,它的 catalog 行就随每次请求发送;正文只在加载时计费。这里只计价——启用/禁用请使用 skill 管理器。',
      'tip.catalog': '该 skill 在持久会话 catalog 中那一行的 token,每次请求都携带',
      'tip.body': '完整渲染正文的 token,每次加载时计费,之后驻留在历史中',
      'tip.invocable': '模型能否自行加载该 skill;仅用户可调用的 skill 不进入 catalog',
      'col.skill': 'skill',
      'col.provider2': '提供者',
      'col.catalog': 'catalog 行',
      'col.body': '正文',
      'col.invocable': '可调用',
      'skills.summary':
        '{count} 个 skill,{invocable} 个模型可调用 · 常驻 catalog 约 {resident} tokens(条目约 {entries} + 框架约 {framing}),每次请求都携带',
      'skills.none': '尚无 skill 观测——skills 服务缺失或发现未运行',
      'skills.yes': '是',
      'skills.userOnly': '仅用户',
      'intro.requests':
        '每次 LLM 调用一张账单,最新在前:system + 工具 schema + 历史 + 工具结果。⚡ = system/工具前缀与上一请求逐字节一致(缓存友好);✂ = 前缀变了。Δ 为相对上一请求的总量增减。',
      'col.seq': '#',
      'col.when': '时间',
      'col.purpose': '用途',
      'col.total': '总量',
      'col.system': 'system',
      'col.toolSchemas2': '工具',
      'col.history': '历史',
      'col.results': '结果',
      'col.prefix': '前缀',
      'col.delta': 'Δ',
      'tip.total': '整个请求负载的估算 tokens(约 4 字符/token)',
      'tip.history': '对话消息(user + assistant),不含工具结果',
      'tip.results': '工具结果消息,按工具聚合(悬停单元格看 top 工具)',
      'tip.prefix':
        'system prompt + 工具 schema 是否与本会话上一请求逐字节一致(⚡ 缓存友好,✂ 前缀击穿)',
      'requests.none': '尚未观测到请求——先发送一条 agent 消息',
      'requests.session': '会话 {id}({n} 个请求)',
      'requests.chat': 'chat',
      'entry.loading': '正在加载条目…',
      'entry.stats': '{chars} 字符 · 约 {tokens} tokens({estimator})',
      'entry.close': '关闭',
      'tip.clickEntry': '点击查看该条目每次请求实际注入的完整文本',
      'tip.expandPlugin': '插件本身没有单一文本——它的成本是其注册的全部条目之和;点击展开这些条目',
      'tip.contextTokens': '每次请求在你的消息之前携带的估算 tokens——完整明细见 cost 视图',
    };

    /** Fill {placeholders}; the host t() resolves the key, we interpolate. */
    const fill = (text, vars) =>
      vars === undefined
        ? text
        : text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

    function Table({ headers, rows, t }) {
      return h(
        'table',
        { className: 'xray-table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            headers.map((head, i) =>
              h(
                'th',
                { key: i, title: head !== '' && en[`tip.${head}`] ? t(`tip.${head}`) : undefined },
                head === '' ? '' : t(`col.${head}`),
              ),
            ),
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

    /** Clickable entry name: opens the raw-text inspector for one entry. */
    function EntryLink({ kind, name, onInspect, t }) {
      return h(
        'button',
        {
          className: 'xray-entry-link',
          title: t('tip.clickEntry'),
          onClick: () => onInspect({ kind, name }),
        },
        name,
      );
    }

    /** By-plugin rollup with expandable rows: a plugin has no single text —
     * its cost is the SUM of the entries it registered, so clicking a row
     * unfolds those entries (each linking to its raw text). */
    function OwnersTable({ owners, onInspect, t }) {
      const [open, setOpen] = react.useState(() => new Set());
      const toggle = (plugin) =>
        setOpen((current) => {
          const next = new Set(current);
          if (next.has(plugin)) next.delete(plugin);
          else next.add(plugin);
          return next;
        });
      const rows = [];
      for (const o of owners) {
        const expanded = open.has(o.plugin);
        rows.push(
          Row(o.plugin, [
            h(
              'button',
              {
                className: 'xray-entry-link',
                title: t('tip.expandPlugin'),
                onClick: () => toggle(o.plugin),
              },
              `${expanded ? '▾' : '▸'} `,
              o.plugin === 'unattributed'
                ? h(
                    'span',
                    { className: 'xray-muted', title: t('tip.unattributed') },
                    t('cost.unattributed'),
                  )
                : o.plugin,
            ),
            { cls: 'xray-num', text: String(o.sections) },
            { cls: 'xray-num', text: String(o.tools) },
            { cls: 'xray-num', text: `~${o.tokens}` },
            { cls: 'xray-num', text: `${o.share}%` },
            h(Bar, { share: o.share }),
          ]),
        );
        if (expanded) {
          for (const entry of o.entries) {
            rows.push(
              Row(`${o.plugin}/${entry.kind}/${entry.name}`, [
                h(
                  'span',
                  { className: 'xray-owner-entry' },
                  h('span', { className: 'xray-muted' }, `${entry.kind} · `),
                  h(EntryLink, { kind: entry.kind, name: entry.name, onInspect, t }),
                ),
                '',
                '',
                { cls: 'xray-num', text: `~${entry.tokens}` },
                '',
                '',
              ]),
            );
          }
        }
      }
      return h(Table, { t, headers: ['plugin', 'sections', 'tools', 'tokens', 'share', ''], rows });
    }

    /** Raw-text inspector: fetches one entry's live text on open. Fetched per
     * view, never cached — the text IS the audit artifact. */
    function EntryModal({ target, onClose, t }) {
      const [state, setState] = react.useState({ phase: 'loading' });
      react.useEffect(() => {
        let alive = true;
        setState({ phase: 'loading' });
        fetch(
          `/xray/api/entry?kind=${encodeURIComponent(target.kind)}&name=${encodeURIComponent(target.name)}`,
        )
          .then(async (res) => {
            if (!res.ok)
              throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
            return res.json();
          })
          .then((data) => {
            if (alive) setState({ phase: 'ready', data });
          })
          .catch((err) => {
            if (alive)
              setState({
                phase: 'error',
                message: err instanceof Error ? err.message : String(err),
              });
          });
        return () => {
          alive = false;
        };
      }, [target]);
      return h(
        'div',
        { className: 'xray-entry-overlay', onClick: onClose },
        h(
          'div',
          { className: 'xray-entry-modal', onClick: (event) => event.stopPropagation() },
          h(
            'div',
            { className: 'xray-entry-head' },
            h('span', { className: 'xray-entry-name' }, target.name),
            state.phase === 'ready'
              ? h(
                  'span',
                  { className: 'xray-entry-stats' },
                  fill(t('entry.stats'), {
                    chars: state.data.chars,
                    tokens: state.data.tokens,
                    estimator: state.data.estimator,
                  }),
                )
              : null,
            h('button', { className: 'xray-entry-close', onClick: onClose }, t('entry.close')),
          ),
          state.phase === 'loading'
            ? h('p', { className: 'xray-muted' }, t('entry.loading'))
            : state.phase === 'error'
              ? h('p', { className: 'xray-warn' }, state.message)
              : h('pre', { className: 'xray-entry-text' }, state.data.text),
        ),
      );
    }
    //#endregion

    //#region per-view renderers (mirror lib/panel.js, as components; all copy through t)
    const renderers = {
      summary: (d, t, _onInspect, goToView) =>
        h(
          react.Fragment,
          null,
          h(Table, {
            t,
            headers: ['metric', 'value'],
            rows: [
              Row('p', [t('row.pluginsMounted'), { cls: 'xray-num', text: String(d.plugins) }]),
              Row('u', [
                t('row.unhealthy'),
                {
                  cls: `xray-num ${d.unhealthy ? 'xray-warn' : 'xray-ok'}`,
                  text: String(d.unhealthy),
                },
              ]),
              Row('s', [t('row.services'), { cls: 'xray-num', text: String(d.services) }]),
              Row('t', [
                h(
                  'button',
                  {
                    className: 'xray-entry-link',
                    title: t('tip.contextTokens'),
                    onClick: () => goToView('cost'),
                  },
                  t('row.contextTokens'),
                ),
                { cls: 'xray-num', text: `~${d.toolSchemaTokens}` },
              ]),
            ],
          }),
          h(
            'p',
            { className: 'xray-muted', style: { marginTop: 12 } },
            fill(t('summary.captured'), { at: d.capturedAt }),
          ),
        ),

      health: (d, t) =>
        h(
          react.Fragment,
          null,
          h(
            'p',
            null,
            h('span', { className: 'xray-ok' }, fill(t('health.healthy'), { n: d.healthy.length })),
            d.waiting.length ? ` · ${fill(t('health.waiting'), { n: d.waiting.length })}` : null,
            d.unhealthy.length
              ? h(
                  react.Fragment,
                  null,
                  ' · ',
                  h(
                    'span',
                    { className: 'xray-warn' },
                    fill(t('health.unhealthy'), { n: d.unhealthy.length }),
                  ),
                )
              : null,
          ),
          d.unhealthy.length
            ? h(Table, {
                t,
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
                t,
                headers: ['waitingPlugin', 'wants'],
                rows: d.waiting.map((p) => Row(p.name, [p.name, p.inject.join(', ')])),
              })
            : null,
        ),

      deps: (d, t) =>
        h(
          react.Fragment,
          null,
          d.unsatisfied.length
            ? h(
                'p',
                { className: 'xray-warn', title: t('tip.wants') },
                fill(t('deps.unsatisfied'), { n: d.unsatisfied.length }),
              )
            : null,
          Object.keys(d.cascade).length
            ? h(
                react.Fragment,
                null,
                h('div', { className: 'xray-h3' }, t('h3.disableCascade')),
                h(Table, {
                  t,
                  headers: ['provider', 'affects'],
                  rows: Object.entries(d.cascade).map(([provider, affected]) =>
                    Row(provider, [provider, affected.join(', ')]),
                  ),
                }),
              )
            : null,
          h('div', { className: 'xray-h3' }, t('h3.services')),
          h(Table, {
            t,
            headers: ['service', 'providedBy', 'consumedBy'],
            rows: Object.entries(d.services).map(([name, node]) =>
              Row(name, [name, node.providers.join(', ') || '—', node.consumers.join(', ') || '—']),
            ),
          }),
        ),

      cost: (d, t, onInspect) =>
        h(
          react.Fragment,
          null,
          h(
            'p',
            null,
            fill(t('cost.headline'), {
              total: d.totalTokens,
              toolCount: d.toolCount,
              toolTokens: d.toolTokens,
              sectionCount: d.sectionCount,
              sectionTokens: d.sectionTokens,
            }),
          ),
          d.owners?.length
            ? h(
                react.Fragment,
                null,
                h('div', { className: 'xray-h3' }, t('h3.byPlugin')),
                h(OwnersTable, { owners: d.owners, onInspect, t }),
              )
            : null,
          d.sections.length
            ? h(
                react.Fragment,
                null,
                h('div', { className: 'xray-h3' }, t('h3.promptSections')),
                h(Table, {
                  t,
                  headers: ['section', 'owner', 'tokens', 'share', ''],
                  rows: d.sections.map((s) =>
                    Row(s.name, [
                      h(EntryLink, { kind: 'section', name: s.name, onInspect, t }),
                      { cls: 'xray-muted', text: s.owner ?? '—' },
                      { cls: 'xray-num', text: `~${s.tokens}` },
                      { cls: 'xray-num', text: `${s.share}%` },
                      h(Bar, { share: s.share }),
                    ]),
                  ),
                }),
              )
            : h('p', { className: 'xray-muted' }, t('cost.noAssembly')),
          h('div', { className: 'xray-h3' }, t('h3.toolSchemas')),
          h(Table, {
            t,
            headers: ['tool', 'owner', 'tokens', 'share', ''],
            rows: d.tools.map((row) =>
              Row(row.name, [
                h(EntryLink, { kind: 'tool', name: row.name, onInspect, t }),
                { cls: 'xray-muted', text: row.owner ?? '—' },
                { cls: 'xray-num', text: `~${row.tokens}` },
                { cls: 'xray-num', text: `${row.share}%` },
                h(Bar, { share: row.share }),
              ]),
            ),
          }),
        ),

      shadow: (d, t) =>
        h(
          react.Fragment,
          null,
          d.services.length
            ? h(Table, {
                t,
                headers: ['service', 'providers'],
                rows: d.services.map((s) =>
                  Row(s.service, [
                    s.service,
                    { cls: 'xray-warn', text: s.providers.join(' AND ') },
                  ]),
                ),
              })
            : h('p', { className: 'xray-ok' }, t('shadow.clean')),
          d.registrars.length
            ? h(
                react.Fragment,
                null,
                h('div', { className: 'xray-h3' }, t('h3.registrars')),
                h(Table, {
                  t,
                  headers: ['plugin', 'registrations'],
                  rows: d.registrars.map((r) =>
                    Row(r.plugin, [r.plugin, { cls: 'xray-num', text: String(r.registrations) }]),
                  ),
                }),
              )
            : null,
        ),

      skills: (d, t) =>
        !d.available
          ? h('p', { className: 'xray-muted' }, t('skills.none'))
          : h(
              react.Fragment,
              null,
              h(
                'p',
                null,
                fill(t('skills.summary'), {
                  count: d.totals.count,
                  invocable: d.totals.invocable,
                  resident: d.totals.residentTokens,
                  entries: d.totals.catalogEntryTokens,
                  framing: d.totals.catalogOverheadTokens,
                }),
              ),
              h(Table, {
                t,
                headers: ['skill', 'provider2', 'catalog', 'body', 'invocable'],
                rows: d.skills.map((s) =>
                  Row(s.name, [
                    s.name,
                    { cls: 'xray-muted', text: s.provider ?? '—' },
                    { cls: 'xray-num', text: `~${s.catalogTokens}` },
                    { cls: 'xray-num', text: s.bodyTokens === null ? '—' : `~${s.bodyTokens}` },
                    s.modelInvocable
                      ? h('span', { className: 'xray-ok' }, t('skills.yes'))
                      : h('span', { className: 'xray-muted' }, t('skills.userOnly')),
                  ]),
                ),
              }),
            ),

      requests: (d, t) =>
        !d.available
          ? h('p', { className: 'xray-muted' }, t('requests.none'))
          : h(
              react.Fragment,
              null,
              d.sessions.map((session) =>
                h(
                  react.Fragment,
                  { key: session.sessionId },
                  h(
                    'div',
                    { className: 'xray-h3' },
                    fill(t('requests.session'), {
                      id: String(session.sessionId).slice(0, 12),
                      n: session.requests.length,
                    }),
                  ),
                  h(Table, {
                    t,
                    headers: [
                      'seq',
                      'when',
                      'purpose',
                      'total',
                      'system',
                      'toolSchemas2',
                      'history',
                      'results',
                      'prefix',
                      'delta',
                    ],
                    rows: session.requests.map((r) => {
                      const top = (r.toolResultRows ?? [])
                        .slice(0, 3)
                        .map((row) => `${row.name} ~${row.tokens}`)
                        .join(', ');
                      return Row(`${session.sessionId}/${r.seq}`, [
                        { cls: 'xray-num', text: String(r.seq) },
                        { cls: 'xray-muted', text: new Date(r.at).toTimeString().slice(0, 8) },
                        r.purpose
                          ? h('span', { className: 'xray-muted' }, r.purpose)
                          : t('requests.chat'),
                        { cls: 'xray-num', text: `~${r.total}` },
                        { cls: 'xray-num', text: String(r.system) },
                        { cls: 'xray-num', text: String(r.toolSchemas) },
                        { cls: 'xray-num', text: String(r.history) },
                        h('span', { className: 'xray-num', title: top }, String(r.toolResults)),
                        r.prefixStable === null ? '—' : r.prefixStable ? '⚡' : '✂',
                        {
                          cls: 'xray-num',
                          text:
                            r.deltaTotal === null
                              ? '—'
                              : `${r.deltaTotal >= 0 ? '+' : ''}${r.deltaTotal}`,
                        },
                      ]);
                    }),
                  }),
                ),
              ),
            ),
    };
    //#endregion

    //#region panel (one conversation.view tab)
    function XrayPanel({ t }) {
      const [view, setView] = react.useState('summary');
      // `for` stamps which view the payload belongs to: a click flips `view`
      // synchronously while `state` still carries the previous view's data —
      // rendering that mismatch with the new renderer throws and unmounts
      // the whole tab. During the switch the previous view's content stays
      // up (dimmed) and is replaced in one paint when the payload lands, so
      // the layout changes once per click instead of collapsing to a
      // one-line loading row and re-expanding.
      const [state, setState] = react.useState({ phase: 'loading', for: 'summary' });
      // Entry inspector: {kind, name} of the entry whose raw text is open.
      const [inspecting, setInspecting] = react.useState(null);
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
      if (!settled) body = h('p', { className: 'xray-muted' }, fill(t('panel.loading'), { view }));
      else if (state.phase === 'error') body = h('p', { className: 'xray-warn' }, state.message);
      else {
        // A diagnostic surface must never take itself down on one bad
        // payload: render the failure, keep the tab and its nav alive.
        try {
          body = renderers[state.for](state.data, t, setInspecting, setView);
        } catch (err) {
          body = h(
            'p',
            { className: 'xray-warn' },
            fill(t('panel.renderFailed'), {
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }
      const stale = settled && state.for !== view;
      return h(
        'div',
        { className: 'xray-panel' },
        h('p', { className: 'xray-sub' }, t('panel.sub')),
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
        h('p', { className: 'xray-muted', style: { margin: '0 0 10px' } }, t(`intro.${view}`)),
        h('div', { className: stale ? 'xray-body xray-stale' : 'xray-body' }, body),
        inspecting
          ? h(EntryModal, { target: inspecting, onClose: () => setInspecting(null), t })
          : null,
      );
    }
    //#endregion

    const inject = ['slots', 'locale'];
    /** Mount the X-Ray tab into the conversation view ring (beside Chat / Trajectory). */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'xray: dictionaries');
      const t = ctx.locale.bind(NS);
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: 'xray',
            order: 20,
            label: () => t('view.xray'),
            locale: NS,
          },
          XrayPanel,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
