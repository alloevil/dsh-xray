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
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
         background: #0d1117; color: #e6edf3; padding: 24px; }
  h1 { font-size: 16px; margin-bottom: 4px; }
  .sub { color: #8b949e; margin-bottom: 20px; }
  nav { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  nav button { background: #21262d; color: #e6edf3; border: 1px solid #30363d;
               border-radius: 6px; padding: 5px 12px; cursor: pointer; font: inherit; }
  nav button.active { background: #1f6feb; border-color: #1f6feb; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { text-align: left; padding: 4px 10px; border-bottom: 1px solid #21262d; }
  th { color: #8b949e; font-weight: normal; }
  .num { text-align: right; }
  .bar { background: #1f6feb; height: 10px; border-radius: 2px; display: inline-block; }
  .warn { color: #f85149; }
  .ok { color: #7ee787; }
  .muted { color: #8b949e; }
  #status { margin: 12px 0; color: #8b949e; }
  .tag { background: #21262d; border-radius: 4px; padding: 1px 6px; margin-left: 6px; font-size: 11px; }
</style>
</head>
<body>
<h1>dsh-xray</h1>
<div class="sub">composition X-ray — live from this harness</div>
<nav id="nav"></nav>
<div id="status"></div>
<div id="content"></div>
<script>
const views = ['summary', 'health', 'deps', 'cost', 'shadow'];
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const nav = document.getElementById('nav');
const content = document.getElementById('content');
const status = document.getElementById('status');
let active = 'summary';

for (const v of views) {
  const b = document.createElement('button');
  b.textContent = v;
  b.onclick = () => { active = v; render(); };
  b.id = 'nav-' + v;
  nav.appendChild(b);
}

function table(headers, rows) {
  return '<table><tr>' + headers.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr>'
    + rows.join('') + '</table>';
}
function bar(share) {
  return '<span class="bar" style="width:' + Math.max(2, share * 2) + 'px"></span>';
}

const renderers = {
  summary(d) {
    return table(['metric', 'value'], [
      '<tr><td>plugins mounted</td><td class="num">' + d.plugins + '</td></tr>',
      '<tr><td>unhealthy</td><td class="num ' + (d.unhealthy ? 'warn' : 'ok') + '">' + d.unhealthy + '</td></tr>',
      '<tr><td>services</td><td class="num">' + d.services + '</td></tr>',
      '<tr><td>context tokens (tools + sections)</td><td class="num">~' + d.toolSchemaTokens + '</td></tr>',
    ]) + '<p class="muted" style="margin-top:12px">captured ' + esc(d.capturedAt) + '</p>';
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
    if (d.waiting.length) {
      html += table(['waiting plugin', 'wants'], d.waiting.map((p) =>
        '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.inject.join(', ')) + '</td></tr>'));
    }
    return html;
  },
  deps(d) {
    const services = Object.entries(d.services).map(([name, node]) =>
      '<tr><td>' + esc(name) + '</td><td>' + esc(node.providers.join(', ') || '—')
      + '</td><td>' + esc(node.consumers.join(', ') || '—') + '</td></tr>');
    let html = table(['service', 'provided by', 'consumed by'], services);
    const cascade = Object.entries(d.cascade);
    if (cascade.length) {
      html = '<h3 style="margin:8px 0">disable-cascade</h3>'
        + table(['provider', 'affects'], cascade.map(([p, a]) =>
          '<tr><td>' + esc(p) + '</td><td>' + esc(a.join(', ')) + '</td></tr>'))
        + '<h3 style="margin:16px 0 8px">services</h3>' + html;
    }
    if (d.unsatisfied.length) {
      html = '<p class="warn">' + d.unsatisfied.length + ' unsatisfied inject(s)</p>' + html;
    }
    return html;
  },
  cost(d) {
    let html = '<p>~' + d.totalTokens + ' tokens: ' + d.toolCount + ' tool schema(s) ~' + d.toolTokens
      + ' + ' + d.sectionCount + ' prompt section(s) ~' + d.sectionTokens + '</p>';
    if (d.sections.length) {
      html += '<h3 style="margin:12px 0 4px">prompt sections</h3>'
        + table(['section', 'tokens', 'share', ''], d.sections.map((s) =>
          '<tr><td>' + esc(s.name) + '</td><td class="num">~' + s.tokens + '</td><td class="num">'
          + s.share + '%</td><td>' + bar(s.share) + '</td></tr>'));
    } else {
      html += '<p class="muted">no prompt assembly observed yet — send one agent message first</p>';
    }
    html += '<h3 style="margin:12px 0 4px">tool schemas</h3>'
      + table(['tool', 'tokens', 'share', ''], d.tools.map((t) =>
        '<tr><td>' + esc(t.name) + '</td><td class="num">~' + t.tokens + '</td><td class="num">'
        + t.share + '%</td><td>' + bar(t.share) + '</td></tr>'));
    return html;
  },
  shadow(d) {
    let html = d.services.length
      ? table(['service', 'providers'], d.services.map((s) =>
          '<tr><td>' + esc(s.service) + '</td><td class="warn">' + esc(s.providers.join(' AND ')) + '</td></tr>'))
      : '<p class="ok">no service is provided by more than one plugin</p>';
    if (d.registrars.length) {
      html += '<h3 style="margin:12px 0 4px">registrars</h3>'
        + table(['plugin', 'registrations'], d.registrars.map((r) =>
          '<tr><td>' + esc(r.plugin) + '</td><td class="num">' + r.registrations + '</td></tr>'));
    }
    return html;
  },
};

async function render() {
  for (const v of views) document.getElementById('nav-' + v).className = v === active ? 'active' : '';
  status.textContent = 'loading ' + active + '…';
  try {
    const res = await fetch('/xray/api/' + active);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    content.innerHTML = renderers[active](data);
    status.textContent = '';
  } catch (err) {
    status.innerHTML = '<span class="warn">' + esc(err.message) + '</span>';
    content.innerHTML = '';
  }
}
render();
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
 * Mount the panel routes. `views` supplies fresh data per request:
 * { summary, deps, health, cost, shadow } — each a () => object.
 * Returns the disposers webServer.register produced.
 */
function mountPanel(webServer, views) {
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
  return disposers;
}

module.exports = { mountPanel, PAGE };
