<p align="center">
  <img src="./assets/hero.svg" width="100%" alt="dsh-xray — 给你的 DeepSeek Harness 拍 X 光">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-xray"><img src="https://img.shields.io/npm/v/dsh-xray?style=flat-square&color=00d4aa" alt="npm"></a>
  <a href="https://github.com/alloevil/dsh-xray/actions/workflows/check.yml"><img src="https://img.shields.io/github/actions/workflow/status/alloevil/dsh-xray/check.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/dsh-xray?style=flat-square" alt="license"></a>
</p>

<p align="center">
  <strong>给 <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> 拍 X 光</strong>——看清到底加载了什么、为什么在那、以及它悄悄花掉了你什么。
</p>

<p align="center">
  <a href="./README.md">English</a>
</p>

![dsh-xray 演示](./docs/demo.svg)

> **状态:0.6.x — 静态 + 运行时成像、上下文成本归因、Web 面板。** 静态命令在 dsh 起不来时照样能用;`deps`/`health`/`cost`/`shadow` 和 agent 工具需要插件已挂载。

`dsh --dump-config` 只给你原始组合树,插件面板只给你平铺列表。它们都不回答:这个插件*为什么*在这、停用它会*连带瘫掉什么*、它在*悄悄消耗什么*。dsh-xray 回答这些。

## CLI

```sh
npx dsh-xray attribute   # 每一行由哪层引入、之后被谁 patch 过
npx dsh-xray conflicts   # 哪些行的字段有多个写者、最终谁赢
npx dsh-xray diff        # 声明(静态层)vs 实际(dump-config)组合树
npx dsh-xray snapshot    # 当前生效组合的内容寻址 lockfile
npx dsh-xray deps [svc]  # 服务依赖图:提供者、消费者、停用级联
npx dsh-xray health      # 插件生命周期健康:失败 fiber、等待中的注入、状态迁移史
npx dsh-xray cost        # 上下文成本:prompt sections + 工具 schema 的估算 token 占用
npx dsh-xray shadow      # 被多个插件同时提供的服务
npx dsh-xray audit       # 对 out-of-tree 插件做敏感触点静态扫描
```

所有命令支持 `--profile <name>`(默认 `web`)和 `--json`。`diff` 在两棵树不一致时退出码 `1`;`health` 在有插件不健康时退出码 `1`。`attribute`、`conflicts`、`snapshot` 是纯静态的:dsh 起不来时照样能跑。`deps` 和 `health` 读取已挂载插件维护在 `$DSH_HOME/xray/runtime.json` 的运行时快照。

## 长什么样

启动树的每一行,归因到引入它的层——以及之后谁 patch 过它:

```console
$ npx dsh-xray attribute
# 130 rows in profile "web"

timer                        @deepseek-ai/dsh-base
hmr                          @deepseek-ai/dsh-base    ← patched by @deepseek-ai/dsh-web-app [disabled]
llm                          @deepseek-ai/dsh-base
session-query-sqlite         @deepseek-ai/dsh-base    ← patched by @deepseek-ai/dsh-web-app
...
```

停用一个 provider 会连带瘫掉什么——从真实服务存储算出来,不是猜的:

```console
$ npx dsh-xray deps
# disable-cascade (transitive consumers of each provider):
  Loader → 5 plugin(s): AgentPresets, ClientModuleRegistry, Hmr, Include, PluginInventoryGateway
  TimerService → 1 plugin(s): Hmr
  SessionProjectionRegistry → 1 plugin(s): SessionProjectionCache
```

哪些字段有多个写者、谁静默赢了:

```console
$ npx dsh-xray conflicts
session-query-sqlite
  .config: @deepseek-ai/dsh-base → @deepseek-ai/dsh-web-app  (winner: @deepseek-ai/dsh-web-app)
tool-bash
  .disabled: @deepseek-ai/dsh-base → @deepseek-ai/dsh-web-app  (winner: @deepseek-ai/dsh-web-app)
```

每次请求实际携带什么——assembly 时观测到的 prompt sections,与工具 schema 合并计价:

```console
$ npx dsh-xray cost
~1625 tokens: 1 tool schema(s) ~121 + 19 prompt section(s) ~1504

# prompt sections (observed at last assembly):
app:web-surface                  ~248     15.3%   ████████
tool:goal                        ~184     11.3%   ██████
tool:ralph                       ~109     6.7%    ███
harness:source                   ~94      5.8%    ███
...
```

patch 行指向不存在的 id 时(dsh 静默跳过),`diff` 能抓到:

```console
$ npx dsh-xray diff
orphan overrides (silently skipped) (1)
  no-such-row in ~/.dsh/profiles/web/cordis.patch.yml
```

## Agent 工具

挂载进树后,dsh-xray 注册 `xray_composition` 工具(`view: summary | deps | health | cost | shadow`),agent 可以自答"我有哪些能力 / 哪个插件提供 X / 为什么 Y 不可用"。

## Web 面板

在 `dsh web` 中挂载后,插件在 **`/xray`** 提供零依赖面板——summary、health、deps(含停用级联表)、cost、shadow 五个视图,数据实时来自运行中的组合树;`/xray/api/*` 提供同源 JSON。

![/xray 面板:deps 视图与停用级联表](./assets/panel-deps.webp)

## 安全立场

dsh-xray 只读不执行。patch 文件里的 loader `!!js` 表达式解析为不透明标记、绝不求值;CLI 从不执行插件代码(`audit` 是对源码文本的模式扫描);挂载的插件只写 `$DSH_HOME/xray/` 目录。详见 [SECURITY.md](./SECURITY.md)。

## 能力

对运行中组合树的诊断成像——与 [dsh-doctor](https://www.npmjs.com/package/dsh-doctor)(救援与恢复)互补。

0.4.x 已交付:

- **来源归因** — 每个活跃插件来自哪一层:内核 bundle / profile 依赖 / `cordis.patch.yml` insert / repository 源
- **声明 vs 实际 diff** — 装了但没生效、卸了但残留 patch 行
- **冲突检测** — 多个插件 patch 同一配置行时,谁静默赢了
- **组合快照** — 把当前生效组合导出为 lockfile,异地一键复现
- **服务依赖图** — 每个服务谁提供、谁消费;停用 X 会级联影响什么(`deps`)
- **运行时健康** — 每个插件的 fiber 生命周期状态、启动失败、状态迁移史(`health`)
- **Agent 自省** — `xray_composition` 工具让 agent 检视自己的能力集

- **能力审计** — 对 out-of-tree 插件的启发式静态扫描:网络外发、shell、文件系统、环境变量、动态求值(`audit`)
- **服务重名检测** — 被多个插件同时提供的服务,及每插件工具/命令注册数(`shadow`)
- **上下文成本** — prompt sections(观测自 system-prompt/assemble)+ 工具 schema 的估算 token 占用(`cost`)

## 安装

```sh
dsh plugin --profile web add dsh-xray
```

## 许可证

MIT
