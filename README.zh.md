# dsh-xray

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 拍 X 光——看清到底加载了什么、为什么在那、以及它悄悄花掉了你什么。

[English](./README.md)

> **状态:0.1.x — 静态成像。** CLI 现在就能用,即使 dsh 起不来。运行时成像(依赖图、健康状态、上下文成本)在 0.2.0 落地。

`dsh --dump-config` 只给你原始组合树,插件面板只给你平铺列表。它们都不回答:这个插件*为什么*在这、停用它会*连带瘫掉什么*、它在*悄悄消耗什么*。dsh-xray 回答这些。

## CLI

```sh
npx dsh-xray attribute   # 每一行由哪层引入、之后被谁 patch 过
npx dsh-xray conflicts   # 哪些行的字段有多个写者、最终谁赢
npx dsh-xray diff        # 声明(静态层)vs 实际(dump-config)组合树
npx dsh-xray snapshot    # 当前生效组合的内容寻址 lockfile
```

所有命令支持 `--profile <name>`(默认 `web`)和 `--json`。`diff` 在两棵树不一致时以退出码 `1` 结束——被 dsh 静默跳过的 orphan patch 行、装了但未生效的插件、disabled 状态不匹配。`attribute`、`conflicts`、`snapshot` 是纯静态的:dsh 起不来时照样能跑。

## 能力

对运行中组合树的诊断成像——与 [dsh-doctor](https://www.npmjs.com/package/dsh-doctor)(救援与恢复)互补。

0.1.x 已交付:

- **来源归因** — 每个活跃插件来自哪一层:内核 bundle / profile 依赖 / `cordis.patch.yml` insert / repository 源
- **声明 vs 实际 diff** — 装了但没生效、卸了但残留 patch 行
- **冲突检测** — 多个插件 patch 同一配置行时,谁静默赢了
- **组合快照** — 把当前生效组合导出为 lockfile,异地一键复现

规划中:

- **服务依赖图** — 谁 `inject` 了谁的服务;停用 X 会级联影响什么
- **运行时健康** — 每个插件的 scope 状态:激活失败与堆栈、加载耗时、HMR 重载次数
- **能力审计** — 已装插件实际触碰什么:网络外发、shell、文件系统、环境变量;更新前后权限 diff
- **命令/工具重名检测** — 注册同名命令/工具时,谁静默覆盖谁
- **上下文成本** — 每个插件往 agent 上下文注入多少 token:工具 schema、prompt 片段、skill 文档
- **Agent 自省** — 把组合信息暴露为 tool,让 agent 知道自己有哪些能力

## 安装

```sh
dsh plugin --profile web add dsh-xray
```

## 许可证

MIT
