<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="dsh-xray — the per-request context-tax waterfall (system, tools, history, results) and the disable-cascade from Loader and TimerService">
</p>

<p align="center"><sub>The token-ledger panel is measured on the committed <code>fixtures/runtime-basic</code> snapshot; the disable-cascade panel is an illustrative capture from an author profile that no committed fixture reproduces.</sub></p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-xray"><img src="https://img.shields.io/npm/v/dsh-xray?style=flat-square&color=00d4aa" alt="npm"></a>
  <a href="https://github.com/alloevil/dsh-xray/actions/workflows/check.yml"><img src="https://img.shields.io/github/actions/workflow/status/alloevil/dsh-xray/check.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/dsh-xray?style=flat-square" alt="license"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/alloevil/dsh-xray"><img src="https://api.securityscorecards.dev/projects/github.com/alloevil/dsh-xray/badge?style=flat-square" alt="OpenSSF Scorecard"></a>
  <a href="https://codecov.io/gh/alloevil/dsh-xray"><img src="https://img.shields.io/codecov/c/github/alloevil/dsh-xray?style=flat-square" alt="coverage"></a>
  <img src="https://img.shields.io/badge/language-JavaScript-f7df1e?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript">
</p>

<p align="center">
  <strong>X-ray for your <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a></strong> — see what's actually loaded, why, and what it costs you.
  <br>
  <em>LLM context-cost observability: token attribution per plugin, prompt-section and tool-schema pricing, skill catalog tax, dependency cascades.</em>
</p>

<p align="center">
  <a href="./docs/README.zh.md">🇨🇳 中文文档</a>
</p>

---

Every plugin you mount quietly bills every LLM request: prompt sections, tool schemas, tokens. dsh-xray sits inside your running harness as an **X-Ray tab beside Chat and Trajectory** and itemizes that bill — per plugin, per entry, down to the exact text:

![The X-Ray tab: every plugin's per-request context tax, attributed and ranked](./assets/tab-cost.webp)

Unfold a plugin to see what it registered; click any entry to read the exact text it puts into every request:

<table>
<tr>
<td width="50%">

![A plugin unfolds into its registered entries](./assets/tab-expand.webp)

</td>
<td width="50%">

![The raw text behind ~184 tokens, with a chars/tokens ruler](./assets/tab-entry.webp)

</td>
</tr>
</table>

Three clicks: plugin rollup → entry list → the actual words. The number stops being an estimate you trust and becomes a fact you checked.

---

## The Problem

`dsh --dump-config` shows you the composed tree. The plugin panel shows you a flat list. Neither tells you **why** a plugin is there, **what breaks** if you disable it, or **what it silently costs you** on every single request.

**dsh-xray does.** And when the answer is "this plugin taxes every request and nothing depends on it" — the `deps` view confirms the disable is safe, one patch line removes it, and `attribute` verifies it took.

---

<p align="center">
  <img src="./assets/section-context-tax.svg" width="100%" alt="Context Tax">
</p>

The cost view answers the question no other tool asks: **who put this in my context, and what does it cost?**

- **Attribution** — every prompt section and tool schema is joined to the plugin that registered it, reconstructed live from the registries (ambiguous entries stay `unattributed`, never guessed).
- **By-plugin rollup** — each plugin's per-request context tax: sections + schemas + tokens + share, ranked.
- **Entry inspection** — `/xray/api/entry` returns any entry's live text with a chars/tokens ruler. Computed per request, never persisted.
- **Skill cost** — a dedicated view prices every skill twice: its catalog line (resident on every request once any model-invocable skill exists) and its body (billed per load). Pricing only — toggling belongs to the ecosystem's skill managers.
- **Per-request ledger** — one classified bill per LLM call: system / tool schemas / history / tool results (aggregated per tool), a **Δprev** growth column, and prefix-stability markers (⚡ system+tools byte-identical to the previous request — KV-cache-friendly; ✂ prefix broken). Compaction and title calls are tagged apart from chat. Only counts, names, and hashes are kept — never message text.
- **Explained UI** — every view opens with a one-line "what am I looking at"; terms carry plain-language tooltips; the whole tab is localized (English / 中文) through the host locale service.

The same data flows through three surfaces: the **X-Ray tab** (native GUI), the standalone **`/xray` page** (works even when the client-module pipeline it diagnoses is broken), and the **CLI**.

---

<p align="center">
  <img src="./assets/section-cli.svg" width="100%" alt="CLI Commands">
</p>

```sh
npx dsh-xray attribute   # which layer introduced each row, and who patched it since
npx dsh-xray conflicts   # contested fields with per-writer evidence: file:line, value, winner
npx dsh-xray diff        # declared (static layers) vs actual (dump-config) tree
npx dsh-xray snapshot    # content-addressed lockfile; --against <lock> reports drift, exits 1
npx dsh-xray deps [svc]  # service dependency graph: providers, consumers, transitive disable-cascade
npx dsh-xray health      # plugin lifecycle health: failed fibers, pending injects, transitions
npx dsh-xray cost        # context cost: prompt sections + tool schemas, estimated tokens
npx dsh-xray shadow      # services provided by multiple plugins
npx dsh-xray verify      # declared (static) rows ↔ runtime registry, exits 1 on mismatch
npx dsh-xray why <tool>  # provenance chain for one tool: owner plugin, its injects, their providers
npx dsh-xray audit       # static scan of out-of-tree plugins for sensitive touchpoints
```

![dsh-xray demo](./docs/demo.svg)

*The demo transcript is an illustrative capture from an author's `web` profile (revision unrecorded) — its figures are not reproducible from this repo and drift as the profile gains plugins; the committed fixtures and their pinned outputs live in `fixtures/` and `tests/golden.spec.js`.*

`attribute`, `conflicts`, and `snapshot` are static — they replay the on-disk layer stack and work even when dsh cannot boot (`snapshot` additionally samples `dsh --dump-config` for the composed hash, and folds in the runtime services/tools when a snapshot exists, degrading honestly to `null` when it doesn't). All commands take `--profile <name>` (default `web`) and `--json`; every JSON payload carries a versioned `schema` field (`dsh-xray/<view>@N`) so machine consumers detect shape changes instead of guessing. `snapshot`, its `--against` diff, `verify` and `audit` are at `@2` (see the changelog for what moved); every other view is still `@1`. Exit codes slot into CI: `diff` (trees disagree), `health` (unhealthy plugin), `snapshot --against <lock>` (composition drifted), `shadow` (multi-provider service), `verify` (declared ↔ runtime mismatch) and `why` (no tool by that name is attributed) all exit `1`.

---

<p align="center">
  <img src="./assets/section-features.svg" width="100%" alt="Features">
</p>

<table>
<tr>
<td width="50%">

### 🔍 Layer Attribution
Which layer introduced each active plugin: kernel bundle, profile dependency, `cordis.patch.yml` insert, or repository source.

### 📊 Declared vs. Actual Diff
Installed-but-inactive, uninstalled-but-lingering patch rows — including patch rows targeting ids that don't exist (dsh warns on stderr and skips them).

### ⚡ Conflict Detection
Plugins patching the same config row, and which one silently wins.

### 📸 Composition Snapshot
Export the effective composition as a lockfile — bundles, patches, and every installed plugin with its provenance (`registry` / `link` / `repository`) and a content hash excluding `node_modules`, plus the services and tools the runtime actually registered. `snapshot --against <lock>` reports drift category by category (bundle version / patch content / package version, source or content / service providers / tool owners and schema size) and exits `1`. A saved lock that cannot answer for a field says so instead of reading as equal.

</td>
<td width="50%">

### 🌐 Service Dependency Graph
Who provides and consumes each service — and the full **transitive** disable-cascade: not just direct consumers, but everything downstream of the services they re-provide.

```console
$ npx dsh-xray deps
# disable-cascade (transitive consumers of each provider):
  Loader → 5 plugin(s): AgentPresets, ClientModuleRegistry, Hmr, …
  TimerService → 1 plugin(s): Hmr
```

*Illustrative capture from the author's `web` profile (revision unrecorded) — no committed fixture produces it, and the counts drift as plugins are added; this repo's runtime fixtures are synthetic (e.g. `fixtures/runtime-basic` pins `ToolRuntime → 1 plugin(s): AgentLoop`).*

### 💊 Runtime Health
Per-plugin fiber lifecycle state, startup failures, pending injects, transition history.

### 👥 Service Shadowing
Same-name registrations where a later writer silently wins — usually an intended override, occasionally a conflict.

### 🛡️ Capability Audit
Heuristic static scan of out-of-tree plugins: subprocess / shell, network egress, filesystem read and write, environment variables, dynamic code evaluation. Every hit carries `file:line` and the matched line, and every capability carries a confidence derived from two checkable facts — the builtin module is imported and a call site exists (`high`), only one of the two (`medium`), or nothing but a `process.env` lookup that cannot be corroborated (`low`).

### 🔗 Tool Provenance
`why <tool>` answers "why is this in my context?" as a chain: the tool, the plugin the attribution table says registered it, that plugin's injects, the plugins providing those services, and on up to the ones that inject nothing.

</td>
</tr>
</table>

---

<p align="center">
  <img src="./assets/section-agent.svg" width="100%" alt="Agent Tool">
</p>

Mounted in the tree, dsh-xray registers an `xray_composition` tool (`view: summary | deps | health | cost | shadow | skills | requests`), so an agent can answer:

> *"What capabilities do I have?" / "What plugin provides X?" / "Why is Y unavailable?"*

— about itself.

---

<p align="center">
  <img src="./assets/section-safety.svg" width="100%" alt="Safety Stance">
</p>

**dsh-xray reads; it never runs.**

- Loader `!!js` expressions in patch files are parsed as opaque markers and **never evaluated**
- The CLI **never executes** plugin code (`audit` is a pattern scan over source text)
- The mounted plugin writes only under `$DSH_HOME/xray/` — entry text is served live, **never persisted**
- The entry endpoint returns composition-layer text only, **never session messages**
- See [SECURITY.md](./SECURITY.md)

## Analysis modes

Every result names its trust boundary:

| Mode | Commands | Boundary |
| --- | --- | --- |
| **Static** | `attribute`, `conflicts`, `snapshot` | Exact replay of the on-disk layer stack; works even when dsh cannot boot. `snapshot` also samples `dsh --dump-config` for the composed hash when dsh is available. Cannot observe runtime behavior. |
| **Static + spawn** | `diff` | Replays the layers, then spawns `dsh --dump-config` to compare declared vs. actual. |
| **Static + runtime** | `verify` | Joins both sides: declared rows that never mounted, disabled rows still running, runtime-only plugins, snapshot staleness — and, per service and per tool, whether its runtime provider/owner is a declared row. |
| **Runtime** | `deps`, `health`, `cost`, `shadow`, `verify`'s runtime half, `why`, tab, `/xray` panel, agent tool | Observed from the running composition (`$DSH_HOME/xray/runtime.json`); valid for the current session only. Token counts are estimates (~4 chars/token) unless you open the entry text and count. |
| **Heuristic** | `audit` | Pattern scan over source text; false positives and negatives are expected. A flag means "this pattern appears", never "this plugin is malicious". Confidence grades how well the pattern is corroborated, not how dangerous it is. |

---

<p align="center">
  <img src="./assets/section-install.svg" width="100%" alt="Install">
</p>

Two ways to use it — they're independent:

**1. Static CLI only** (no install into dsh; works even when dsh cannot boot):

```sh
npx dsh-xray attribute        # requires Node >= 22
```

**2. Mount the plugin** (adds the runtime commands, the X-Ray tab, the `/xray` panel, and the agent tool):

```sh
dsh plugin --profile web add dsh-xray
# bundle plugins take effect on the next start — restart dsh web
```

Verify it took:

```sh
dsh --profile web --dump-config | grep dsh-xray   # row present in the composed tree
npx dsh-xray health                               # reads the runtime snapshot
# then open any session and click the X-Ray tab,
# or http://127.0.0.1:3080/xray (the web app's default bind) for the standalone panel
```

Uninstall: `dsh plugin --profile web remove dsh-xray`.

| Command | Exit code |
| --- | --- |
| `diff` | `1` when the trees disagree |
| `health` | `1` when any plugin is unhealthy |
| `snapshot --against <lock>` | `1` when the composition drifted |
| `shadow` | `1` when any service has multiple providers |
| `verify` | `1` when a declared plugin is not running, or a disabled one is (runtime-only subplugins and per-service/tool provenance are reported, not failures) |
| `why` | `1` when no tool by that name is attributed in the runtime snapshot |

---

<p align="center">
  <img src="./assets/section-capabilities.svg" width="100%" alt="Capabilities">
</p>

Diagnostic imaging for a running composition — complementary to [dsh-doctor](https://www.npmjs.com/package/dsh-doctor) (rescue & recovery).

| Feature | Category |
| --- | --- |
| Context-tax attribution & entry inspection | 💰 Optimization |
| Skill cost (catalog line + body pricing) | 💰 Optimization |
| Per-request ledger (Δprev, prefix stability) | 💰 Optimization |
| Layer attribution | 🔍 Inspection |
| Declared vs. actual diff | 🔍 Inspection |
| Conflict detection | 🔍 Inspection |
| Composition snapshot | 📦 Export |
| Static ↔ runtime verification | 🔍 Inspection |
| Tool provenance chain | 🔍 Inspection |
| Service dependency graph | 🌐 Runtime |
| Runtime health | 🌐 Runtime |
| Service shadowing | 🌐 Runtime |
| Agent self-introspection | 🤖 AI |
| Capability audit | 🛡️ Security |

---



## License

[MIT](./LICENSE)
