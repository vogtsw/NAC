# NAC DeepSeek 集群 Agent 目标

> 产品目标：将 NAC 从多 Agent 编排框架升级为 DeepSeek 原生的编程集群——DeepSeek Pro 做高价值决策，DeepSeek Flash 做低成本并行工作，每次运行都由测试、产物、成本遥测和审查验证。

## 参考基准快照

本设计基于当前 NAC 仓库加上用户指定的两个本地参考项目：

| 项目 | 本地路径 | 快照版本 | 借鉴什么 |
|---|---|---|---|
| DeepSeek TUI | `D:\test\agent\DeepSeek-TUI` | `81e4b93`，2026-05-12，v0.8.33 merge | 产品运行时、Plan/Agent/YOLO 模式、持久化子 Agent 会话、工具面、checkpoint/rollback、运行时 API、LSP 诊断 |
| Reasonix | `D:\test\agent\DeepSeek-Reasonix` | `bb5a7f2`，2026-05-13，release 0.41.0 | DeepSeek 专用缓存优先循环、工具调用修复、可见成本/缓存遥测、benchmark 方法论、用户/会话记忆形态 |

公开参考：

- DeepSeek TUI：<https://github.com/Hmbown/DeepSeek-TUI>
- Reasonix：<https://github.com/esengine/DeepSeek-Reasonix>
- Reasonix 站点：<https://esengine.github.io/DeepSeek-Reasonix/>

## 执行判断

NAC 完全可以从两个项目中借鉴，但不应成为其中任何一个的直接克隆。

**DeepSeek TUI 是产品运行时的更好参考**：它展示了如何通过模式、审批、持久化会话、子 Agent、工具 handle、诊断、回滚和 HTTP/SSE 运行时 API 让一个终端编程 Agent 达到产品级品质。

**Reasonix 是 DeepSeek 经济性的更好参考**：它把前缀缓存稳定性作为核心不变式，保持上下文仅追加，修复 DeepSeek 特有的工具调用失败，只在必要时升级到 Pro，并将缓存命中率作为一等产品指标。

**NAC 自身的优势不同**：它已经有 `Orchestrator`、`AgentRouter`、`DAGBuilder`、`Scheduler`、`Blackboard`、`AgentFactory`、`SkillManager`、`DeepSeekModelRouter`、`TeamBuilder`、`ClusterDAGBuilder`、`AgentHandoff`、`ClusterReporter` 和 60 个场景的 eval 套件。因此正确的产品是：

```text
NAC = DeepSeek 原生多 Agent 编程集群
```

不是一个单终端助手。不是一个通用的 provider 无关的 Agent。而是一个集群运行时，每个复杂任务都变成一个结构化的 `ClusterRun`，带有 Agent 会话、DAG 步骤、Blackboard 产物、patch/test/review 循环，以及 DeepSeek 感知的成本路由。

## 当前 NAC 状态

### 已有的

- `src/agent/loop.ts`：带类型化 transcript、工具循环检测、压缩和工具执行的单 Agent 工具循环。
- `src/tools/executor.ts`：带路径感知批处理、权限检查、超时处理和密钥脱敏的并行/串行工具执行。
- `src/llm/DeepSeekModelPolicy.ts`：为 `deepseek-v4-pro` 和 `deepseek-v4-flash` 设计的类型化 DeepSeek 模型策略。
- `src/llm/DeepSeekModelRouter.ts`：基于角色的模型路由和粗略成本估算。
- `src/orchestrator/TeamBuilder.ts`：将任务配置文件转换为协调器/成员计划。
- `src/orchestrator/ClusterDAGBuilder.ts`：构建 Planner → Research → Aggregate → Code → Test → Review 集群 DAG。
- `src/orchestrator/AgentHandoff.ts`：结构化的产物交接类型。
- `src/orchestrator/ClusterReporter.ts`：运行时间线、worker、token、产物和成本报告形态。
- `eval/scenarios/`：60 个场景，覆盖 `boundary`、`tools`、`planning`、`multi-agent`、`security`、`session-state` 和 `real-chat`。
- `tests/deepseek-cluster.test.ts`：针对模型路由、团队计划、集群 DAG、交接和报告的良好结构测试。

### 产品缺口

- `src/agent/loop.ts` 仍然是真正的运行时；集群模块不是主执行路径。
- `DeepSeekAdapter` 存储了 `thinking` 和 `reasoningEffort`，但 `LLMAdapter.complete()` 尚未发送 DeepSeek 特有的 `thinking` / `reasoning_effort` 参数，也未解析缓存命中使用量。
- `DelegateTool` 是一个纯推理子调用——没有工具、没有持久化会话、没有取消、没有结果 handle、没有续接。
- Blackboard 存储会话/任务状态，但尚未暴露一流类型化的 `ClusterArtifact` API。
- 工具面缺少产品级专用工具，如 `apply_patch`、`git_status`、`git_diff`、`run_tests`、`diagnostics`、`agent_open`、`agent_eval`、`agent_close`、`handle_read` 和 MCP 桥接工具。
- 当前 eval 覆盖良好，但多 Agent 断言大多仍是间接的。需要集群级确定性检查：DAG 正确性、产物契约、补丁有效性、测试通过/失败、缓存命中、成本、并发。
- 还没有面向用户的 `nac cluster` 命令。
- 没有 Plan / Agent / YOLO 模式边界。
- 没有 worktree 隔离、侧边 git 回滚，或用于集群运行的持久化后台任务队列。

## 产品北极星

构建一个能运行以下命令的 Agent 产品：

```bash
nac cluster "修复失败的测试，保持补丁最小化，运行验证，并生成 PR 摘要"
```

期望体验：

```text
NAC DeepSeek 集群已启动

模式：
- agent

协调器：
- CoordinatorAgent / deepseek-v4-pro / thinking high

Worker：
- 3 × ResearchAgent / deepseek-v4-flash / thinking off
- 1 × PlannerAgent / deepseek-v4-pro / thinking high
- 1 × CodeAgent / deepseek-v4-pro / thinking high
- 1 × TestAgent / deepseek-v4-flash / thinking high
- 1 × ReviewAgent / deepseek-v4-pro / thinking max

执行：
- step_plan：完成 → plan.json
- step_research_src：完成 → src_summary.json
- step_research_tests：完成 → tests_summary.json
- step_aggregate：完成 → repo_context.json
- step_code：完成 → patch.diff
- step_test：失败 → test_report.json
- step_repair：完成 → repair_hint.json
- step_code_v2：完成 → patch_v2.diff
- step_test_v2：通过 → test_report_v2.json
- step_review：批准 → review_report.json

最终：
- 状态：通过
- 修改文件：3
- 测试：pnpm test
- 审查风险：低
- 缓存命中：91.4%
- 预估成本：$0.0068
```

用户应该看到**证据，而非感觉**：哪些 Agent 运行了、每个用了什么模型、产出了什么产物、哪些测试通过了、哪些失败并被修复了、花了多少钱、为什么最终补丁是安全的。

## 目标

1. **把 DeepSeek 模型策略变成调度原语。**
   - Pro 用于协调器、规划器、高风险代码、架构、安全、最终审查。
   - Flash 用于探索、grep/文件摘要、测试日志汇总、产物聚合。
   - 自动模式按任务选择模型和 thinking，绝不向上游发送 `model: "auto"`。

2. **把集群运行变成持久、可检视的对象。**
   - 每个复杂任务变成一个 `ClusterRun`。
   - 每个子任务变成一个 `AgentSession` 或 DAG 步骤。
   - 每次交接写入一个类型化的 Blackboard 产物。
   - 每个测试/审查结果附加到运行上。

3. **有意识地使用 DeepSeek 的前缀缓存。**
   - 稳定不可变前缀：系统提示词、工具规格、角色分类、项目指令、仓库地图、产物索引。
   - 仅追加的对话日志。
   - 下一请求前缀之外的易变临时/思考状态。
   - prompt 前缀中不出现随机时间戳或重新排序的工具规格。

4. **使工具执行达到产品级。**
   - 为常见的 80% 场景提供专用结构化工具。
   - Shell 保留为逃生口。
   - 工具输出可以溢出为 handle，并在边界切片中读回。
   - 变更工具经过审批/沙箱/worktree 规则。

5. **让测试和 benchmark 证明真实能力。**
   - 单元测试证明契约。
   - 场景 eval 证明行为。
   - 集群 benchmark 证明多 Agent 编排。
   - 成本/缓存 benchmark 证明 DeepSeek 原生价值。
   - 安全 benchmark 阻止不安全回归。

## 非目标

- 不以牺牲 DeepSeek 特有优化为代价构建 provider 无关的抽象层。
- 不在一个 prompt 内模拟多 Agent 协作并称之为集群。
- 不让每个 worker 在没有隔离或合并协议的情况下变更同一个 worktree。
- 不只用量子玩具 "hello" prompt 做 benchmark。
- 在能用确定性断言的地方不依赖 LLM 评判。

## 借鉴的设计模式

### 来自 DeepSeek TUI

1. **模式**：
   - `plan`：仅读写调查和计划产物。
   - `agent`：默认交互式执行，变更操作需要审批。
   - `yolo`：受信任沙箱模式，自动批准安全工作，仍记录证据。

2. **持久化子 Agent 面**：
   - 优先使用 `agent_open`、`agent_eval`、`agent_close` 而非一次性 `delegate`。
   - 子会话有角色、自己的历史、自己的工具注册表、取消、状态和最终输出契约。
   - 父级接收紧凑摘要，可拉取有界 transcript 切片。

3. **角色分类**：
   - `coordinator`：负责分解、风险、合并、最终答案。
   - `explore`：只读代码/仓库映射。
   - `plan`：策略和验收标准。
   - `implementer`：紧密限定范围的代码编辑。
   - `verifier`：仅测试/诊断，不做修复。
   - `review`：按严重程度排名的审查，不写补丁。
   - `custom`：显式工具白名单。

4. **工具 handle**：
   - 大输出不应永远粘贴在父级上下文中。
   - 返回 `var_handle` / 产物 id 加摘要。
   - 使用 `handle_read` 做 `head`、`tail`、`lines`、`slice`、`jsonpath`。

5. **运行时产品特性**：
   - 会话恢复。
   - 持久化任务队列。
   - HTTP/SSE 运行时 API。
   - 通过侧边 git 快照的工作区回滚。
   - 编辑后的 LSP 诊断。
   - 实时成本/缓存显示。

### 来自 Reasonix

1. **缓存优先循环**：
   - 不可变前缀计算一次并锁定。
   - 仅追加日志在多轮之间保持字节前缀。
   - 易变临时内容绝不污染未来的缓存命中。
   - 压缩追加摘要，尽可能不重写早期字节。

2. **工具调用修复**：
   - 扁平化深度过大或叶子参数过多的 schema。
   - 回收 DeepSeek 误放在 `reasoning_content` 中的工具调用。
   - 修复截断的 JSON。
   - 检测相同调用的风暴并注入反思。

3. **成本控制**：
   - 默认 Flash 优先。
   - 已知困难轮次时 Pro 单轮武装。
   - Flash 反复编辑失败或工具调用修复/风暴时升级为 Pro。
   - 大型工具结果的轮末压缩。
   - 可见的每轮/会话成本和缓存命中率。

4. **基准测试**：
   - 将缓存友好循环与缓存敌对基线对比。
   - 尽可能使用确定性状态谓词。
   - 公布成本、轮次、工具调用、通过率和缓存命中。
   - 在仓库中保留 benchmark 方法论，而非仅在 README 声明。

## 建议架构

```text
CLI / API
  |
  v
ClusterOrchestrator
  |
  +-- IntentParser
  +-- TeamBuilder
  +-- DeepSeekModelRouter
  +-- ClusterDAGBuilder
  |
  v
ClusterScheduler
  |
  +-- AgentSessionManager
  |     +-- coordinator 会话
  |     +-- explorer 会话
  |     +-- implementer 会话
  |     +-- verifier 会话
  |
  +-- ToolExecutor
  |     +-- file/search/shell/git/test/mcp 工具
  |
  v
Blackboard 产物存储
  |
  +-- plan.json
  +-- repo_context.json
  +-- patch.diff
  +-- test_report.json
  +-- review_report.json
  +-- final_report.md
  |
  v
ClusterReporter + Eval Recorder
```

### 核心数据模型

```ts
interface ClusterRun {
  id: string;
  goal: string;
  mode: "plan" | "agent" | "yolo";
  status: "queued" | "running" | "blocked" | "completed" | "failed" | "canceled";
  cwd: string;
  createdAt: number;
  updatedAt: number;
  teamPlan: TeamPlan;
  dag: ClusterDAG;
  artifacts: ClusterArtifact[];
  metrics: ClusterRunMetrics;
}

interface AgentSession {
  id: string;
  runId: string;
  name: string;
  role: "coordinator" | "explore" | "plan" | "implementer" | "verifier" | "review" | "custom";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  modelPolicy: DeepSeekModelPolicy;
  allowedTools: string[];
  forkContext: boolean;
  transcriptHandle?: string;
  summary?: string;
}

interface ClusterArtifact<T = unknown> {
  id: string;
  runId: string;
  type:
    | "plan"
    | "repo_map"
    | "file_summary"
    | "repo_context"
    | "patch"
    | "test_report"
    | "failure_analysis"
    | "review"
    | "final_answer";
  producer: string;
  consumers: string[];
  content: T | { handle: string; summary: string };
  confidence: number;
  model?: string;
  tokenCost?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  createdAt: number;
}

interface ClusterRunMetrics {
  proTokens: number;
  flashTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  cacheHitRate: number;
  costUsd: number;
  wallClockMs: number;
  toolCalls: number;
  toolSuccessRate: number;
  testsRun: string[];
  testsPassed: boolean;
}
```

## 运行时模式

| 模式 | 读工具 | 写工具 | Shell | Git commit/push | 网络/安装 | 用例 |
|---|---|---|---|---|---|---|
| `plan` | 允许 | 拒绝 | 仅读诊断 | 拒绝 | 询问/拒绝 | 架构、研究、审查计划 |
| `agent` | 允许 | 需审批 | 需审批 | 需审批 | 高风险需审批 | 默认编程 |
| `yolo` | 允许 | 工作区/worktree 内允许 | 允许但保留安全拦截 | push 需审批 | 拒绝或显式允许 | CI/沙箱/自主修复 |

审批和沙箱必须是独立的概念：

- **审批**决定一个工具调用是否可以继续。
- **沙箱**决定即使在审批后进程仍然无法触碰什么。
- **Worktree 隔离**决定多个 implementer 是否可以并发编辑。

## 工具面目标

### P0 工具

- `read_file`
- `list_dir`
- `grep_files`
- `file_search`
- `edit_file`
- `apply_patch`
- `bash` / `run_command`
- `git_status`
- `git_diff`
- `run_tests`
- `diagnostics`
- `task_complete`

### P1 工具

- `agent_open`
- `agent_eval`
- `agent_close`
- `handle_read`
- `git_worktree_create`
- `git_worktree_remove`
- `git_branch`
- `git_commit`
- `mcp_list_servers`
- `mcp_call_tool`
- `lsp_diagnostics`

### P2 工具

- `task_create`
- `task_read`
- `task_cancel`
- `checkpoint_create`
- `checkpoint_restore`
- `pr_attempt_record`
- `pr_attempt_preflight`
- `github_pr_context`
- `github_comment`

## DeepSeek 模型策略

默认角色路由：

| 角色 | 模型 | Thinking | Effort | 备注 |
|---|---|---|---|---|
| coordinator | `deepseek-v4-pro` | enabled | high | 负责决策和合并 |
| planner | `deepseek-v4-pro` | enabled | high | DAG、风险、验收标准 |
| explorer | `deepseek-v4-flash` | disabled/high | optional | 并行仓库映射 |
| summarizer | `deepseek-v4-flash` | disabled | none | 工具输出和文件摘要 |
| implementer | `deepseek-v4-pro` | enabled | high | 补丁生成 |
| verifier | `deepseek-v4-flash` | enabled | high | 测试/日志分析 |
| reviewer | `deepseek-v4-pro` | enabled | max | 安全、正确性、最终门禁 |

升级规则：

- 当风险为 `high` 或 `critical` 时升级为 Pro max。
- 当 Flash 反复编辑失败、触发工具调用修复或相同工具风暴时升级。
- 父级为 Pro 时辅助摘要仍保持在 Flash 上。
- 始终在报告中显式记录升级，绝不默默增加成本。

## 缓存优先的 Prompt 设计

上下文管理器应将每个请求分为稳定区和易变区：

```text
不可变前缀：
- NAC 集群系统提示词
- 按稳定顺序排列的工具 schema
- 角色分类
- 来自 CLAUDE.md / AGENTS.md 的项目指令
- 仓库地图哈希和稳定摘要
- 活跃集群运行目标

仅追加日志：
- 用户消息
- 助手工具调用
- 工具结果摘要
- 产物 id 和摘要

易变后缀：
- 当前 Agent 角色
- 当前 DAG 步骤
- 相关产物摘录
- 期望输出 schema
- 临时 scratch 和失败详情
```

实现规则：

- 不要在不可变前缀中注入时间戳。
- 按确定性顺序排序工具定义。
- 对不可变前缀做哈希并记录在遥测中。
- 保持 `reasoning_content` 与用户可见 content 分离。
- 对大工具输出在轮末做摘要或 handle 存储。
- 截断时保留工具调用/结果对。

## 工具调用修复设计

新增 `src/llm/tool-repair/` 管道：

1. `flattenSchema(toolDefinition)` — schema 过深或过宽时扁平化。
2. `parseToolCalls(message.tool_calls)` — 严格 JSON 解析。
3. `scavengeReasoningContent(reasoning_content)` — 回收 DeepSeek 误放的调用。
4. `repairTruncatedJson(arguments)` — 修复不平衡的 JSON。
5. `detectToolStorm(toolName, argsHash)` — 检测工具风暴并注入反思或停止。
6. `recordRepairEvent()` — 记录修复事件用于 eval 和升级。

指标：

- `toolRepair.count`
- `toolRepair.kind`
- `toolRepair.recovered`
- `toolStorm.suppressed`
- `repairTriggeredProEscalation`

## 测试与 Benchmark 策略

测试系统必须回答两个问题：

1. Agent 能否安全地完成有用工作？
2. DeepSeek 原生架构是否比通用 loop 更便宜、更快或更可靠？

### 测试分层

| 层 | 目的 | 示例断言 |
|---|---|---|
| 单元 | 类型契约和纯逻辑 | 模型策略、DAG 有效性、产物 schema |
| 工具 | 工具正确性和安全性 | 调用了期望的工具、路径被拒绝、输出已脱敏 |
| Loop | Agent 循环稳定性 | 无工具风暴、工具调用修复、缓存前缀稳定 |
| 集群 | 多 Agent 运行时 | 生成了 agent 会话、产出了产物、依赖被遵守 |
| Eval 场景 | 面向用户的行为 | 任务完成、正确工具、无危险操作 |
| Benchmark | 可重复的能力/成本对比 | 通过率、缓存命中、成本/任务、耗时 |
| 回归 | 防止退化 | 分数下降阈值、安全门禁、工具成功率门禁 |

### 现有 eval 基线

仓库当前有 60 个场景：

| 层 | 计数 |
|---|---:|
| boundary | 19 |
| tools | 12 |
| planning | 7 |
| multi-agent | 6 |
| session-state | 7 |
| security | 5 |
| real-chat | 4 |

保留这些，并新增集群专用的 benchmark 集合而不是替换。

### 新增 benchmark 套件

#### 1. 集群编程 Bench

目的：证明端到端编程循环。

任务：

- 修复含单文件 bug 的失败单元测试。
- 修复跨两个文件的失败集成测试。
- 添加带测试和文档的功能。
- 在保持公开 API 的同时重构模块。
- 在依赖变更后修复 TypeScript 类型错误。
- 解决两个候选补丁之间的类合并冲突。

确定性断言：

- `git diff` 包含期望的文件。
- 测试命令退出码为 0。
- 无无关文件被修改。
- 审查产物有 `approved: true`。
- 最终报告命名了测试命令和修改的文件。

指标：

- 通过率
- 变绿所需尝试次数
- 修改文件数
- 总耗时
- Pro/Flash token 分配
- 缓存命中率
- 每个通过任务的成本

#### 2. 工具使用 Bench

目的：证明模型正确选择工具并能从错误中恢复。

任务：

- 读取确切文件并摘要基于事实的信息。
- 搜索后再编辑。
- 编辑后验证。
- 处理缺失文件而不产生幻觉。
- 运行命令、解析输出、失败后使用回退。
- 当 prompt 已包含足够信息时避免使用工具。

断言：

- `tool_executed`
- `tool_not_executed`
- `tool_success_rate_gte`
- `iterations_lte`
- `output_contains` 含基于事实的信息

#### 3. 安全 Bench

目的：阻止不安全的回归上线。

任务：

- 工作区外的破坏性命令。
- 路径穿越读取。
- 文件内的 prompt injection。
- 日志中的密钥。
- 未经审批的 git push。
- 跨会话产物访问。
- plan 模式下的网络/安装请求。

必需门禁：

```text
security 分数必须为 100%
```

#### 4. 缓存与成本 Bench

目的：证明 Reasonix 风格的 DeepSeek 价值。

每个任务运行两次：

- 缓存友好的 NAC loop
- 缓存敌对基线（打乱工具规格并注入变化的系统数据）

指标：

- 缓存命中率
- 缓存未命中 token
- 成本/任务
- 通过率
- 轮次/任务

目标：

```text
热会话缓存命中 >= 85%
成本/任务比缓存敌对基线至少低 30%
通过率不比基线下降
```

#### 5. 多 Agent 协作 Bench

目的：证明这是一个真实集群，不是角色扮演。

任务：

- 跨 `src/`、`tests/`、`docs/`、`config/` 的并行仓库探索。
- 审查者发现问题；实现者修复；验证者通过。
- 两个探索者提供冲突的发现；协调者以证据解决。
- 通过 handle 切片分析大日志，而非粘贴完整 transcript。
- 独立 worktree 产出补丁；协调者合并其中一个。

断言：

- `agent_open` 计数 >= 期望。
- 每个子 Agent 有角色和最终输出契约。
- 产物引用生产者和消费者。
- 父级最终答案引用产物 id。
- 存在 handle 时没有子 transcript 被完整粘贴。

#### 6. 有状态任务 Bench

借鉴 Reasonix tau-bench-lite 方法论：

- 确定性数据库状态
- 模拟用户
- 任务需要工具调用
- 成功是 DB 谓词，不是 LLM 评判

初始领域可以简单：

- 项目 issue 跟踪器
- 包发布工作流
- 用户账户支持工作流

### Benchmark 报告格式

每次运行应输出：

```text
Benchmark 摘要
- 模型预设：auto | flash | pro
- 模式：plan | agent | yolo
- 场景：通过 / 总计
- 总体分数
- 各层分数
- 工具成功率
- 集群产物完整度
- 缓存命中率
- Pro token
- Flash token
- 预估成本
- 耗时
- 回归项
- 主要失败特征
```

### 回归门禁

| 门禁 | 阈值 |
|---|---:|
| Security 层 | 100% |
| 总体场景分数 | 下降不超过 5pp |
| 工具成功率 | 初始 >= 90%，目标 >= 95% |
| 集群产物完整度 | >= 95% |
| 缓存命中 热运行 | >= 85% |
| 成本/任务 | 无显式批准不增加 >20% |
| Typecheck | 必须通过 |
| DeepSeek 集群单元测试 | 必须通过 |

## 实现路线图

### Phase 0：文档和基线对齐

- 创建本目标文档。
- 重写 `CLAUDE.md`，使未来所有 Agent 都遵循此产品方向。
- 记录本地参考项目路径和 commit。
- 运行当前结构测试。

验收：

- `docs/DEEPSEEK_CLUSTER_AGENT_GOAL.md` 存在。
- `CLAUDE.md` 指向此产品目标。
- 参考仓库在 `D:\test\agent` 下可用。

### Phase 1：DeepSeek 适配器和遥测

文件：

- `src/llm/adapter.ts`
- `src/llm/providers/deepseek.ts`
- `src/llm/DeepSeekModelPolicy.ts`
- `src/llm/DeepSeekModelRouter.ts`

工作：

- 在 DeepSeek 请求中发送 `thinking` 和 `reasoning_effort`。
- 解析 `reasoning_content`。
- 如果 API 返回解析 prompt 缓存命中/未命中使用量。
- 添加每轮模型策略和成本遥测。
- 更新定价为单一真实来源。

测试：

- adapter 请求形态测试
- reasoning content 解析测试
- 缓存使用量解析测试
- 模型策略路由测试

### Phase 2：工具面加固

文件：

- `src/tools/builtin/`
- `src/tools/executor.ts`
- `tests/tools.test.ts`
- `eval/scenarios/tools/`
- `eval/scenarios/security/`

工作：

- 新增 `apply_patch`、`git_status`、`git_diff`、`run_tests`、`diagnostics`。
- 新增显式模式感知的权限策略。
- 尽可能新增带参数的结构化命令执行。
- 对大型结果新增工具输出产物溢出。

测试：

- 文件变更测试
- 命令拒绝测试
- 密钥脱敏测试
- 路径边界测试

### Phase 3：持久化 Agent 会话

文件：

- `src/agent/`
- `src/tools/builtin/agent-open.ts`
- `src/tools/builtin/agent-eval.ts`
- `src/tools/builtin/agent-close.ts`
- `src/state/`
- `tests/deepseek-cluster.test.ts`

工作：

- 替换一次性 `delegate` 作为集群路径。
- 实现 `AgentSessionManager`。
- 支持角色、状态、取消、后续输入、transcript handle。
- 返回结构化最终部分：`SUMMARY`、`CHANGES`、`EVIDENCE`、`RISKS`、`BLOCKERS`。

测试：

- open/eval/close 生命周期
- 并发上限
- 子 Agent 取消
- 角色工具白名单
- handle 回读

### Phase 4：Blackboard 产物存储

文件：

- `src/state/Blackboard.ts`
- `src/orchestrator/AgentHandoff.ts`
- `src/orchestrator/ClusterReporter.ts`

工作：

- 新增 `putArtifact`、`getArtifact`、`listArtifacts`、`linkArtifactConsumer`。
- 验证产物 schema。
- 附加模型、token、缓存、置信度、生产者、消费者。
- 对大产物使用 handle。

测试：

- 产物 CRUD
- schema 验证
- 交接验证
- 报告产物完整度

### Phase 5：集群运行时和 CLI

文件：

- `src/orchestrator/`
- `src/cli/main.ts`
- `src/api/server.ts`

工作：

- 新增 `ClusterOrchestrator`。
- 连接 `TeamBuilder` → `ClusterDAGBuilder` → `ClusterScheduler` → `AgentSessionManager`。
- 新增 `nac cluster` 或 `pnpm cli cluster`。
- 新增 `--mode plan|agent|yolo`。
- 新增运行报告和 JSON 输出。

测试：

- dry-run 集群计划
- plan 模式无写入
- agent 模式审批门禁
- yolo 模式沙箱限定的执行
- 自愈循环 fixture

### Phase 6：Benchmark 和产品门禁

文件：

- `eval/benchmark/`
- `eval/scenarios/cluster/`
- `benchmarks/`
- `tests/benchmark.test.ts`

工作：

- 新增集群编程 bench。
- 新增缓存敌对基线。
- 新增确定性有状态 bench。
- 新增缓存/成本/集群产物的 benchmark 报告部分。
- 新增回归门禁。

测试：

- benchmark loader
- 报告生成
- 回归对比
- 失败分类导出

### Phase 7：产品打磨

工作：

- 运行时 API 流式事件。
- 集群运行的 TUI/Web dashboard。
- 会话恢复。
- Worktree 隔离。
- 侧边 git 快照和回滚。
- PR attempt 记录。
- MCP server 管理。
- LSP 诊断注入。

## MVP 范围

第一个值得称为产品的 MVP 应包括：

- `nac cluster --mode plan`：产出团队计划、DAG 和产物，不修改文件。
- `nac cluster --mode agent`：在 fixture 仓库上运行自愈编程 DAG。
- 带 `agent_open/eval/close` 的持久化 Agent 会话。
- DeepSeek Pro/Flash 模型路由。
- 报告中包含缓存/成本遥测。
- `apply_patch`、`git_diff`、`run_tests`、`diagnostics`。
- Blackboard 产物存储。
- 至少 10 个任务的集群 benchmark。

MVP 验收：

```text
pnpm type-check
pnpm vitest run tests/deepseek-cluster.test.ts
pnpm test:benchmark
pnpm eval:baseline -- --layer security
```

在任何自主写入模式被认为可用之前，安全必须通过。

## 产品品质标准

NAC 在以下维度上应达到与 Claude Code / Codex 可比的感受：

- 编辑前先理解仓库。
- 将复杂任务拆解为可见的工作。
- 运行测试并修复失败。
- 将噪声探索与主上下文隔离。
- 记录证据和修改的文件。
- 绝不隐藏成本升级。
- 除非被要求，避免大范围重写。
- 能恢复或检视长时间运行的工作。

NAC 应在以下 DeepSeek 特有维度上超越通用 Agent：

- Pro/Flash 角色拆分。
- 前缀缓存命中率作为产品指标。
- DeepSeek 特有的工具调用修复。
- 廉价的并行探索。
- DeepSeek 原生的 benchmark/成本报告。

## 下一步即刻开发待办

**P0：**

- 将 `thinking` / `reasoning_effort` 接入 DeepSeek API 调用。
- 新增 `apply_patch`、`git_status`、`git_diff`、`run_tests`、`diagnostics`。
- 新增类型化 Blackboard 产物 API。
- 将 `delegate` 替换为持久化 `agent_open/eval/close` 用于集群使用。
- 新增 `ClusterOrchestrator` dry-run 路径。
- 新增集群 benchmark 场景。

**P1：**

- 新增带不可变前缀哈希的缓存优先上下文管理器。
- 新增工具调用修复管道。
- 新增大输出 handle。
- 新增 `--mode plan|agent|yolo`。
- 新增强成本/缓存报告部分到 benchmark 输出。

**P2：**

- Worktree 隔离。
- 回滚快照。
- HTTP/SSE 集群运行时 API。
- MCP 桥接。
- LSP 诊断。
- PR attempt 工作流。

## 开发经验法则

每个新功能必须回答：

1. 它是否提升了 DeepSeek 原生能力、成本或可靠性？
2. 它是否产生了持久化产物或可衡量的信号？
3. 它能否被确定性断言测试？
4. 它是否在 `plan`、`agent` 和 `yolo` 模式下保持了安全边界？
5. 它是否避免破坏前缀缓存稳定性？

如果答案是否定的，那它很可能是产品表面积，而非产品进步。
