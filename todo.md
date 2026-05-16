# NAC DeepSeek 集群 Agent — 开发待办

> 基于 Codex GPT-5.5 差距分析（2026-05-13）和 goal.md 路线图生成。

## P0：Orchestrator 集成 ✅

- [x] 将 `Orchestrator.ts` 接入 `TeamBuilder` 和 `ClusterDAGBuilder`
- [x] `processRequest()` 支持集群路径：IntentParser → TeamBuilder → ClusterDAGBuilder → Scheduler
- [x] 集群运行时可通过 `NAC_CLUSTER=true` 或 `useClusterPath` config 启用
- [x] 保留旧 AgentRouter 路径作为降级方案
- [x] `formatClusterResult()` 输出集群报告和产物

## P1：具体 Agent 类 ✅

- [x] 实现 `CoordinatorAgent`：拆任务、调度、合并结果、决策
- [x] 实现 `PlannerAgent`：生成 DAG、验收标准、风险评估
- [x] 实现 `ResearchAgent`：并行读目录、生成文件摘要
- [x] 实现 `ReviewAgent`：审查 diff、安全风险、边界条件
- [x] 每个 Agent 类绑定对应的 DeepSeekModelPolicy
- [x] 在 `AgentFactory` 注册新 Agent 类

## P2：CLI 和产品入口 ✅

- [x] 新增 `pnpm cli cluster` CLI 命令
- [x] 支持 `--mode plan|agent|yolo` 参数
- [x] 支持 `--dry-run` 预览团队计划和 DAG
- [x] 输出格式化的集群运行报告
- [x] JSON 输出模式（`--json` 供 API 消费）

## P3：集成测试和 fixture ✅

- [x] 集群编排端到端测试（5 模式：pipeline/self-healing/parallel/debate/map-reduce）
- [x] 修复循环集成测试：失败测试 → 修复 → 代码 v2 → 测试 v2
- [x] 并行模式测试：4 并行 researcher + aggregation
- [x] 畸形 handoff 产物测试（零置信度、错误类型）
- [x] 产物 schema 偏差测试（patch/test_report/review validation）
- [x] 部分 DAG 失败测试（缺失步骤、循环依赖、空 DAG）

## P4：缓存感知 Prompt 布局 ✅

- [x] 更新 `ContextBuilder` 实现不可变前缀 + 仅追加日志 + 易变后缀
- [x] 对不可变前缀做 SHA-256 哈希并记录在 `CacheTelemetry`
- [x] 防止随机时间戳进入稳定前缀（`formatToolDefinitionsStable` 确定性排序）
- [x] 工具定义按名字字母序确定性排序
- [x] 支持 `agentRole`、`dagStep`、`artifactIndex`、`projectInstructions` 注入

## P5：Benchmark 套件 ✅

- [x] 创建 `eval/scenarios/cluster/` 目录（4 场景）
- [x] 集群编程 bench（pipeline task fix + self-healing repair）
- [x] 缓存与成本 bench 配置（`benmark/cluster-benchmark-config.json`）
- [x] 多 Agent 协作 bench（parallel research 场景）
- [x] 安全门禁 bench（sec-gate-001: plan mode destructive ops blocked）
- [x] Benchmark 报告格式 + 回归门禁（global regression gates config）
- [x] 回归门禁集成（安全=100%, 通过率>=80%, typecheck=required）

## 质量债务 ✅

- [x] 定价逻辑去重 → 新建 `DeepSeekPricing.ts` 统一来源
- [x] Reporter 使用真实模型元数据而非 `promptTokens > 2000` 推断
- [x] `DeepSeekModelRouter` 已接入统一定价
- [x] 并行模式测试覆盖 → `tests/cluster-integration.test.ts`
- [x] 安全门禁验证 → `eval/scenarios/cluster/sec-gate-001.md`

---

## Phase 6：产品化推进 ✅

- [x] Blackboard 类型化产物 API（putArtifact/getArtifact/listArtifacts/linkArtifactConsumer/validateArtifact/getArtifactCompleteness）
- [x] 产物 API 测试：10 测试覆盖 CRUD/过滤/验证/完整度
- [x] PR 生成工作流（PRGenerator：摘要生成、preflight 检查、格式化输出）
- [x] PR 生成测试：7 测试覆盖生成/审批/缺失处理/显示格式
- [x] Worktree 隔离（GitSkill 已有 create/remove）
- [x] 持久化 AgentSessionManager（AgentSpawnSkill 已接入真实 AgentFactory 执行）

---

## Phase 7：产品打磨 ✅

- [x] MCP 桥接（MCPSkill：list_servers/connect_server/disconnect_server/call_tool）
- [x] MCP 已注册到 SkillManager
- [x] 会话恢复（resumeSession：checkpoint 恢复 + 继续执行）
- [x] 会话 checkpoint（checkpointSession：从 Blackboard 创建恢复点）

---

*最后更新：2026-05-15 | 69 测试通过 | TypeScript 编译通过 | 产品就绪度：8/10*

---

*最后更新：2026-05-15 | 69 测试通过 | 产品就绪度：预估 7.5/10*
