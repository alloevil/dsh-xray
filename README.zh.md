# dsh-xray

[![npm](https://img.shields.io/npm/v/dsh-xray)](https://www.npmjs.com/package/dsh-xray)
[![CI](https://github.com/alloevil/dsh-xray/actions/workflows/check.yml/badge.svg)](https://github.com/alloevil/dsh-xray/actions/workflows/check.yml)
[![license](https://img.shields.io/npm/l/dsh-xray)](./LICENSE)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 拍 X 光——看清到底加载了什么、为什么在那、以及它悄悄花掉了你什么。

[English](./README.md)

> **状态:0.2.x — 静态 + 运行时成像。** 静态命令在 dsh 起不来时照样能用;`deps`/`health` 和 agent 工具需要插件已挂载。

`dsh --dump-config` 只给你原始组合树,插件面板只给你平铺列表。它们都不回答:这个插件*为什么*在这、停用它会*连带瘫掉什么*、它在*悄悄消耗什么*。dsh-xray 回答这些。

## CLI

```sh
npx dsh-xray attribute   # 每一行由哪层引入、之后被谁 patch 过
npx dsh-xray conflicts   # 哪些行的字段有多个写者、最终谁赢
npx dsh-xray diff        # 声明(静态层)vs 实际(dump-config)组合树
npx dsh-xray snapshot    # 当前生效组合的内容寻址 lockfile
npx dsh-xray deps [svc]  # 服务依赖图:提供者、消费者、停用级联
npx dsh-xray health      # 插件生命周期健康:失败 fiber、等待中的注入、状态迁移史
npx dsh-xray cost        # 每个模型可见工具 schema 的估算 token 占用
npx dsh-xray shadow      # 被多个插件同时提供的服务
npx dsh-xray audit       # 对 out-of-tree 插件做敏感触点静态扫描
```

所有命令支持 `--profile <name>`(默认 `web`)和 `--json`。`diff` 在两棵树不一致时退出码 `1`;`health` 在有插件不健康时退出码 `1`。`attribute`、`conflicts`、`snapshot` 是纯静态的:dsh 起不来时照样能跑。`deps` 和 `health` 读取已挂载插件维护在 `$DSH_HOME/xray/runtime.json` 的运行时快照。

## Agent 工具

挂载进树后,dsh-xray 注册 `xray_composition` 工具(`view: summary | deps | health | cost | shadow`),agent 可以自答"我有哪些能力 / 哪个插件提供 X / 为什么 Y 不可用"。

## 安全立场

dsh-xray 只读不执行。patch 文件里的 loader `!!js` 表达式解析为不透明标记、绝不求值;CLI 从不执行插件代码(`audit` 是对源码文本的模式扫描);挂载的插件只写 `$DSH_HOME/xray/` 目录。详见 [SECURITY.md](./SECURITY.md)。

## 能力

对运行中组合树的诊断成像——与 [dsh-doctor](https://www.npmjs.com/package/dsh-doctor)(救援与恢复)互补。

0.3.x 已交付:

- **来源归因** — 每个活跃插件来自哪一层:内核 bundle / profile 依赖 / `cordis.patch.yml` insert / repository 源
- **声明 vs 实际 diff** — 装了但没生效、卸了但残留 patch 行
- **冲突检测** — 多个插件 patch 同一配置行时,谁静默赢了
- **组合快照** — 把当前生效组合导出为 lockfile,异地一键复现
- **服务依赖图** — 每个服务谁提供、谁消费;停用 X 会级联影响什么(`deps`)
- **运行时健康** — 每个插件的 fiber 生命周期状态、启动失败、状态迁移史(`health`)
- **Agent 自省** — `xray_composition` 工具让 agent 检视自己的能力集

- **能力审计** — 对 out-of-tree 插件的启发式静态扫描:网络外发、shell、文件系统、环境变量、动态求值(`audit`)
- **服务重名检测** — 被多个插件同时提供的服务,及每插件工具/命令注册数(`shadow`)
- **上下文成本** — 每个模型可见工具 schema 的估算 token 占用(`cost`)

## 安装

```sh
dsh plugin --profile web add dsh-xray
```

## 许可证

MIT
