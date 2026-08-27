# intent — 上下文归因(一期)+ 逐请求账单(二期)

拍板日期:2026-08-25。共识基准:本文件。变更方案先改这里。

## 背景

cost 视图已能列出 prompt sections 和工具 schema 的 token,但回答不了
「这段上下文是**谁**放进来的、禁用它能省多少」。目标是把
section → 插件 → token 的归因链打通,让用户能做上下文预算决策,
并与 attribute / deps 视图形成闭环:
看到成本 → 查禁用级联 → patch 禁用 → 验证生效。

## 一期:来源归因视图(先做)

### 目标

cost 视图新增「来源归因」维度(或 cost 内新小节):每个 prompt
section 和每个工具 schema 归属到注册它的插件;skill 内容归属到
skill 工具(其内容经 ToolResult 进入 messages,不在 system prompt)。

### 数据通路(调研已确认,2026-08-25)

- `ctx.systemPrompt.section()` 经 `layers.effect(调用方 ctx)` 注册,
  effect 落在调用方插件的 fiber 上,label 为 `"systemPrompt.section()"`;
  xray 已采集 fiber effects 树(`lib/collect/runtime.js`)。
- **第一步实验**:验证 effect meta 能否读出 section name。
  读不出则改为观测 `system-prompt/change` 事件,增量维护
  name → fiber 映射。两条路都不改宿主。
- 工具 schema → 插件:tools registry 反查(shadow 视图已有同类统计)。
- section 名前缀约定(`tool:` / `app:` / `harness:` / `deployment:`)
  作为分类展示辅助,不作为归因依据(归因以 fiber 为准)。

### 展示(cost 视图内)

- 每行 section/schema 增加「归属插件」列;
- 按插件聚合的 rollup:插件 × (sections + schemas) × token/请求;
- 无法归因的条目诚实标注 `unattributed`;
- 与 deps 联动提示:归因行点开显示该插件的 disable-cascade 摘要
  (数据自现有 serviceGraph,不新增采集)。

### 验收标准

1. 离线渲染测试:归因表含 `tool:goal → dsh-tool-goal` 这类真实映射
   (以本机 live 快照为 fixture);
2. `xray_composition` 工具与 `/xray/api/cost` 同步输出归因字段;
3. 现有 cost 视图行为不回归(渲染测试全过);
4. biome 零 error;npm test 不新增失败。

### 明确不做

- 不落任何消息/section 正文到磁盘(runtime.json 只存 name/token/归属);
- 不修改宿主任何行为(纯观测,waterfall 原样 next());
- 不做「一键禁用」按钮(只展示 patch 提示文本,写 patch 是用户的事)。

## 一期附加:视图解释文案(方案 B,拍板 2026-08-26)

每视图顶部一行"问题导向"说明(muted),关键术语/列头加原生
`title` tooltip;空状态给行动指引。范围:panel.js + client.js 双 UI。
不做:可折叠长帮助块(长解读归 README)。

## 一期附加 2:tab 面板 locale 接入(方案 A,拍板 2026-08-26)

client.js 走宿主 locale 体系(`ctx.locale.register('xray', {zh, en})`
+ slot `locale` 选项 + 组件 `t()`),intro/tooltip/加载与错误提示随
宿主语言设置即时切换。`/xray` 独立页保持英文——降级诊断通道,维持
零依赖零状态;README.zh 承担中文教学。
不做:独立页 navigator.language 探测或 ?lang= 参数(与宿主设置不一致
的"半支持"反而招 issue,需求出现时再补)。

## 一期附加 3:entry 原文按需查看(方案 B,拍板 2026-08-26)

回答"这个 section/工具 schema 的 ~N tokens 具体是什么文本":

- 新端点 `/xray/api/entry?kind=section|tool&name=<name>`:请求时从
  live registry(systemPrompt.layers / tools.layers,归因同源)实时
  读取该条目的文本/schema 返回,**不持久化**(runtime.json 仍只存
  name/token/owner,"不落正文"承诺不变——禁的是落盘,不是按需读取);
- 返回附字符数与估算说明("~4 chars/token"),数字可自行核验;
- tab UI:cost 视图 section/tool 名可点击,弹层显示原文;
  by-plugin 行可展开列出该插件的全部条目(owners[].entries 已有);
  summary 的 context tokens 行加"见 cost 视图"提示;
- SECURITY.md 补边界:entry 端点仅返回组合层文本(插件贡献的
  prompt/schema),绝不返回会话消息。
- 不做:原文落盘、全文搜索、diff(需求出现再议)。

## 二期:逐请求账单(一期验收后再开工)

### 目标

挂 `llm/stream` waterfall(调研确认:GenerateOptions 含完整
system/messages/tools/purpose/sessionId),按请求记录分类 token:
system / tool schemas / history / tool-results,ring buffer
(每 session 最近 50 条)入 runtime.json。

### 展示

- 每请求一行 + 分类堆叠条 + Δprev 增量列;
- purpose 标签区分 compaction/session-title 辅助调用;
- 工具结果按工具名聚合 top-N(skill 结果自然单列);
- 前缀稳定性标记(system+tools 与上一请求逐字节一致 → ⚡,否则 ✂)。

### 明确不做(二期)

- 不存消息正文(只存分类计数 + 来源标识:工具名/消息序号/section 名);
- 不渲染请求内容(内容是 Trajectory 的地盘,xray 只做计量与归因);
- 完整请求快照(方案 C)永不默认开启。

## 发布

一期完成 → 0.8.0(feat)。二期完成 → 0.9.0。均走 tag 触发 CI 发布。
