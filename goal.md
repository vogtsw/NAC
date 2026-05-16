# NAC DeepSeek 集群 Agent 目标

> 产品目标：将 NAC 从多 Agent 编排框架升级为 **DeepSeek 原生多 Agent 编程集群** — DeepSeek Pro 做高价值决策，DeepSeek Flash 做低成本并行工作，每次运行都由测试、产物、成本遥测和审查验证。

## 参考基准快照

| 项目 | 本地路径 | 快照版本 | 借鉴什么 |
|---|---|---|---|
| DeepSeek TUI | `D:\test\agent\DeepSeek-TUI` | `81e4b93`，2026-05-12，v0.8.33 | 产品运行时、Plan/Agent/YOLO 模式、持久化子 Agent 会话、工具面、checkpoint/rollback、运行时 API |
| Reasonix | `D:\test\agent\DeepSeek-Reasonix` | `bb5a7f2`，2026-05-13，release 0.41.0 | DeepSeek 专用缓存优先循环、工具调用修复、可见成本/缓存遥测、benchmark 方法论 |

公开参考：DeepSeek TUI <https://github.com/Hmbown/DeepSeek-TUI> | Reasonix <https://github.com/esengine/DeepSeek-Reasonix>

## 执行判断

- **DeepSeek TUI 是产品运行时的更好参考**：展示了如何通过模式、审批、持久化会话、子 Agent、工具 handle、诊断、回滚和 HTTP/SSE 运行时 API 达到产品级品质。
- **Reasonix 是 DeepSeek 经济性的更好参考**：把前缀缓存稳定性作为核心不变式，保持上下文仅追加，修复 DeepSeek 特有的工具调用失败，只在必要时升级到 Pro。
- **NAC 自身的优势不同**：已有 `Orchestrator`、`DAGBuilder`、`Scheduler`、`Blackboard`、`AgentFactory`、`SkillManager`、`DeepSeekModelRouter`、`TeamBuilder`、`ClusterDAGBuilder`、`AgentHandoff`、`ClusterReporter` 和 eval 套件。

```text
NAC = DeepSeek 原生多 Agent 编程集群
```

不是一个单终端助手，不是一个通用的 provider 无关的 Agent。而是一个集群运行时，每个复杂任务都变成一个结构化的 `ClusterRun`，带有 Agent 会话、DAG 步骤、Blackboard 产物、patch/test/review 循环，以及 DeepSeek 感知的成本路由。

## 当前 NAC 状态

### 已有的

- `src/agent/loop.ts`：带类型化 transcript、工具循环检测、压缩和工具执行的单 Agent 工具循环。
- `src/tools/executor.ts`：带路径感知批处理、权限检查、超时处理和密钥脱敏的并行/串行工具执行。
- `src/llm/DeepSeekModelPolicy.ts`：为 `deepseek-v4-pro` 和 `deepseek-v4-flash` 设计的类型化 DeepSeek 模型策略。
- `src/llm/DeepSeekModelRouter.ts`：基于角色的模型路由和成本估算。
- `src/llm/LLMClient.ts`：支持 `thinking` / `reasoning_effort` 参数，`reasoning_content` 提取，缓存命中追踪。
- `src/orchestrator/TeamBuilder.ts`：将任务配置文件转换为协调器/成员计划，5 种协作模式。
- `src/orchestrator/ClusterDAGBuilder.ts`：构建 Planner → Research → Aggregate → Code → Test → Review 集群 DAG。
- `src/orchestrator/AgentHandoff.ts`：结构化的产物交接类型和验证。
- `src/orchestrator/ClusterReporter.ts`：运行时间线、worker、token、产物和成本报告形态。
- `src/skills/builtin/GitSkill.ts`：git status/diff/branch/commit/worktree 操作。
- `src/skills/builtin/PatchSkill.ts`：应用 unified diff 和文件操作。
- `src/skills/builtin/TestRunnerSkill.ts`：检测和运行测试、解析失败、诊断。
- `src/skills/builtin/AgentSpawnSkill.ts`：集群 Agent 生命周期管理（spawn/wait/result/cancel/list）。
- `eval/scenarios/`：60 个场景，覆盖 `boundary`、`tools`、`planning`、`multi-agent`、`security`、`session-state` 和 `real-chat`。
- `tests/deepseek-cluster.test.ts`：30 个测试覆盖模型路由、团队计划、集群 DAG、交接和报告。

### 产品缺口（Codex GPT-5.5 确认）

1. **Orchestrator 集成**：`Orchestrator.ts` 仍使用旧 `AgentRouter`——集群模块存在但未接入主执行路径。
2. **具体 Agent 类**：`CoordinatorAgent`、`PlannerAgent`、`ResearchAgent`、`ReviewAgent` 尚未实现。
3. **`nac cluster` CLI 命令**：产品入口缺失，Plan/Agent/YOLO 模式边界未实现。
4. **缓存感知 Prompt 布局**：`DeepSeekAdapter` 存储了 `thinking`/`reasoningEffort` 但未在 API 调用中发送，未解析缓存命中用量。
5. **Benchmark 场景**：集群级 benchmark 尚未创建。
6. **Worktree 隔离**和侧边 git 回滚未实现。
7. **持久化后台任务队列**未实现。
8. **PR 生成**未实现。

## 产品北极星

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

1. **三种模式**：`plan`（只读）、`agent`（变更需审批）、`yolo`（受信任沙箱）。
2. **持久化子 Agent 面**：`agent_open`、`agent_eval`、`agent_close`，而非一次性 `delegate`。子会话有角色、自己的历史、工具注册表、取消和最终输出契约。
3. **角色分类**：coordinator（分解/合并）、explore（只读映射）、plan（策略）、implementer（编辑）、verifier（测试/诊断）、review（审查）、custom（工具白名单）。
4. **工具 handle**：大输出返回 `var_handle` + 摘要，使用 `handle_read` 做切片。
5. **运行时产品特性**：会话恢复、持久化任务队列、HTTP/SSE API、worktree 回滚、LSP 诊断、实时成本/缓存显示。

### 来自 Reasonix

1. **缓存优先循环**：不可变前缀计算一次并锁定，仅追加日志，易变内容不污染未来缓存命中。
2. **工具调用修复**：扁平化过深 schema、回收 reasoning_content 中的误放调用、修复截断 JSON、检测工具风暴。
3. **成本控制**：默认 Flash 优先，困难轮次 Pro 单轮武装，升级显式记录。
4. **基准测试**：缓存友好 vs 缓存敌对对比、确定性状态谓词、公布成本/轮次/缓存命中。

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
  +-- plan.json / repo_context.json / patch.diff
  +-- test_report.json / review_report.json / final_report.md
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

审批和沙箱必须独立：
- **审批**决定一个工具调用是否可以继续。
- **沙箱**决定即使在审批后进程仍然无法触碰什么。
- **Worktree 隔离**决定多个 implementer 是否可以并发编辑。

## 工具面目标

### P0 工具（已完成 ✅）

- `read_file` ✅ | `list_dir` ✅ | `grep_files` ✅ | `file_search` ✅
- `edit_file` ✅ | `apply_patch` ✅ | `bash` / `run_command` ✅
- `git_status` ✅ | `git_diff` ✅ | `run_tests` ✅ | `diagnostics` ✅
- `task_complete` ✅

### P1 工具（进行中 🟡）

- `agent_open` | `agent_eval` | `agent_close` | `handle_read`
- `git_worktree_create` ✅ | `git_worktree_remove` ✅ | `git_branch` ✅ | `git_commit` ✅
- `mcp_list_servers` | `mcp_call_tool` | `lsp_diagnostics`

### P2 工具

- `task_create` | `task_read` | `task_cancel`
- `checkpoint_create` | `checkpoint_restore`
- `pr_attempt_record` | `pr_attempt_preflight` | `github_pr_context` | `github_comment`

## DeepSeek 模型策略

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

```text
不可变前缀：
- NAC 集群系统提示词
- 按稳定顺序排列的工具 schema
- 角色分类
- 来自 CLAUDE.md 的项目指令
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

## 测试与 Benchmark 策略

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

### 现有 eval 基线（60 场景）

| 层 | 计数 |
|---|---:|
| boundary | 19 |
| tools | 12 |
| planning | 7 |
| multi-agent | 6 |
| session-state | 7 |
| security | 5 |
| real-chat | 4 |

### 新增 benchmark 套件

#### 1. 集群编程 Bench：修复失败测试、跨文件集成测试、添加功能、重构模块、TypeScript 类型错误。
#### 2. 工具使用 Bench：读取摘要、搜索编辑、编辑验证、缺失文件处理、命令回退。
#### 3. 安全 Bench：破坏性命令、路径穿越、prompt injection、密钥泄露、git push 审批。**安全分数必须为 100%。**
#### 4. 缓存与成本 Bench：缓存友好 vs 缓存敌对对比。目标：热会话命中 >= 85%，成本比基线低 30%。
#### 5. 多 Agent 协作 Bench：并行探索、审查→修复→验证、冲突解决、handle 切片、worktree 合并。
#### 6. 有状态任务 Bench：确定性数据库状态、模拟用户、DB 谓词而非 LLM 评判。

### 回归门禁

| 门禁 | 阈值 |
|---|---:|
| Security 层 | 100% |
| 总体场景分数 | 下降不超过 5pp |
| 工具成功率 | >= 95% |
| 集群产物完整度 | >= 95% |
| 缓存命中 热运行 | >= 85% |
| 成本/任务 | 无显式批准不增加 >20% |
| Typecheck | 必须通过 |
| DeepSeek 集群单元测试 | 必须通过 |

## 实现路线图

### Phase 1：DeepSeek API 适配 ✅
- LLMClient 支持 `deepseek-v4-pro` / `deepseek-v4-flash` ✅
- `thinking` enabled/disabled 支持 ✅
- `reasoning_effort` high/max 支持 ✅
- `reasoning_content` 分离存储 ✅
- token usage / cache hit 记录 ✅
- `DeepSeekModelRouter` 基于角色的模型路由 ✅

### Phase 2：集群运行时 ✅
- `TeamBuilder` 组队和模型策略路由 ✅
- `ClusterDAGBuilder` 角色 DAG 生成 ✅
- `AgentHandoff` JSON 交接协议 ✅
- `ClusterReporter` 执行报告 ✅
- Blackboard 产物类型（待接入）

### Phase 3：工程工具面 ✅
- `apply_patch` ✅
- `git_status` / `git_diff` / `git_worktree` ✅
- `run_tests` / `diagnostics` ✅
- `agent_spawn` / `agent_wait` / `agent_result` / `agent_cancel` ✅

### Phase 4：DeepSeek Pro + Flash 并行 🟡
- Pro Coordinator → **待接入 Orchestrator**
- Flash Research Workers → **待接入**
- Flash Test Log Analyzer → **待接入**
- Pro CodeAgent → **待接入**
- Pro ReviewAgent → **待接入**
- cache-aware prompt layout → **待实现**

### Phase 5：产品化
- `nac cluster` 命令
- Plan / Agent / YOLO 模式
- 实时 timeline
- 成本统计
- session resume
- workspace rollback
- PR 生成

### Phase 6：Benchmark 和产品门禁
- 集群编程 bench
- 缓存敌对基线
- 确定性有状态 bench
- 回归门禁

### Phase 7：产品打磨
- 运行时 API 流式事件
- TUI/Web dashboard
- Worktree 隔离
- MCP server 管理
- LSP 诊断注入

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

```bash
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

## 开发经验法则

每个新功能必须回答：
1. 它是否提升了 DeepSeek 原生能力、成本或可靠性？
2. 它是否产生了持久化产物或可衡量的信号？
3. 它能否被确定性断言测试？
4. 它是否在 `plan`、`agent` 和 `yolo` 模式下保持了安全边界？
5. 它是否避免破坏前缀缓存稳定性？

---

## 附录：行业竞争分析

### 1. Anthropic / Claude Code：独立上下文的 Subagents
Claude Code 的 subagent 设计重点是每个子 Agent 有独立上下文、系统提示词和工具权限；coordinator 可给之前调用过的 Agent 发任务。
- **NAC 启发**：做 CoordinatorAgent + 多个独立上下文 WorkerAgent，每个有独立 tools/memory/task thread。

### 2. OpenAI / Codex：多 Agent 并行 + worktree 隔离 + 云端沙箱
Codex 是 cloud-based software engineering agent，多任务并行运行在独立 cloud sandbox 中。
- **NAC 启发**：一个复杂任务 = 一个 ClusterRun；一个子任务 = 一个 isolated worktree；最终由 Coordinator 合并 diff。

### 3. Google / Jules：异步任务 Agent + GitHub 集成
Jules 被描述为 asynchronous coding agent，支持并发任务配额。
- **NAC 启发**：集群能力要体现为多个后台任务同时跑，不是只在一次对话里假装多个角色。

### 4. Microsoft AutoGen：多 Agent 对话框架
AutoGen 核心是 conversable agents，Agent 可互相发送和接收消息。
- **NAC 启发**：Blackboard 只是共享状态，还需要 Agent-to-Agent message/handoff 协议（已实现 ✅）。

### 5. DeepSeek 生态启发
- **Pro + Flash 分工**：主控/规划/审查用 Pro，检索/摘要/测试日志用 Flash。
- **Thinking Mode 作为调度参数**：简单摘要 Flash + thinking off，架构决策 Pro + thinking max。
- **Context Caching**：多个 Agent 的 prompt 要固定结构以命中缓存。
- **Function Calling / Strict Schema**：Agent 间交接应走强结构 JSON schema。

### 最终定位

```text
NAC = DeepSeek-native Multi-Agent Coding Cluster
```

核心卖点：
1. DeepSeek-V4-Pro 主控复杂推理
2. DeepSeek-V4-Flash 低成本并行子 Agent
3. DAG 调度体现真正集群能力
4. Blackboard 记录所有 Agent 产物
5. apply_patch + test loop + review loop 保证工程质量
6. prefix-cache-aware prompt 降低 DeepSeek 使用成本
7. Plan / Agent / YOLO 三模式兼顾安全和效率
