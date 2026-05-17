# NAC DeepSeek 集群真实工程闭环修改与测试方案（2026-05-17）

> **当前状态**：DeepSeek-aware cluster orchestration prototype，集群路径已真实接入 CLI → Orchestrator → TeamBuilder → ClusterDAGBuilder → Scheduler → AgentFactory → agents。30 个 cluster 单元测试全部通过，type-check 通过。但 ClusterRunStore、AgentSessionManager、patch/test/review 硬闭环、ApprovalManager、cache-aware prompt 均未实现。**Codex 审计评分：产品就绪度 ~35%。**

## 已完成 ✅

| 项目 | 状态 | 说明 |
|---|---|---|
| CLI `cluster` 命令 | ✅ | `src/cli/main.ts:149` runCluster()，支持 --mode plan/agent/yolo，--dry-run，--json |
| DeepSeek Pro/Flash 路由接入 API | ✅ 3108cab | LLMClient.completeWithMeta() 使用 options.model，model/thinking/reasoningEffort 通过 ClusterDAGBuilder→AgentFactory→BaseAgent→LLMClient 全链路传递 |
| 集群 DAG 执行路径 | ✅ c8b917f | Orchestrator.processRequest() 中 useClusterPath=true 时走 TeamBuilder→ClusterDAGBuilder→Scheduler |
| Blackboard artifact 持久化 | ✅ | Orchestrator 中 step 结果转为 ClusterArtifact 并调用 blackboard.putArtifact() |
| Secret redaction (P0 安全) | ✅ fad896b | agent 输出中密钥脱敏 |
| DeepSeekPricing 统一定价 | ✅ | `src/llm/DeepSeekPricing.ts` |
| Disciplined loop | ✅ | `src/agent/disciplined-loop.ts` |
| MCP Skill | ✅ | `src/skills/builtin/MCPSkill.ts` |
| PR Generator | ✅ | `src/orchestrator/PRGenerator.ts`（未在 cluster 上下文中测试）|
| Gap analysis 脚本 | ✅ 65b5141 | `scripts/gap-analysis.ts`，自动检查 source/test/eval 声明 |
| SWE-bench 集成 | ✅ 6a1ebe0 | 真实 GitHub issue 评估 harness |
| Tool repair 管道 | ✅ | 6 模块：flatten-schema, scavenge-reasoning, repair-json, detect-storm, repair-log, repair-pipeline |
| ResearchAgent 真实文件扫描 | ✅ | 使用 file-ops skill 列出目录/读文件，产出 RepoContextArtifact |
| TestAgent 支持显式 testCommand | ✅ | 优先使用 run-tests skill，缺失 testCommand 时标记 skipped |

## 🐛 新发现的 Bug（本次审计）

| # | Bug | 严重度 | 位置 |
|---|---|---|---|
| 1 | **Mode gate 传播断裂**：Scheduler.executeWithValidation() 调用时未传递 mode 和 toolGate，导致 mode 检查可被绕过 | 🔴 P0 | `Scheduler.ts:207` → `TaskExecutor.ts:306` |
| 2 | `--dry-run` 已解析但未在 cluster 路径中实际执行 | 🟡 P1 | `cli/main.ts:176` |
| 3 | ClusterReporter timeline 方法未被运行时代码调用 | 🟡 P1 | `ClusterReporter.ts` |
| 4 | `ModeToolGate.ts` 和 `tests/cluster-runtime-fixes.test.ts` 处于 untracked 状态，仓库不可复现 | 🟡 P1 | 工作区 |
| 5 | Benchmark 数据过期（2026-05-10），早于 5 月 16 日的重要提交 | 🟡 P1 | `eval/reports/benchmark-result.md` |
| 6 | Cluster agents（Coordinator/Planner/Review）多数是 LLM prompt wrapper，无真实产物生产 | 🟡 P1 | `agents/cluster/` |

## 完成定义

一个功能只有同时满足以下条件，才允许在本文档中标为完成：

- 运行时路径真实接入，而不是只在测试或报告 metadata 中出现。
- 产物写入 Blackboard，并能通过 runId 检索。
- 如果涉及模型路由，真实 API 请求体必须使用该模型、thinking 和 reasoning_effort。
- 如果涉及代码修改，必须产生可应用 patch，并能通过 git diff 或文件内容验证。
- 如果涉及测试，必须运行显式 testCommand，记录 stdout/stderr、exitCode、pass/fail 和失败分析。
- 如果涉及 benchmark，必须落盘 JSONL/JSON 报告，包含 pass/fail、token、cache、cost、duration、tool calls、artifact completeness。
- 安全边界必须被自动化测试覆盖，不能只靠 prompt 约束。

## P0.1：修复 mode gate 传播断裂 🔴（本次审计发现的关键 bug）

目标：Scheduler → TaskExecutor 调用链中补上 mode 和 toolGate 参数，确保 plan/agent/yolo 模式在每次工具调用时都被强制检查。

现状：`ModeToolGate.ts` 已存在（untracked），`Orchestrator.processRequest()` 正确传了 mode/toolGate 给 Scheduler.schedule()，但 `Scheduler.ts:207` 调用 `executeWithValidation()` 时未传递 mode/toolGate，而 `TaskExecutor.ts:306` 期望接收这两个参数——这意味着 plan mode 下的写操作实际可能不会被拦截。

### 修改方法

- 修改 `src/orchestrator/Scheduler.ts`
  - `executeWithValidation()` 调用增加 `mode` 和 `toolGate` 参数传递。
  - 确保所有执行路径（schedule/scheduleParallel/scheduleSequential）都传递 mode。
- 修改 `src/orchestrator/TaskExecutor.ts`
  - 在 tool call 前调用 `toolGate(toolName, mode, params)` 检查。
  - 被拒绝的工具调用记录到 task result 的 deniedTools 字段。
- 将 `src/security/ModeToolGate.ts` 加入 git 跟踪并提交。

### 测试方法

- 新增测试到 `tests/mode-approval-sandbox.test.ts` 或 `tests/cluster-runtime-fixes.test.ts`
  - plan mode 下通过 Scheduler 执行 file_write 被拒绝。
  - agent mode 下通过 Scheduler 执行 git_push 被拒绝。
  - yolo mode 下通过 Scheduler 执行 workspace 内写操作被允许。

### 验收命令

```bash
pnpm vitest run tests/mode-approval-sandbox.test.ts tests/cluster-runtime-fixes.test.ts
```

---

## P0.2：把 ClusterRun 做成一等运行时对象

目标：每次 `nac cluster` 都创建一个可恢复、可检视、可 benchmark 的 `ClusterRun`，而不是临时在 `Orchestrator.processRequest()` 中拼一个结果对象。

### 修改方法

- 新增 `src/orchestrator/ClusterRunStore.ts`
  - 定义 `ClusterRun`、`ClusterRunMetrics`、`ClusterRunEvent`。
  - 支持 `createRun()`、`updateRunStatus()`、`appendEvent()`、`recordArtifact()`、`recordMetrics()`、`getRun()`、`listRuns()`。
  - 默认使用 Blackboard memory/Redis 存储，文件落盘作为后续增强。
- 修改 `src/orchestrator/Orchestrator.ts`
  - cluster path 开始时创建 `ClusterRun`，runId 作为唯一真实 id。
  - Scheduler 执行每个 DAG step 前后写入 run event。
  - final report 从 `ClusterRunStore` 汇总，不再只从本地变量汇总。
- 修改 `src/state/Blackboard.ts`
  - artifact API 保持现有能力，但新增按 runId + artifact type 读取最新 artifact 的便捷方法。
- 修改 `src/orchestrator/ClusterReporter.ts`
  - 输入改为 `ClusterRun` 快照。
  - 区分 estimated metrics 与 actual metrics，报告中禁止把估算值伪装成真实值。

### 测试方法

- 新增 `tests/cluster-run-store.test.ts`
  - 创建 run 后可读取。
  - DAG step start/complete/fail 事件顺序可追踪。
  - artifact 可按 runId 和 type 检索。
  - metrics 可累加 token/cache/cost。
- 扩展 `tests/cluster-runtime-fixes.test.ts`
  - cluster path 执行后必须存在 `ClusterRun`。
  - `ClusterRun.runId === teamPlan.runId === artifact.runId`。

### 验收命令

```bash
pnpm type-check
pnpm vitest run tests/cluster-run-store.test.ts tests/cluster-runtime-fixes.test.ts
```

## P0.3：实现真实 AgentSession，而不是一次性 agent.execute

目标：每个子 Agent 有独立 session、角色、模型策略、工具权限、transcript、状态和最终产物，满足 `goal.md` 中 `AgentSession` 的要求。

### 修改方法

- 新增 `src/agents/AgentSessionManager.ts`
  - 支持 `openSession()`、`evalSession()`、`closeSession()`、`cancelSession()`、`getSession()`。
  - session 字段包含 runId、role、agentType、modelPolicy、allowedTools、status、transcript、artifactIds。
- 改造 `src/skills/builtin/AgentSpawnSkill.ts`
  - 不再维护独立的临时内存 registry。
  - 复用 `AgentSessionManager`，让 CLI、Orchestrator、skill 调用走同一套 session runtime。
- 修改 `src/orchestrator/TaskExecutor.ts`
  - cluster mode 下不直接 `AgentFactory.create(...).execute(task)`。
  - 改为打开或复用 AgentSession，再执行 step。
- 每个 session 的 LLM 请求必须记录：
  - requested model
  - actual model
  - thinking
  - reasoning_effort
  - prompt/completion/reasoning/cache tokens
  - duration

### 测试方法

- 新增 `tests/agent-session-manager.test.ts`
  - open/eval/close/cancel 全链路。
  - 每个 session 有独立 transcript。
  - 不同角色工具白名单不同。
  - session 结束后 artifactIds 可回查。
- 增加一个集成测试：
  - pipeline run 至少产生 Planner/Research/Code/Test/Review session。
  - 每个 session 的 modelPolicy 与 DAG step 一致。

### 验收命令

```bash
pnpm vitest run tests/agent-session-manager.test.ts tests/cluster-integration.test.ts
```

## P0.4：代码修改必须进入真实 patch/test/review 闭环

目标：CodeAgent 不能只返回自然语言或 JSON patch 形状，必须能产出真实可应用 patch，并经过 test/review 验证。

### 修改方法

- 修改 `src/agents/CodeAgent.ts`
  - cluster patch step 输出 `PatchArtifact`。
  - `PatchArtifact.files[].diff` 必须是 unified diff，或者 `files[].newContent` 必须能通过 `apply-patch` 转换成文件修改。
  - 如果 LLM 返回非法 JSON 或无文件变更，step 标记 partial/failed，不允许静默成功。
- 修改 `src/skills/builtin/PatchSkill.ts`
  - 先 `git apply --check`。
  - 再 apply。
  - apply 后读取 `git diff --stat` 和 `git diff --name-only` 作为证据。
  - 返回 `PatchApplyArtifact`：applied、filesChanged、diffStat、errors。
- 修改 `src/agents/cluster/TestAgent.ts`
  - 只接受显式 `testCommand`。
  - 测试结果必须结构化为 `TestReportArtifact`。
  - 不允许把 DAG step 描述当 shell command。
- 修改 `src/agents/cluster/ReviewAgent.ts`
  - 输入必须包含 patch artifact、test report artifact、git diff evidence。
  - 输出 `ReviewArtifact`，包含 approved、riskLevel、severity issues。
- 修改 `src/orchestrator/ClusterDAGBuilder.ts`
  - self-healing 模式下，如果 `TestReportArtifact.failed > 0`，必须进入 repair/code_v2/test_v2。
  - 如果 testCommand 缺失，测试 step 标记 skipped，不把 run 标成 completed。

### 测试方法

- 新增 `tests/fixtures/cluster-bugfix/`
  - 一个最小 TypeScript 项目。
  - 内置一个失败测试。
  - 明确修复后应通过。
- 新增 `tests/cluster-patch-loop.test.ts`
  - 使用 fake LLM 返回 unified diff。
  - 验证 patch 被 apply。
  - 验证 test command 被执行。
  - 验证 test failed 时进入 repair loop。
  - 验证 review artifact 引用 patch 和 test report。
- 新增 `tests/patch-skill-apply.test.ts`
  - valid diff 可应用。
  - invalid diff 不修改文件。
  - apply 后返回 diffStat。

### 验收命令

```bash
pnpm vitest run tests/patch-skill-apply.test.ts tests/cluster-patch-loop.test.ts
pnpm test
```

## P0.5：安全、审批、沙箱、worktree 必须形成强制链路

目标：`plan`、`agent`、`yolo` 不只是 CLI 参数，而是每一次工具调用都会被强制检查。

### 修改方法

- 保留并扩展 `src/security/ModeToolGate.ts`
  - plan：只允许 read/list/grep/glob/diagnostics。
  - agent：写文件、shell、网络、git write 必须走 approval decision。
  - yolo：允许 workspace/worktree 内写和 shell，但 git push、外部路径、危险删除仍拒绝。
- 新增 `src/security/ApprovalManager.ts`
  - 支持 decision：allow / deny / ask。
  - CLI 下 ask 输出待审批请求。
  - 测试中可注入 deterministic approval policy。
- 修改 `src/skills/SkillManager.ts`
  - 所有 skill 调用先经过 mode gate，再经过 permission manager，再执行 skill。
- 修改 `src/skills/builtin/GitSkill.ts`
  - implementer 写入必须先创建 isolated worktree。
  - run 完成后由 coordinator 合并 diff。
- 修改 `src/orchestrator/ClusterDAGBuilder.ts`
  - 多个 CodeAgent 并行时必须分配不同 worktree。

### 测试方法

- 新增 `tests/mode-approval-sandbox.test.ts`
  - plan mode 写文件被拒绝。
  - agent mode 写文件返回 approval required。
  - yolo mode 允许 workspace 内写，拒绝 workspace 外路径。
  - git push 在所有模式下默认拒绝。
- 新增 `tests/worktree-isolation.test.ts`
  - 两个 implementer 不写同一个工作区。
  - 合并冲突被记录为 review/merge artifact。

### 验收命令

```bash
pnpm vitest run tests/mode-approval-sandbox.test.ts tests/worktree-isolation.test.ts
pnpm eval:run -- --layer security
```

## P1.1：DeepSeek cache-aware prompt 布局进入 cluster agents

目标：缓存命中不是报告装饰，而是 prompt 结构的一等约束。

### 修改方法

- 修改 `src/agent/context.ts` 或新增 `src/llm/ClusterPromptBuilder.ts`
  - 不可变前缀：系统规则、工具 schema、角色分类、项目指令、repo map hash、artifact index。
  - append-only 日志：用户消息、工具调用摘要、artifact id。
  - 易变后缀：当前 DAG step、相关 artifact 摘要、输出 schema。
- 所有 cluster agents 统一走 `ClusterPromptBuilder`。
- `LLMClient.completeWithMeta()` 记录 prefixHash、cacheHitTokens、cacheMissTokens。
- `ClusterReporter` 增加：
  - prefixHash
  - cacheHitRate
  - cache savings estimate
  - cache regression warning

### 测试方法

- 新增 `tests/cache-aware-prompt.test.ts`
  - 同一工具 schema 排序稳定。
  - 不可变前缀不包含随机时间戳。
  - 不同 user message 不改变 prefixHash。
  - artifact index 增量追加，不重排旧内容。
- 新增 `scripts/cache-hit-bench.ts` 的门禁模式：
  - warm run cache hit rate 必须达到阈值。
  - 低于阈值时输出 fail。

### 验收命令

```bash
pnpm vitest run tests/cache-aware-prompt.test.ts
pnpm exec tsx scripts/cache-hit-bench.ts --gate
```

## P1.2：真实 API Agent Benchmark（当前数据过期，需重跑）

目标：benchmark 必须证明真实 agent 能力，而不是只证明 markdown scenario 能加载。

### 修改方法

- 新增 `eval/benchmark/cluster-runner.ts`
  - 调用 `createOrchestrator({ useClusterPath: true })`。
  - 每个 scenario 创建临时 fixture repo。
  - 注入真实 `testCommand`。
  - 执行 cluster run。
  - 检查 patch、tests、review、cost/cache。
- 新增 `eval/scenarios/cluster-live/*.md`
  - `bugfix-001`: 修复失败单测。
  - `typefix-001`: 修复 TypeScript 类型错误。
  - `cross-file-001`: 跨文件接口变更。
  - `self-heal-001`: 第一次 patch 失败后必须 repair。
  - `security-001`: prompt injection 不得执行危险命令。
- 新增 `eval/reports/cluster-live/*.jsonl`
  - 每个 run 一行，字段包括：
    - scenarioId
    - runId
    - modelRequested/modelActual
    - tokens/cache/cost
    - duration
    - toolCalls
    - artifacts
    - patchApplied
    - testsPassed
    - reviewApproved
    - failureReason

### 测试方法

- dry benchmark 使用 fake LLM，验证 runner 和断言逻辑。
- live benchmark 使用真实 DeepSeek API，只在显式 `--live` 时运行。
- CI 默认跑 dry；手动或 nightly 跑 live。

### 验收命令

```bash
pnpm exec tsx eval/benchmark/cluster-runner.ts --dry --limit 5
pnpm exec tsx eval/benchmark/cluster-runner.ts --live --limit 5
pnpm exec tsx eval/benchmark/cluster-runner.ts --live --suite security
```

## P1.3：修复 --dry-run 和 ClusterReporter timeline

目标：`--dry-run` 标志必须实际阻止文件变更；ClusterReporter timeline 方法必须在运行时代码中被调用。

### 修改方法

- 修改 `src/cli/main.ts:runCluster()`
  - `--dry-run` 传入 context 后在 Orchestrator 中检查：跳过所有文件写入、git commit、test execution。
  - dry-run 模式下 DAG 仍构建、team plan 仍生成，但不执行变更操作。
- 修改 `src/orchestrator/Orchestrator.ts`
  - 在 cluster path 的 step 执行前后调用 `clusterReporter.recordStepStart/recordStepEnd`。
- 修改 `src/orchestrator/ClusterReporter.ts`
  - 确保 `recordStepStart`、`recordStepEnd`、`recordArtifact`、`recordTokenUsage` 等 timeline 方法被正确实现和调用。

### 验收命令

```bash
pnpm cli cluster "fix tests" --dry-run --json
# 应输出 team plan + DAG + "dry run completed, no changes made"
```

---

## P1.4：Cluster agent 硬化 — Coordinator/Planner/Review 产出真实产物

目标：CoordinatorAgent、PlannerAgent、ReviewAgent 目前是 LLM prompt wrapper（单次 prompt 调用，返回自然语言），必须产出结构化 cluster artifact。

### 修改方法

- 修改 `src/agents/cluster/CoordinatorAgent.ts`
  - 解析 LLM 返回中的 JSON plan，产出 `PlanArtifact`（steps/dependencies/riskAssessment/acceptanceCriteria）。
  - 如果 LLM 返回非法 JSON，标记 step failed。
- 修改 `src/agents/cluster/PlannerAgent.ts`
  - 产出 `PlanArtifact`（与 Coordinator 一致的结构），作为 Blackboard artifact 写入。
- 修改 `src/agents/cluster/ReviewAgent.ts`
  - 输入必须接收 patch artifact id 和 test report artifact id（从 Blackboard 读取）。
  - 输出 `ReviewArtifact`（approved: boolean, riskLevel: low/medium/high/critical, issues: []）。
- 修改 `src/agents/CodeAgent.ts`
  - `executePatchGeneration` 中 patch 默认自动 apply（除非 dry-run）。
  - apply 后记录 git diff --stat 到 PatchArtifact。

### 验收命令

```bash
pnpm vitest run tests/deepseek-cluster.test.ts
# 新增断言：Coordinator/Planner/Review 返回类型化 artifact 而非纯文本
```

---

## P1.5：重跑 benchmark + 提交 untracked 文件

目标：仓库状态干净、可复现；benchmark 数据反映最新提交（2026-05-16+）。

### 修改方法

- `git add src/security/ModeToolGate.ts tests/cluster-runtime-fixes.test.ts`
- 重跑 benchmark：`pnpm eval:baseline --live`
- 更新 `eval/reports/benchmark-result.md` 和 `eval/reports/benchmark-latest.md`
- 提交所有变更

### 验收命令

```bash
git status  # 无 untracked 关键文件
pnpm eval:baseline --live
cat eval/reports/benchmark-result.md  # date 应为 2026-05-17+
```

---

## P1.6：MVP 验收门禁

以下命令全部通过后，才允许把产品状态从 prototype 改成 MVP：

```bash
pnpm type-check
pnpm test
pnpm vitest run tests/deepseek-cluster.test.ts
pnpm vitest run tests/cluster-runtime-fixes.test.ts
pnpm vitest run tests/cluster-run-store.test.ts
pnpm vitest run tests/agent-session-manager.test.ts
pnpm vitest run tests/cluster-patch-loop.test.ts
pnpm vitest run tests/mode-approval-sandbox.test.ts
pnpm vitest run tests/cache-aware-prompt.test.ts
pnpm vitest run tests/patch-skill-apply.test.ts
pnpm exec tsx eval/benchmark/cluster-runner.ts --dry --limit 10
```

真实 API 门禁单独运行：

```bash
pnpm exec tsx eval/benchmark/cluster-runner.ts --live --limit 5
pnpm exec tsx scripts/cache-hit-bench.ts --gate
```

---

## P2：Worktree 隔离 + 持久化任务队列

目标：多个 CodeAgent 并发时互不干扰；长时间任务可后台运行和恢复。

- 新增 `src/security/WorktreeManager.ts`：create/list/remove/merge worktree
- 修改 `src/orchestrator/ClusterDAGBuilder.ts`：并行 implementer 分配不同 worktree
- 新增 `src/orchestrator/PersistentQueue.ts`：基于文件/Redis 的任务队列

---

## 进度：当前 201 tests passed / 0 failed | Eval 69.8% (stale) | Codex 产品就绪度 ~45% (was 35%) | Type-check ✅

**最新提交**: `b266364` — P0 安全和运行时加固（2026-05-17）
- Mode gate 传播修复 ✅ | ApprovalManager ✅ | ClusterRunStore ✅ | AgentSessionManager ✅
- CodeAgent 自动应用 ✅ | TestAgent 结构化报告 ✅ | ReviewAgent Blackboard 证据 ✅
- Mode/approval/sandbox 测试：22 个新测试 ✅ | ModeToolGate 已跟踪 ✅

### 按优先级排序的待办

| 优先级 | 任务 | 状态 |
|---|---|---|
| 🔴 P0 | P0.1 修复 mode gate 传播断裂（Scheduler→TaskExecutor） | ✅ 完成 |
| 🟡 P1 | P0.1.5 ApprovalManager 创建 | ✅ 完成 |
| 🔴 P0 | P0.2 ClusterRunStore | ✅ 完成 |
| 🔴 P0 | P0.3 AgentSessionManager | ✅ 完成 |
| 🔴 P0 | P0.4 patch/test/review 真实闭环 | 🟡 部分完成 (CodeAgent/TestAgent/ReviewAgent 已增强，需集成测试) |
| 🔴 P0 | P0.5 ModeToolGate 提交 + 连接 | ✅ 完成 |
| 🟡 P1 | P1.1 cache-aware prompt builder | ❌ 待做 |
| 🟡 P1 | P1.2 真实 API cluster benchmark | ❌ 待做 |
| 🟡 P1 | P1.3 修复 --dry-run + ClusterReporter timeline | ❌ 待做 |
| 🟡 P1 | P1.4 Cluster agent 硬化（Coordinator/Planner） | 🟡 ReviewAgent 完成，Coordinator/Planner 待做 |
| 🟡 P1 | P1.5 提交 untracked 文件 + 重跑 benchmark | ✅ untracked 已跟踪，benchmark 需重跑 |
| 🟢 P2 | Worktree 隔离 + 持久化队列 | ❌ 待做 |

