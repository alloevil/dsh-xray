// Self-contained web panel: one HTML page + JSON endpoints, mounted on the
// host webServer. No client-module bundle, no React, no build step — the
// model layer already computes everything; this only renders it.

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh-xray</title>
<style>
  :root{color-scheme:dark;--bg:#080b12;--panel:#0e131d;--panel2:#121a27;--border:#253247;--border-hi:#344761;--text:#e7edf6;--muted:#8d9bb1;--faint:#5e6b80;--blue:#58a6ff;--cyan:#56d4dd;--green:#7ee787;--amber:#d29922;--red:#f85149;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
  *{box-sizing:border-box;margin:0}
  body{font:13px/1.55 var(--mono);background:radial-gradient(900px 420px at 75% -10%,#102039,var(--bg) 65%);color:var(--text);padding:0;min-height:100vh}
  button,input{font:inherit}
  button{cursor:pointer}
  .xray-shell{max-width:1240px;margin:0 auto;padding:24px clamp(16px,3vw,40px) 48px}
  .xray-top{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding-bottom:18px;border-bottom:1px solid var(--border)}
  .eyebrow{color:var(--cyan);font-size:10px;letter-spacing:.22em;text-transform:uppercase}
  h1{font-size:24px;line-height:1.1;margin-top:7px;letter-spacing:-.04em}
  .top-meta{color:var(--muted);text-align:right;font-size:11px}.live-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 12px var(--green);margin-right:6px}
  .xray-nav{display:flex;gap:7px;flex-wrap:wrap;padding:18px 0 10px}
  .xray-nav button{background:var(--panel);color:var(--muted);border:1px solid var(--border);border-radius:8px;padding:7px 12px;transition:.2s}
  .xray-nav button:hover{border-color:var(--border-hi);color:var(--text)}
  .xray-nav button.active{background:rgba(88,166,255,.14);border-color:var(--blue);color:var(--text);box-shadow:0 0 20px -12px var(--blue)}
  #status{min-height:22px;color:var(--muted);font-size:11px}
  .view-intro{display:flex;justify-content:space-between;gap:18px;align-items:start;padding:14px 16px;margin:4px 0 16px;background:rgba(255,255,255,.025);border:1px solid var(--border);border-radius:10px;color:var(--muted)}
  .trust{white-space:nowrap;color:var(--green);font-size:10px;border:1px solid rgba(126,231,135,.3);border-radius:99px;padding:3px 8px}
  .panel{background:rgba(14,19,29,.82);border:1px solid var(--border);border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 18px 50px -36px #000}
  .panel-head{display:flex;justify-content:space-between;gap:16px;align-items:baseline;margin-bottom:12px}.panel-title{font-size:12px;color:var(--muted);letter-spacing:.16em;text-transform:uppercase}.panel-note{color:var(--faint);font-size:10px}.panel-note::before{content:"· ";color:var(--cyan)}
  .metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}.metric{padding:13px 14px;background:var(--panel2);border:1px solid var(--border);border-radius:10px}.metric-label{font-size:10px;color:var(--muted);letter-spacing:.08em}.metric-value{font-size:26px;font-weight:700;letter-spacing:-.05em;margin-top:6px;font-variant-numeric:tabular-nums}.metric-value.ok{color:var(--green)}.metric-value.warn{color:var(--red)}
  .waterfall{display:grid;gap:9px}.water-row{display:grid;grid-template-columns:150px 1fr 80px;gap:12px;align-items:center}.water-label{color:var(--muted)}.water-track{height:10px;background:#1b2636;border-radius:99px;overflow:hidden}.water-fill{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--blue),var(--cyan));transition:width .5s}.water-value{text-align:right;color:var(--text);font-variant-numeric:tabular-nums}
  table{border-collapse:collapse;width:100%;margin-top:8px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-weight:normal;position:sticky;top:0;background:var(--panel)}tr:hover td{background:rgba(88,166,255,.045)}.num{text-align:right}.bar{background:var(--blue);height:8px;border-radius:99px;display:inline-block;box-shadow:0 0 12px -4px var(--blue)}
  .entry-link{font:inherit;color:var(--cyan);background:none;border:0;padding:0;cursor:pointer;text-align:left}.entry-link:hover{text-decoration:underline}
  .cascade{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.cascade-node{border:1px solid var(--border);border-radius:10px;padding:12px;background:var(--panel2);position:relative}.cascade-node:not(:last-child)::after{content:"↓";position:absolute;right:-18px;top:37%;color:var(--amber);z-index:1}.cascade-node h4{font-size:12px;color:var(--text)}.cascade-node p{font-size:11px;color:var(--muted);margin-top:5px}.cascade-node.risk{border-color:rgba(248,81,73,.4)}
  .request-card{border:1px solid var(--border);border-radius:10px;margin:10px 0;overflow:hidden}.request-head{display:flex;justify-content:space-between;gap:10px;padding:10px 12px;background:var(--panel2);color:var(--muted)}.request-bars{padding:12px}.request-bar{display:grid;grid-template-columns:90px 1fr 70px;align-items:center;gap:8px;margin:6px 0}.request-bar i{height:8px;background:linear-gradient(90deg,var(--blue),var(--cyan));border-radius:99px;display:block}.delta-up{color:var(--red)}.delta-down{color:var(--green)}
  .entry-overlay{position:fixed;inset:0;z-index:20;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:20px}.entry-modal{width:min(760px,94vw);max-height:82vh;display:flex;flex-direction:column;background:#111a28;border:1px solid var(--border-hi);border-radius:14px;padding:18px;box-shadow:0 30px 100px -30px #000}.entry-head{display:flex;align-items:baseline;gap:12px;margin-bottom:12px}.entry-head strong{word-break:break-all}.entry-close{margin-left:auto;background:var(--panel2);color:var(--muted);border:1px solid var(--border);border-radius:7px;padding:5px 10px}.entry-text{overflow:auto;white-space:pre-wrap;word-break:break-word;background:#080b12;border:1px solid var(--border);border-radius:9px;padding:14px;line-height:1.6}
  @media(max-width:760px){.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.view-intro{display:block}.trust{display:inline-block;margin-top:10px}.water-row{grid-template-columns:100px 1fr 55px}.cascade{grid-template-columns:1fr}.cascade-node:not(:last-child)::after{content:"↓";right:auto;left:50%;top:auto;bottom:-19px}.xray-top{align-items:start;flex-direction:column}.top-meta{text-align:left}}
  .xray-loading #content{opacity:.45;transition:opacity .18s}.xray-loading #status{color:var(--cyan)}
</style>
</head>
<body>
<main class="xray-shell">
  <header class="xray-top">
    <div><div class="eyebrow">Instrumentation console · live composition</div><h1>dsh-xray</h1></div>
    <div class="top-meta"><span class="live-dot"></span><span id="freshness">live</span><button id="refresh" type="button" class="entry-close" style="margin-left:10px">refresh</button><br><span>DeepSeek Harness</span></div>
  </header>
  <nav id="nav" class="xray-nav" aria-label="X-Ray views"></nav>
  <div id="status" role="status" aria-live="polite"></div>
  <div id="content"></div>
</main>
<script>
const views = ['summary', 'health', 'deps', 'cost', 'shadow', 'skills', 'requests', 'slo'];
const TRUST = { summary:'verified · live snapshot', health:'verified · lifecycle state', deps:'verified · runtime graph', cost:'estimated · ~4 chars/token', shadow:'verified · last writer wins', skills:'estimated · pricing only', requests:'verified · ledger counts', slo:'policy check · current snapshot' };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const INTRO = {
  summary:'Composition at a glance. Start here: health, dependency graph, context tax, and the current evidence boundary.',
  health:'Plugin lifecycle: waiting means a dependency has no active provider; unhealthy means a fiber failed to start.',
  deps:'Who provides and consumes each service. The cascade view answers what disabling a provider would affect.',
  cost:'What every LLM request carries before your message: prompt sections and tool schemas, attributed to owners.',
  shadow:'Same-name registrations: later writers silently win; usually an override, occasionally a conflict.',
  skills:'Skill catalog and body pricing. This view measures cost only; skill managers handle enable/disable.',
  requests:'One bill per LLM call: system, tools, history, results, prefix stability, and delta against the prior call.',
  slo:'Policy checks over the current live snapshot. PASS/WARN/FAIL compare observed context cost with explicit limits.',
  graph:'Evidence graph. Nodes are observed plugins, sections, tools, and services; edges describe ownership or provision.',
};

// One question per view: what am I looking at, and what does trouble look like?
const TIPS = {
  share:'Percentage of total estimated context this row costs per request', tokens:'Rough estimate: ~4 chars/token', owner:'Plugin whose registration put this entry into context', unattributed:'Cannot reconcile this entry to one plugin', wants:'Declared dependency without an active provider', fiber:'Mounted plugin instance', state:'Cordis lifecycle state', affects:'Transitive consumers of a provider', providers:'Plugins claiming a service name; last loaded wins', registrations:'Tools/commands registered on shared registries', sections:'Prompt sections contributed to system prompt', tools:'Tool schemas registered by the plugin', catalog:'Skill catalog line tokens carried per request', body:'Rendered skill body tokens billed per load', invocable:'Whether the model can load this skill', total:'Estimated tokens of full request payload', history:'Conversation messages excluding tool results', results:'Tool-result messages aggregated by tool', prefix:'Whether system prompt and tools matched the prior request'
};
const th = (h) => '<th' + (TIPS[h] ? ' title="' + escAttr(TIPS[h]) + '"' : '') + '>' + esc(h) + '</th>';
const intro = (v) => '<div class="view-intro"><span>' + INTRO[v] + '</span><span class="trust">' + TRUST[v] + '</span></div>';
const nav = document.getElementById('nav');
const content = document.getElementById('content');
const status = document.getElementById('status');
let active = 'summary';

content.addEventListener('click', (event) => {
  const entry = event.target.closest('.entry-link');
  if (!entry) return;
  openEntry(entry.dataset.entryKind, entry.dataset.entryName);
});
function openEntry(kind, name) {
  const overlay = document.createElement('div');
  overlay.className = 'entry-overlay';
  overlay.innerHTML = '<section class="entry-modal" role="dialog" aria-modal="true" aria-label="Entry inspection"><div class="entry-head"><strong>' + esc(name) + '</strong><span class="muted">' + esc(kind) + '</span><button class="entry-close" type="button">close</button></div><pre class="entry-text">loading entry…</pre></section>';
  document.body.appendChild(overlay);
  const closeButton = overlay.querySelector('.entry-close');
  const close = () => { overlay.remove(); document.querySelector('.entry-link')?.focus(); };
  closeButton.onclick = close;
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
  closeButton.focus();
  fetch('/xray/api/entry?kind=' + encodeURIComponent(kind) + '&name=' + encodeURIComponent(name))
    .then((res) => res.ok ? res.json() : res.text().then((text) => Promise.reject(new Error(text))))
    .then((data) => { overlay.querySelector('.entry-text').textContent = data.text ?? data.schema ?? JSON.stringify(data, null, 2); })
    .catch((error) => { overlay.querySelector('.entry-text').textContent = 'entry unavailable: ' + error.message; });
}
for (const [index, v] of views.entries()) {
  const b = document.createElement('button');
  b.textContent = v;
  b.setAttribute('role', 'tab');
  b.setAttribute('aria-controls', 'content');
  b.setAttribute('tabindex', index === 0 ? '0' : '-1');
  b.onclick = () => { active = v; localStorage.setItem('dsh-xray-view', v); render(); };
  b.onkeydown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length;
    nav.querySelectorAll('button')[next].focus();
    active = views[next]; localStorage.setItem('dsh-xray-view', active); render();
  };
  b.id = 'nav-' + v;
  nav.appendChild(b);
}
try { active = views.includes(localStorage.getItem('dsh-xray-view')) ? localStorage.getItem('dsh-xray-view') : 'summary'; } catch {}

function table(headers, rows) {
  return '<table><tr>' + headers.map(th).join('') + '</tr>' + rows.join('') + '</table>';
}
function bar(share) {
  return '<span class="bar" style="width:' + Math.max(2, share * 2) + 'px"></span>';
}

const renderers = {
  summary(d) {
    const healthy = d.healthy ?? (d.plugins - (d.unhealthy ?? 0) - (d.waiting ?? 0));
    return '<div class="metric-grid">'
      + '<div class="metric"><div class="metric-label">PLUGINS MOUNTED</div><div class="metric-value">' + d.plugins + '</div></div>'
      + '<div class="metric"><div class="metric-label">HEALTHY</div><div class="metric-value ok">' + healthy + '</div></div>'
      + '<div class="metric"><div class="metric-label">SERVICES</div><div class="metric-value">' + d.services + '</div></div>'
      + '<div class="metric"><div class="metric-label">CONTEXT TOKENS / REQUEST</div><div class="metric-value">~' + (d.contextTokens ?? d.toolSchemaTokens) + '</div></div></div>'
      + '<div class="panel"><div class="panel-head"><span class="panel-title">Composition health</span><span class="panel-note">captured ' + esc(d.capturedAt) + '</span></div>'
      + '<div class="waterfall"><div class="water-row"><span class="water-label">healthy</span><span class="water-track"><i class="water-fill" style="width:' + Math.max(3, healthy / Math.max(d.plugins, 1) * 100) + '%"></i></span><span class="water-value ok">' + healthy + '</span></div>'
      + '<div class="water-row"><span class="water-label">unhealthy</span><span class="water-track"><i class="water-fill" style="width:' + Math.max(0, (d.unhealthy ?? 0) / Math.max(d.plugins, 1) * 100) + '%;background:var(--red)"></i></span><span class="water-value warn">' + (d.unhealthy ?? 0) + '</span></div>'
      + '<div class="water-row"><span class="water-label">waiting</span><span class="water-track"><i class="water-fill" style="width:' + Math.max(0, (d.waiting ?? 0) / Math.max(d.plugins, 1) * 100) + '%;background:var(--amber)"></i></span><span class="water-value">' + (d.waiting ?? 0) + '</span></div></div></div>';
  },
  health(d) {
    let html = '<p><span class="ok">' + d.healthy.length + ' healthy</span>'
      + (d.waiting.length ? ' · ' + d.waiting.length + ' waiting' : '')
      + (d.unhealthy.length ? ' · <span class="warn">' + d.unhealthy.length + ' unhealthy</span>' : '') + '</p>';
    if (d.unhealthy.length) {
      html += table(['plugin', 'fiber', 'state', 'error'], d.unhealthy.flatMap((p) =>
        p.fibers.map((f) => '<tr><td>' + esc(p.name) + '</td><td class="num">' + f.uid
          + '</td><td class="warn">' + esc(f.state) + '</td><td>' + esc(f.error ?? '') + '</td></tr>')));
    }
    if (d.waiting.length) html += table(['waiting plugin', 'wants'], d.waiting.map((p) =>
      '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.inject.join(', ')) + '</td></tr>'));
    return html;
  },
  deps(d) {
    let html = '';
    const cascade = Object.entries(d.cascade);
    if (cascade.length) {
      html += '<div class="panel"><div class="panel-head"><span class="panel-title">Disable cascade</span><span class="panel-note">transitive impact</span></div><div class="cascade">'
        + cascade.slice(0, 9).map(([provider, affects]) => '<div class="cascade-node risk"><h4>' + esc(provider) + '</h4><p>disabling affects ' + affects.length + ' plugin(s)</p><p>' + esc(affects.slice(0, 5).join(', ')) + (affects.length > 5 ? ' …' : '') + '</p></div>').join('')
        + '</div></div>';
    }
    const services = Object.entries(d.services).map(([name, node]) => '<tr><td>' + esc(name) + '</td><td>' + esc(node.providers.join(', ') || '—') + '</td><td>' + esc(node.consumers.join(', ') || '—') + '</td></tr>');
    html += '<div class="panel"><div class="panel-head"><span class="panel-title">Service graph</span><span class="panel-note">provider → consumers</span></div>' + table(['service', 'provided by', 'consumed by'], services) + '</div>';
    return html;
  },
  slo(d) { return '<div class="panel"><div class="panel-head"><span class="panel-title">Context SLO</span><span class="panel-note">current snapshot policy</span></div>' + table(['check','value','limit','status'], d.checks.map((c) => '<tr><td>' + esc(c.label) + '</td><td class="num">' + c.value + ' ' + c.unit + '</td><td class="num">' + c.limit + '</td><td class="' + (c.status === 'pass' ? 'ok' : c.status === 'fail' ? 'warn' : 'muted') + '">' + c.status.toUpperCase() + '</td></tr>')) + '<p class="' + (d.status === 'pass' ? 'ok' : 'warn') + '" style="margin-top:12px">overall: ' + d.status.toUpperCase() + '</p></div>'; },
  cost(d) {
    let html = '<div class="panel"><div class="panel-head"><span class="panel-title">Context tax</span><span class="panel-note">estimated · ~4 chars/token</span></div><div class="waterfall">'
      + '<div class="water-row"><span class="water-label">prompt sections</span><span class="water-track"><i class="water-fill" style="width:' + Math.min(100, d.sectionTokens / Math.max(d.totalTokens, 1) * 100) + '%"></i></span><span class="water-value">~' + d.sectionTokens + '</span></div>'
      + '<div class="water-row"><span class="water-label">tool schemas</span><span class="water-track"><i class="water-fill" style="width:' + Math.min(100, d.toolTokens / Math.max(d.totalTokens, 1) * 100) + '%;background:var(--amber)"></i></span><span class="water-value">~' + d.toolTokens + '</span></div></div></div>';
    html += '<div class="panel"><div class="panel-head"><span class="panel-title">By plugin</span><span class="panel-note">each request</span></div>'
      + table(['plugin', 'sections', 'tools', 'tokens', 'share', ''], (d.owners ?? []).map((o) => '<tr><td>' + (o.plugin === 'unattributed' ? '<span class="muted" title="' + escAttr(TIPS.unattributed) + '">unattributed</span>' : esc(o.plugin)) + '</td><td class="num">' + o.sections + '</td><td class="num">' + o.tools + '</td><td class="num">~' + o.tokens + '</td><td class="num">' + o.share + '%</td><td>' + bar(o.share) + '</td></tr>')) + '</div>';
    if (d.sections.length) html += '<div class="panel"><div class="panel-head"><span class="panel-title">Prompt sections</span><span class="panel-note">click an entry to inspect live text</span></div>' + table(['section', 'owner', 'tokens', 'share', ''], d.sections.map((s) => '<tr><td><button class="entry-link" data-entry-kind="section" data-entry-name="' + escAttr(s.name) + '">' + esc(s.name) + '</button></td><td class="muted">' + esc(s.owner ?? '—') + '</td><td class="num">~' + s.tokens + '</td><td class="num">' + s.share + '%</td><td>' + bar(s.share) + '</td></tr>')) + '</div>';
    html += '<div class="panel"><div class="panel-head"><span class="panel-title">Tool schemas</span><span class="panel-note">click an entry to inspect live schema</span></div>' + table(['tool', 'owner', 'tokens', 'share', ''], d.tools.map((t) => '<tr><td><button class="entry-link" data-entry-kind="tool" data-entry-name="' + escAttr(t.name) + '">' + esc(t.name) + '</button></td><td class="muted">' + esc(t.owner ?? '—') + '</td><td class="num">~' + t.tokens + '</td><td class="num">' + t.share + '%</td><td>' + bar(t.share) + '</td></tr>')) + '</div>';
    return html;
  },
  skills(d) {
    if (!d.available) return '<p class="muted">no skill observation yet — the skills service is absent or discovery has not run</p>';
    let html = '<p>' + d.totals.count + ' skill(s), ' + d.totals.invocable + ' model-invocable · resident catalog ~'
      + d.totals.residentTokens + ' tokens (' + '~' + d.totals.catalogEntryTokens + ' entries + ~'
      + d.totals.catalogOverheadTokens + ' framing) on every request</p>';
    html += table(['skill', 'provider', 'catalog', 'body', 'invocable'], d.skills.map((s) =>
      '<tr><td>' + esc(s.name) + '</td><td class="muted">' + esc(s.provider ?? '—')
      + '</td><td class="num">~' + s.catalogTokens + '</td><td class="num">' + (s.bodyTokens === null ? '—' : '~' + s.bodyTokens)
      + '</td><td>' + (s.modelInvocable ? '<span class="ok">yes</span>' : '<span class="muted">user-only</span>') + '</td></tr>'));
    return html;
  },
  requests(d) {
    if (!d.available) return '<div class="panel"><span class="muted">no requests observed yet — send one agent message first</span></div>';
    let html = '';
    for (const session of d.sessions) {
      html += '<div class="panel"><div class="panel-head"><span class="panel-title">Session ' + esc(String(session.sessionId).slice(0, 12)) + '</span><span class="panel-note">' + session.requests.length + ' request(s)</span></div>';
      for (const r of session.requests) {
        const delta = r.deltaTotal === null ? '—' : (r.deltaTotal >= 0 ? '+' : '') + r.deltaTotal;
        const deltaClass = r.deltaTotal > 0 ? 'delta-up' : r.deltaTotal < 0 ? 'delta-down' : '';
        html += '<div class="request-card"><div class="request-head"><span>#' + r.seq + ' · ' + esc(r.purpose ?? 'chat') + '</span><span>~' + r.total + ' tokens · <b class="' + deltaClass + '">Δ ' + delta + '</b></span></div><div class="request-bars">'
          + '<div class="panel-note">prefix: ' + (r.prefixStable === null ? '—' : r.prefixStable ? '⚡ stable' : '✂ changed') + '</div></div></div>';
      }
      html += '</div>';
    }
    return html;
  },
};

async function render() {
  document.body.classList.add('xray-loading');
  status.textContent = 'loading ' + active + '…';
  try {
    const res = await fetch('/xray/api/' + active);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    content.innerHTML = intro(active) + renderers[active](data);
    status.textContent = '';
    document.body.classList.remove('xray-loading');
  } catch (err) {
    document.body.classList.remove('xray-loading');
    status.innerHTML = '<span class="warn">' + esc(err.message) + '</span><button id="retry" type="button" class="entry-close" style="margin-left:10px">retry</button>';
    content.innerHTML = '<div class="panel"><strong>View unavailable</strong><p class="muted" style="margin-top:8px">The live endpoint did not return this view. Retry now, or inspect the runtime snapshot from the CLI.</p></div>';
    document.getElementById('retry').onclick = () => render();
  }
}
render();
const refreshButton = document.getElementById('refresh');
refreshButton.addEventListener('click', () => render());
setInterval(() => { if (active === 'health' || active === 'summary') render(); }, 5000);
</script>
</body>
</html>`;

function sendJson(response, code, value) {
  const body = JSON.stringify(value);
  response.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

/**
 * Mount the panel routes. `views` supplies fresh data per request; `entry`
 * answers live entry inspection without persisting entry text.
 */
function mountPanel(webServer, views, entry) {
  const disposers = [];
  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/xray',
      handler: (request, response) => {
        if (request.method !== 'GET') {
          response.writeHead(405, { allow: 'GET' });
          response.end();
          return;
        }
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(PAGE);
      },
    }),
  );
  for (const [name, compute] of Object.entries(views)) {
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: `/xray/api/${name}`,
        handler: (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' });
            response.end();
            return;
          }
          try {
            sendJson(response, 200, compute());
          } catch (err) {
            sendJson(response, 500, { error: err.message });
          }
        },
      }),
    );
  }
  if (entry) {
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: '/xray/api/entry',
        handler: (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' });
            response.end();
            return;
          }
          const params = new URL(request.url ?? '/', 'http://x').searchParams;
          const kind = params.get('kind');
          const name = params.get('name');
          if ((kind !== 'section' && kind !== 'tool') || !name) {
            sendJson(response, 400, { error: 'expected ?kind=section|tool&name=<entry name>' });
            return;
          }
          try {
            const value = entry(kind, name);
            if (value === null)
              sendJson(response, 404, { error: `no live ${kind} named "${name}"` });
            else sendJson(response, 200, value);
          } catch (err) {
            sendJson(response, 500, { error: err.message });
          }
        },
      }),
    );
  }
  return disposers;
}

module.exports = { mountPanel, PAGE };
