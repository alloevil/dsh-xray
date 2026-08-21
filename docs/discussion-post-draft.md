# dsh-xray — 给你的 Harness 拍 X 光:组合树归因、依赖级联、上下文成本

(草稿 — 建议发到 deepseek-ai/deepseek-harness 的 Discussions · Show and tell 分类。
发布前把口吻改成你自己的;英文版附在下半部分,可以只发中文或双语。)

---

大家好,我做了一个诊断类插件 **dsh-xray**,想解决我自己折腾 profile 时反复遇到的三个问题:

1. `--dump-config` 打出 130 行,但**哪一行是谁引入的**?patch 改了不生效时,是 id 写错被静默跳过,还是被后面的层覆盖了?
2. 想停用一个插件,**会连带瘫掉什么**?
3. 装了一堆插件后,**每次请求的上下文里到底塞了多少东西**?

## 它长什么样

```console
$ npx dsh-xray attribute
# 130 rows in profile "web"
hmr                @deepseek-ai/dsh-base   ← patched by dsh-web-app [disabled]
session-query      @deepseek-ai/dsh-base   ← patched by dsh-web-app

$ npx dsh-xray deps
# disable-cascade (transitive consumers of each provider):
  SessionStore → AgentLoop, ApiProxyService, JsonlSessionPersistence, … (11 plugins)
  ToolRuntime  → AgentLoop, ApiProxyService, DynamicCordisRunnerService, PlanModeController

$ npx dsh-xray cost
~1625 tokens: 1 tool schema(s) ~121 + 19 prompt section(s) ~1504
app:web-surface   ~248   15.3%   ████████
tool:goal         ~184   11.3%   ██████
```

## 全部命令

| 命令 | 回答的问题 |
|---|---|
| `attribute` | 每一行由哪层引入(bundle / profile patch / home patch / repository 源),之后被谁改过 |
| `diff` | 声明 vs 实际:抓出被 dsh 静默跳过的 orphan patch 行、装了没生效的插件 |
| `conflicts` | 同一字段多个写者,谁赢了 |
| `deps` / `health` | 服务依赖图 + 停用级联;每个插件的 fiber 生命周期状态 |
| `cost` | prompt sections(观测自 system-prompt/assemble)+ tool schemas 的 token 估算 |
| `shadow` / `audit` | 多提供者服务;out-of-tree 插件的敏感触点静态扫描(网络/shell/fs/env/eval) |
| `snapshot --against` | 组合树 lockfile 导出与漂移对比 |

另外:

- **`/xray` Web 面板**(dsh web 里直接开,零依赖零构建)
- **`xray_composition` agent 工具** — agent 可以自查"我有哪些能力/为什么 Y 不可用"
- 静态命令(attribute/conflicts/diff/snapshot/audit)**在 dsh 起不来时照样能跑**
- 与恢复类工具(dsh-doctor 等)互补:它们负责"救回来",xray 负责"看清楚"

## 安全立场

只读不执行:patch 里的 `!!js` 解析为不透明标记、绝不求值;audit 是源码文本扫描,不运行插件代码;挂载后只写 `$DSH_HOME/xray/`。

## 安装

```sh
dsh plugin --profile web add dsh-xray   # 挂载(面板 + agent 工具 + 运行时快照)
npx dsh-xray attribute                  # 或者不挂载,直接用静态 CLI
```

- GitHub: https://github.com/alloevil/dsh-xray (MIT, CI on Node 22/24, 39 tests)
- npm: https://www.npmjs.com/package/dsh-xray (发布带 GitHub Actions provenance)

欢迎 issue / PR,特别想听:你们排查 profile 问题时还缺什么视角?

---

## English version

Hi all — I built **dsh-xray**, a diagnostics plugin for three questions I kept hitting while hacking on profiles:

1. `--dump-config` prints 130 rows, but **which layer introduced each one**? When a patch "doesn't take", is the id wrong (silently skipped) or overridden by a later layer?
2. If I disable plugin X, **what breaks transitively**?
3. After installing a pile of plugins, **what does every request actually carry** in context?

Commands: `attribute` (per-row layer attribution), `diff` (declared vs actual — catches orphan patch rows), `conflicts` (last-writer-wins chains), `deps`/`health` (service graph with disable-cascade, fiber lifecycle), `cost` (prompt sections + tool schemas, estimated tokens), `shadow`/`audit` (multi-provider services, capability scan), `snapshot --against` (composition lockfile + drift).

Plus a zero-dependency web panel at `/xray`, and an `xray_composition` tool so agents can introspect their own capability set. Static commands work even when dsh cannot boot. Read-only by design: `!!js` never evaluated, `audit` never executes plugin code.

```sh
dsh plugin --profile web add dsh-xray
```

GitHub: https://github.com/alloevil/dsh-xray · npm: https://www.npmjs.com/package/dsh-xray

Feedback welcome — what else do you wish you could see when a profile misbehaves?
