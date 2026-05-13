可以。基于我刚查的公开资料和你现有 NAC 仓库，我给你一个比较清晰的判断：

**现在大模型公司的“集群 Agent”不是简单堆多个 Agent 类，而是围绕：隔离上下文、角色分工、并行执行、共享工作区、审批沙箱、测试反馈、长期任务队列、成本路由来做。**

你的 NAC 已经有 `Orchestrator / AgentRouter / DAGBuilder / Scheduler / Blackboard / SkillManager` 这些集群雏形，但还没有把它们产品化成“DeepSeek 优化的集群式 coding agent”。下一步应该把 NAC 特殊化成：

```text
DeepSeek-Pro 作为主控规划器
DeepSeek-Flash 作为低成本并行子 Agent
DAG + Blackboard 作为集群调度核心
Patch/Test/Git/MCP/Sandbox 作为工程执行层
```

---

# 一、现在大模型公司怎么做“集群型 Agent”

## 1. Anthropic / Claude Code：独立上下文的 Subagents

Claude Code 的 subagent 设计重点是：每个子 Agent 有自己的上下文窗口、自己的系统提示词、自己的工具权限；主 Agent 只拿回子 Agent 的结果摘要，这样不会污染主上下文。Claude 官方文档也强调，subagent 适合把会产生大量搜索结果、日志、文件内容的任务隔离出去。([Claude API Docs][1])

更进一步，Claude Managed Agents 的 multiagent session 是：多个 Agent 共享同一个 container / filesystem，但每个 Agent 有独立 session thread、独立 conversation history；coordinator 可以后续继续给之前调用过的 Agent 发任务，因此子 Agent 的上下文是持久的。([Claude平台][2])

这给 NAC 的启发是：

```text
不要只做 AgentRouter 选一个 Agent
要做 CoordinatorAgent + 多个独立上下文 WorkerAgent
每个 WorkerAgent 有自己的 tools、memory、task thread
```

---

## 2. OpenAI / Codex：多 Agent 并行 + worktree 隔离 + 云端沙箱

Codex 的公开定位是 cloud-based software engineering agent，能在多个任务上并行工作；每个任务运行在自己的 cloud sandbox，预加载仓库，可以写 feature、修 bug、回答代码库问题、提 PR，并能迭代运行测试直到通过。([OpenAI][3])

Codex App 的方向更明确：它是“command center for agents”，用于管理多个 Agent 并行任务；每个 Agent 在独立 thread 中运行，内置 worktree 支持，多个 Agent 可以在同一个 repo 上互不冲突地工作。([OpenAI][4])

Codex 还有 Automations：可以按计划后台做 issue triage、总结 CI 失败、生成 release briefs、查 bug 等，并把结果放到 review queue。([OpenAI][5])

这给 NAC 的启发是：

```text
一个复杂任务 = 一个 ClusterRun
一个子任务 = 一个 isolated worktree / branch / sandbox
最终由 Coordinator 合并 diff、解决冲突、生成 PR
```

---

## 3. Google / Jules：异步任务 Agent + GitHub 集成

Google Jules 被描述为 asynchronous coding agent，会读取代码、理解意图并自主执行，例如写测试、修 bug；它运行在安全云环境中，并有 GitHub 集成。([blog.google][6])

Jules 官网也强调并发任务配额，例如 Pro 计划支持更多 concurrent tasks，Ultra 计划支持更大规模并行任务。([Jules][7])

这给 NAC 的启发是：

```text
集群能力要体现为“多个后台任务同时跑”
不是只在一次对话里假装多个角色说话
```

---

## 4. Microsoft AutoGen：多 Agent 对话框架

AutoGen 的核心是 conversable agents：Agent 可以互相发送和接收消息，集成 LLM、工具、人类反馈，通过自动化多 Agent 对话完成复杂任务。([Microsoft GitHub][8])

这给 NAC 的启发是：

```text
Blackboard 只是共享状态
还需要 Agent-to-Agent message / handoff 协议
```

也就是说，NAC 不应该只做：

```text
Task A → Agent A
Task B → Agent B
```

而应该做：

```text
ResearchAgent → 把 repo-context 交给 CodeAgent
CodeAgent → 把 patch 交给 TestAgent
TestAgent → 把失败日志交回 CodeAgent
ReviewAgent → 审查最终 diff
```

---

# 二、DeepSeek 生态现在对 Agent 有什么启发

## 1. DeepSeek 最新模型已经很适合做“Pro 主控 + Flash 子 Agent”

DeepSeek 官方 API 文档现在列出的模型是 `deepseek-v4-pro` 和 `deepseek-v4-flash`，旧的 `deepseek-chat` 和 `deepseek-reasoner` 会在 2026-07-24 退役；兼容关系上，旧别名会映射到 `deepseek-v4-flash` 的非思考/思考模式。([DeepSeek API Docs][9])

DeepSeek V4 Preview 官方说明里，`deepseek-v4-pro` 是 1.6T total / 49B active params，`deepseek-v4-flash` 是 284B total / 13B active params；DeepSeek 也明确说 V4 系列支持 1M context，且 API 只需要把 model 改成 `deepseek-v4-pro` 或 `deepseek-v4-flash`。([DeepSeek API Docs][10])

这意味着 NAC 最应该做的不是“所有 Agent 都用同一个模型”，而是：

```text
主控、规划、架构、最终审查：deepseek-v4-pro
检索、文件摘要、并行分析、测试日志归纳：deepseek-v4-flash
```

---

## 2. DeepSeek 的 Thinking Mode 应该变成 NAC 的调度参数

DeepSeek 官方 Thinking Mode 支持 `thinking.enabled/disabled` 和 `reasoning_effort: high/max`，并说明复杂 agent 请求可自动设置为 max。([DeepSeek API Docs][11])

NAC 现在 `LLMClient` 只有普通 `temperature / maxTokens / responseFormat`，没有把 thinking / reasoning_effort 建模进 Agent 或 Task。你需要加：

```ts
interface DeepSeekModelPolicy {
  model: "deepseek-v4-pro" | "deepseek-v4-flash";
  thinking: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
}
```

然后由 `TeamBuilder` 按任务自动分配：

```text
简单文件摘要：Flash + thinking off
代码搜索：Flash + thinking off/high
bug 定位：Pro + thinking high
架构决策：Pro + thinking max
安全审计：Pro + thinking max
测试日志归纳：Flash + thinking high
最终合并评审：Pro + thinking high/max
```

---

## 3. DeepSeek 的 Context Caching 对集群 Agent 很关键

DeepSeek Context Caching 默认启用。如果后续请求和之前请求有重叠前缀，可以命中缓存；官方文档强调缓存命中依赖完整 prefix unit 匹配。([DeepSeek API Docs][12])

这对 NAC 很重要，因为多 Agent 集群会重复带入大量相同上下文，比如：

```text
system prompt
repo map
project instruction
tool definitions
当前任务目标
共享 Blackboard 摘要
```

所以 NAC 应该专门做 **prefix-cache-aware prompt layout**：

```text
固定前缀：
- NAC cluster system prompt
- tool schema
- repo map
- project conventions
- team role definitions

变化后缀：
- 当前 Agent 的具体任务
- 当前文件片段
- 当前失败日志
```

不要每个 Agent 都拼一个乱序 prompt，否则缓存命中率很低。

---

## 4. DeepSeek 的 Function Calling / Strict Schema 适合做 Agent 间结构化协议

DeepSeek Function Calling 支持工具调用，strict mode 会根据 JSON Schema 约束函数参数输出。([DeepSeek API Docs][13])

这意味着 NAC 不应该让 Agent 用自然语言交接，应该让 Agent 产出强结构数据：

```ts
interface AgentHandoff {
  fromAgent: string;
  toAgent: string;
  artifactType: "plan" | "repo_context" | "patch" | "test_report" | "review";
  confidence: number;
  payload: unknown;
  nextAction: string;
}
```

所有 Agent 交接都走 JSON schema，这样你的 DAG/Scheduler/Blackboard 才能可靠运行。

---

## 5. DeepSeek Chat Prefix / FIM 可以优化代码生成和 patch 生成

DeepSeek Chat Prefix Completion 可以给 assistant prefix，例如强制以代码块开头输出；FIM Completion 适合代码中间补全。([DeepSeek API Docs][14])

NAC 现在 `CodeGenerationSkill` 只是让模型生成一段代码，再从 markdown code block 里提取第一段代码。这个太粗。应该改成两种模式：

```text
新文件 / 大段代码：Chat Prefix Completion
局部补全 / 函数内部修改：FIM Completion
真实仓库修改：unified diff / apply_patch
```

---

# 三、DeepSeek TUI 给 NAC 的直接参考

DeepSeek TUI 是一个社区终端 coding agent，公开 README/文档里描述了很完整的 DeepSeek V4 agent 设计：能读写文件、跑 shell、搜索 web、管理 git、协调 sub-agents；围绕 `deepseek-v4-pro / deepseek-v4-flash`、1M context、streaming reasoning、prefix-cache-aware cost reporting 构建。([GitHub][15])

它的文档里有几个特别值得 NAC 学的点：

## 1. 三种模式：Plan / Agent / YOLO

DeepSeek TUI 的 Plan 模式是只读探索，Agent 模式是默认多步工具使用且高风险工具需要审批，YOLO 模式是自动批准。([DeepSeek TUI][16])

NAC 也应该加三种 cluster mode：

```text
nac cluster --mode plan
只读分析，不改文件，不跑危险命令

nac cluster --mode agent
默认模式，改文件/跑测试/commit 前需要审批

nac cluster --mode yolo
全自动，适合 sandbox/worktree/CI 环境
```

---

## 2. 工具面要工程化

DeepSeek TUI 工具面包含：`read_file / list_dir / write_file / edit_file / apply_patch`，搜索工具，shell 工具，`git_status / git_diff / diagnostics / run_tests`，sub-agent 工具，MCP 工具。([DeepSeek TUI][16])

NAC 现在有 `file-ops / terminal-exec / web-search / code-generation / code-review`，但缺少几个关键工程工具：

```text
apply_patch
git_status
git_diff
run_tests
diagnostics
agent_spawn
agent_wait
agent_result
mcp_tool
```

如果你要体现“集群 Agent”，`agent_spawn / agent_wait / agent_result` 这三个尤其关键。

---

## 3. 审批和沙箱要拆成两个维度

DeepSeek TUI 把 mode 和 approval 拆开，审批有 suggest / auto / never，沙箱则按 OS 使用 landlock / seatbelt / AppContainer，并默认限制 workspace 边界。([DeepSeek TUI][16])

NAC 现在有 `SandboxManager` 和 `TerminalSkill`，但 `git / pnpm / npm` 等常用 coding 命令被卡得太死，且审批流没有做成产品体验。你应该改成：

```text
read-only tools：默认允许
write tools：Agent 模式询问，YOLO 模式允许
network/install/delete：始终高风险
git commit/push：需要明确审批
```

---

## 4. Skills 系统要变成可安装指令包

DeepSeek TUI 的 skill 是一个目录，里面有 `SKILL.md`，Agent 启动时加载名称和描述，相关时再加载完整内容。([DeepSeek TUI][16])

你的 NAC 现在有 SkillManager 和 SkillCreator，但更像“代码插件”。建议增加另一层 **Instruction Skill**：

```text
.agents/skills/
  fix-vitest-failures/
    SKILL.md
  refactor-fastify-api/
    SKILL.md
  deepseek-cost-optimized-cluster/
    SKILL.md
```

这样更接近 Claude Code / DeepSeek TUI / Codex 的技能体系。

---

# 四、基于 NAC 现有框架的改造方案

你现在 NAC 的优势是已经有：

```text
Orchestrator
AgentRouter
DAGBuilder
Scheduler
Blackboard
EventBus
SessionStore
AgentFactory
SkillManager
Sandbox
FeedbackCollector
```

`Orchestrator` 已经把 IntentParser、DAGBuilder、Scheduler、AgentFactory、Blackboard、EventBus、SessionStore 串起来。
`AgentRouter` 已经能根据任务和 Agent 能力做匹配。
`DAGBuilder` 已经能从 intent 构建任务依赖图。
`Scheduler` 已经有并行调度和 Lane Queue。

但你的问题是：这些模块现在还没有形成“DeepSeek 集群 Agent 产品”。

我建议把 NAC 改成下面这个方向：

---

# 五、NAC-DeepSeek Cluster Agent 总体架构

```text
用户任务
  ↓
ClusterOrchestrator
  ↓
TeamBuilder：组队 + 模型路由
  ↓
ClusterDAGBuilder：生成角色 DAG
  ↓
Blackboard：共享产物
  ↓
ClusterScheduler：并行执行
  ↓
DeepSeek LLM Router
  ├── Pro Coordinator
  ├── Flash Research Workers
  ├── Flash Log/Test Workers
  └── Pro Reviewer
  ↓
Patch / Test / Git / MCP / Sandbox
  ↓
Cluster Report + Diff + PR
```

---

# 六、核心设计：Pro 主控，Flash 并行

## 1. 模型角色分工

```text
CoordinatorAgent
model: deepseek-v4-pro
thinking: enabled
effort: high/max
职责：拆任务、调度、合并结果、决策

PlannerAgent
model: deepseek-v4-pro
thinking: enabled
effort: high
职责：生成 DAG、验收标准、风险评估

ResearchAgent-N
model: deepseek-v4-flash
thinking: disabled/high
职责：并行读不同目录、生成文件摘要

CodeAgent
model: deepseek-v4-pro
thinking: enabled
effort: high
职责：生成 patch

TestAgent
model: deepseek-v4-flash
thinking: high
职责：跑测试、总结失败日志

ReviewAgent
model: deepseek-v4-pro
thinking: enabled
effort: max
职责：最终审查 diff、安全风险、边界条件
```

这个设计最能体现 DeepSeek V4 的优势：**Pro 负责高价值推理，Flash 负责低成本并行劳动。**

---

# 七、把 NAC 的 AgentRouter 改成 TeamBuilder

现在你的 `AgentRouter` 更像“选最合适 Agent”。要体现集群能力，应该升级成：

```ts
interface TeamPlan {
  runId: string;
  coordinator: AgentSpec;
  members: AgentSpec[];
  collaborationMode:
    | "pipeline"
    | "parallel-research"
    | "map-reduce"
    | "self-healing"
    | "debate-review";
  modelPolicy: Record<string, DeepSeekModelPolicy>;
  expectedArtifacts: string[];
}
```

示例：

```json
{
  "coordinator": {
    "agentType": "CoordinatorAgent",
    "model": "deepseek-v4-pro",
    "reasoningEffort": "high"
  },
  "members": [
    {
      "agentType": "ResearchAgent",
      "count": 4,
      "model": "deepseek-v4-flash"
    },
    {
      "agentType": "CodeAgent",
      "count": 1,
      "model": "deepseek-v4-pro"
    },
    {
      "agentType": "TestAgent",
      "count": 1,
      "model": "deepseek-v4-flash"
    },
    {
      "agentType": "ReviewAgent",
      "count": 1,
      "model": "deepseek-v4-pro"
    }
  ],
  "collaborationMode": "self-healing"
}
```

---

# 八、把 DAGBuilder 改成 ClusterDAGBuilder

现在 DAG 主要是“分析需求 → 执行任务 → 验证结果”。这不够体现集群。

应该生成这种 DAG：

```text
step_1 PlannerAgent
  输出：plan.json

step_2a ResearchAgent[src]
  输入：plan.json
  输出：src_summary.json

step_2b ResearchAgent[tests]
  输入：plan.json
  输出：test_summary.json

step_2c ResearchAgent[docs]
  输入：plan.json
  输出：docs_summary.json

step_3 AggregatorAgent
  输入：所有 summary
  输出：repo_context.json

step_4 CodeAgent
  输入：repo_context.json
  输出：patch.diff

step_5 TestAgent
  输入：patch.diff
  输出：test_report.json

step_6 FailureAgent
  条件：测试失败
  输出：repair_hint.json

step_7 CodeAgent
  条件：需要修复
  输出：patch_v2.diff

step_8 ReviewAgent
  输出：review_report.json
```

这才是“集群 Agent”。

---

# 九、Blackboard 要变成集群工作台

你现在有 Blackboard，但要把它改成所有 Agent 产物的中心。

```ts
interface ClusterArtifact {
  id: string;
  runId: string;
  type:
    | "plan"
    | "repo_map"
    | "file_summary"
    | "patch"
    | "test_report"
    | "failure_analysis"
    | "review"
    | "final_answer";
  producer: string;
  consumers: string[];
  content: unknown;
  confidence: number;
  tokenCost?: number;
  createdAt: number;
}
```

每个 Agent 只做两件事：

```text
从 Blackboard 读取输入
向 Blackboard 写入输出
```

这样你就有了可追踪的集群协作链路。

---

# 十、DeepSeek 专属 Prompt / Cache 设计

为了利用 DeepSeek Context Caching，NAC 的 prompt 要固定结构。

## 固定 prefix

```text
[NAC DeepSeek Cluster System Prompt]
[Tool Schemas]
[Agent Role Definitions]
[Project Instructions]
[Repo Map]
[Current Cluster Run Objective]
[Blackboard Artifact Index]
```

## 变化 suffix

```text
[This Agent Role]
[This Task]
[Relevant Files]
[Expected JSON Output Schema]
```

这样多个 Agent 请求共享相同前缀，更容易命中 DeepSeek cache。

---

# 十一、DeepSeek 专属模型路由策略

增加一个 `DeepSeekModelRouter.ts`：

```ts
class DeepSeekModelRouter {
  route(task: ClusterTask): DeepSeekModelPolicy {
    if (task.role === "coordinator") {
      return { model: "deepseek-v4-pro", thinking: "enabled", reasoningEffort: "high" };
    }

    if (task.role === "reviewer" || task.riskLevel === "high") {
      return { model: "deepseek-v4-pro", thinking: "enabled", reasoningEffort: "max" };
    }

    if (task.role === "researcher" || task.role === "tester") {
      return { model: "deepseek-v4-flash", thinking: "enabled", reasoningEffort: "high" };
    }

    if (task.role === "summarizer") {
      return { model: "deepseek-v4-flash", thinking: "disabled" };
    }

    return { model: "deepseek-v4-pro", thinking: "enabled", reasoningEffort: "high" };
  }
}
```

---

# 十二、工具层必须补齐

参考 DeepSeek TUI，你需要补这些 skill/tool：

```text
File:
- read_file
- list_dir
- edit_file
- apply_patch

Search:
- grep_files
- file_search
- symbol_search

Shell:
- run_command
- run_command_stream
- kill_command

Git:
- git_status
- git_diff
- git_branch
- git_commit
- git_worktree_create
- git_worktree_remove

Test:
- detect_test_commands
- run_tests
- parse_test_failure
- diagnostics

Agent:
- agent_spawn
- agent_wait
- agent_result
- agent_cancel

MCP:
- mcp_list_servers
- mcp_call_tool
```

你现在有 `TerminalSkill`，但它用 shell string；建议改成 `spawn(cmd,args)`，否则审批和安全很难做细。

---

# 十三、最终产品形态

你应该把 NAC 做出一个明显区别于普通 coding agent 的命令：

```bash
nac cluster "修复当前测试失败，并生成 PR 说明"
```

启动后输出：

```text
NAC DeepSeek Cluster Started

Coordinator:
- DeepSeek-V4-Pro / thinking high

Workers:
- 4 x ResearchAgent / DeepSeek-V4-Flash
- 1 x CodeAgent / DeepSeek-V4-Pro
- 1 x TestAgent / DeepSeek-V4-Flash
- 1 x ReviewAgent / DeepSeek-V4-Pro

Mode:
self-healing + parallel-research

Execution:
[PlannerAgent] created plan.json
[ResearchAgent#1] summarized src/
[ResearchAgent#2] summarized tests/
[ResearchAgent#3] summarized config/
[AggregatorAgent] merged repo_context.json
[CodeAgent] generated patch.diff
[TestAgent] tests failed: 1 failure
[FailureAgent] produced repair_hint.json
[CodeAgent] generated patch_v2.diff
[TestAgent] tests passed
[ReviewAgent] approved final diff
```

最后输出：

```text
Final Result:
- Modified files: 3
- Tests run: pnpm test
- Status: passed
- Review: low risk
- Cost: Pro tokens X, Flash tokens Y, cache hit Z%
- Artifacts:
  - plan.json
  - repo_context.json
  - patch.diff
  - test_report.json
  - review_report.json
```

这就能体现你的 Agent 集群能力。

---

# 十四、路线图

## Phase 1：DeepSeek API 适配

```text
1. LLMClient 支持 deepseek-v4-pro / deepseek-v4-flash
2. 支持 thinking enabled/disabled
3. 支持 reasoning_effort high/max
4. 支持 reasoning_content 分离存储
5. 支持 strict JSON tool output
6. 支持 token usage / cache hit 记录
```

你现在 `LLMClient` 基于 OpenAI SDK，很适合继续扩展 DeepSeek 参数。

---

## Phase 2：Cluster Runtime

```text
1. 新增 ClusterRun
2. 新增 TeamBuilder
3. 新增 ClusterDAGBuilder
4. 新增 AgentHandoff
5. Blackboard 支持 artifact 类型
6. ClusterReporter 输出执行报告
```

---

## Phase 3：工程 Tool Surface

```text
1. apply_patch
2. git_status / git_diff
3. run_tests / diagnostics
4. grep_files / symbol_search
5. agent_spawn / agent_wait / agent_result
6. MCP client
```

---

## Phase 4：DeepSeek Pro + Flash 并行

```text
1. Pro Coordinator
2. Flash Research Workers
3. Flash Test Log Analyzer
4. Pro CodeAgent
5. Pro ReviewAgent
6. cache-aware prompt layout
```

---

## Phase 5：产品化

```text
1. nac cluster 命令
2. Plan / Agent / YOLO 模式
3. 实时 timeline
4. 成本统计
5. session resume
6. workspace rollback
7. PR 生成
```

---

# 十五、最终定位建议

不要把 NAC 定位成“又一个 Claude Code 仿品”。

更好的定位是：

```text
NAC = DeepSeek-native Multi-Agent Coding Cluster
```

核心卖点：

```text
1. DeepSeek-V4-Pro 主控复杂推理
2. DeepSeek-V4-Flash 低成本并行子 Agent
3. DAG 调度体现真正集群能力
4. Blackboard 记录所有 Agent 产物
5. apply_patch + test loop + review loop 保证工程质量
6. prefix-cache-aware prompt 降低 DeepSeek 使用成本
7. Plan / Agent / YOLO 三模式兼顾安全和效率
```

一句话方案：

**把 NAC 从“多 Agent 编排框架”升级为“DeepSeek Pro 负责决策、Flash 负责并行劳动、DAG 负责调度、Blackboard 负责协作、Patch/Test/Git 负责落地”的 DeepSeek 原生集群 Agent。**

[1]: https://docs.claude.com/en/docs/claude-code/subagents?utm_source=chatgpt.com "Subagents - Claude Docs"
[2]: https://platform.claude.com/docs/en/managed-agents/multi-agent?utm_source=chatgpt.com "Multiagent sessions - Claude API Docs"
[3]: https://openai.com/index/introducing-codex/?utm_source=chatgpt.com "Introducing Codex | OpenAI"
[4]: https://openai.com/index/introducing-the-codex-app?utm_source=chatgpt.com "Introducing the Codex app | OpenAI"
[5]: https://openai.com/index/introducing-the-codex-app "Introducing the Codex app | OpenAI"
[6]: https://blog.google/innovation-and-ai/models-and-research/google-labs/jules/?utm_source=chatgpt.com "Jules: Google’s autonomous AI coding agent"
[7]: https://jules.google/?utm_source=chatgpt.com "Jules - An Autonomous Coding Agent"
[8]: https://microsoft.github.io/autogen/0.2/docs/Use-Cases/agent_chat "Multi-agent Conversation Framework | AutoGen 0.2"
[9]: https://api-docs.deepseek.com/ "Your First API Call | DeepSeek API Docs"
[10]: https://api-docs.deepseek.com/news/news260424 "DeepSeek V4 Preview Release | DeepSeek API Docs"
[11]: https://api-docs.deepseek.com/guides/thinking_mode "Thinking Mode | DeepSeek API Docs"
[12]: https://api-docs.deepseek.com/guides/kv_cache "Context Caching | DeepSeek API Docs"
[13]: https://api-docs.deepseek.com/guides/function_calling/ "Function Calling | DeepSeek API Docs"
[14]: https://api-docs.deepseek.com/guides/chat_prefix_completion "Chat Prefix Completion (Beta) | DeepSeek API Docs"
[15]: https://github.com/DeepSeek-TUI/DeepSeek-TUI?utm_source=chatgpt.com "GitHub - DeepSeek-TUI/DeepSeek-TUI: Install DeepSeek TUI - Coding agent for DeepSeek models that runs in your terminal. · GitHub"
[16]: https://deepseek-tui.com/en/docs "Docs · DeepSeek TUI"
