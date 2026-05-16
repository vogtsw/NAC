
# CLAUDE.md — NAC/JIQUN 智能体集群

> NAC（JIQUN）是一个 TypeScript 智能体运行时，正在升级为 DeepSeek 原生多智能体编程集群。

## 核心参考

| 类型 | 路径 / 链接 |
|---|---|
| 产品目标文档 | `D:\test\mygithub\jiqun\goal.md` |
| 本地参考 - DeepSeek TUI | `D:\test\agent\DeepSeek-TUI` |
| 本地参考 - DeepSeek-Reasonix | `D:\test\agent\DeepSeek-Reasonix` |
| GitHub 仓库 | `https://github.com/vogtsw/NAC.git` |

**借鉴原则**：参考设计模式，不要盲目复制代码，在 NAC 的 TypeScript 架构中实现。

## 工作流程

1.用户设置goal 基于goal进行开发                                   
 
2.在goal开发时候调用 opencode 基于当前agent场景设置benchmark 
 
3.每间隔3小时调用 opencode 分析当前agent与mygithub\jiqun\goal.md的区别 以及review代码，并刷新mygithub\jiqun\todo.md-> 基于刷新的todo.md claude code继续 修改

在1 2 3 迭代时候 每完成todo里面的一次修改，进行测试用例执行，并提交一次github；如果代码有修改每三个小时运行一次benchmark


## 产品方向

DeepSeek 原生多智能体编程集群，核心要素：

| 要素 | 说明 |
|---|---|
| DeepSeek Pro | 协调器、规划器、实现器、安全审查、最终审查 |
| DeepSeek Flash | 廉价并行探索、摘要、测试日志分析 |
| DAG 调度 | 真正的并行工作 |
| Blackboard 产物 | 结构化交接 |
| 补丁/测试/评审循环 | 工程质量保障 |
| 前缀缓存感知上下文 | 降低 DeepSeek 使用成本 |
| Plan / Agent / YOLO 模式 | 安全性与自主性兼顾 |

### 工作区管理

- **文件夹结构**：
  - `D:\test\mygithub\jiqun\` 仓库根目录，仅允许 `task.md` 和 `CLAUDE.md` 存在
  - 所有基准测试必须保留在 `eval/scenarios/cluster/` 目录内
  - 禁止将 TypeScript 文件直接放入根目录，保持文件夹整洁规范

- **定期清理**：每两小时检查并删除仓库根目录的多余文件。

### 版本控制

使用 `https://github.com/vogtsw/NAC.git` 进行 Git 管理，所有变更应遵循规范的提交记录，每次大改后都要提交一次git到github，CLAUDE.md，goal.md，todo.md 和 api key禁止上传。 这里使用deepseek 的api key是sk-1a816e0298aa4e819b0ab5a6ab1d198e

### 协同工具使用

| 工具 | 用途 | 执行说明 |
|---|---|---|
| **OpenCode** | 构建测试和 benchmark 用例 | 用于完成 `goal.md` 中转为 DeepSeek 设计的集群智能体目标；长时间无响应可重启 |
| **opencode (GPT-5.5)** | 产品分析与 benchmark 构建 | 第一次启动在 3 小时后，之后每隔 1 小时启动分析当前与目标差距。首次启动后，后续按每小时执行 |
| **子 Agent** | 代码审查 | 每隔 2 小时启动 |

**opencode 分析要点**：参考 Gap Analysis 方法论，识别当前实现与产品目标之间的差距，输出结构化的差距报告，包括已部署功能、缺失功能（按重要性排序）、质量问题、优先级和工作量估算、产品就绪度评分（如 5.5/10）以及基准测试缺口清单。分析结果应写入 `todo.md` 并纳入任务规划，完成的就打勾。

**OpenCode 说明**：OpenCode 是一款开源的、与供应商无关的终端优先 AI 编程智能体，专为终端用户设计，包含多个内置智能体，支持自定义智能体定义、命令、规则和技能。

### 跟踪管理

- **任务跟踪**：所有 OpenCode 和 Codex 提出的建议以及本体的设计内容，必须写入 `D:\test\mygithub\jiqun\todo.md`
- **进度管理**：每项任务完成后标记“√”，每小时检查一次待办项，确保无遗漏

## 工程规则

- 改动范围限制在请求功能和集群路线图内
- 修改运行时行为时必须新增或更新测试
- 不要在文档、日志、测试 fixture 或最终输出中暴露 API key 或密钥
- 不要在本仓库以外写入文件，除非用户明确要求
- 保持 Windows 兼容；本仓库通常在 PowerShell 上从 `D:\test` 使用
- Markdown 和源文件使用 UTF-8 编码
- 除非任务要求替换，不要大范围重写已有的用户文档
- **禁止修改 `CLAUDE.md` 文件**

## DeepSeek 规则

- 把模型策略当作任务调度的一部分，而不仅仅是 LLM 配置
- 默认角色映射：

- Pro 的升级调用要在报告中可见
- 除非质量要求 Pro，否则辅助摘要保持在 Flash 上
- 把 `reasoning_content` 和最终 content 分开解析和存储
- API 返回时记录缓存命中/未命中的 token 数量
- 不要在稳定的 prompt 前缀中引入随机时间戳或重新排序的工具定义

### 前缀缓存策略

- DeepSeek API 对用户默认开启上下文硬盘缓存，无需修改代码，系统按实际命中计费，理论上最高可节省 90% 成本
- 稳定前缀必须包含：系统提示词、按稳定顺序排列的工具 schema、角色分类、项目指令、仓库地图摘要和集群目标
- 易变后缀应包含：当前 Agent 角色、当前 DAG 步骤、相关产物和期望的输出 schema
- 大型工具输出应变为摘要产物或 handle，不要不断地把完整日志粘贴到每个后续 prompt 中
- 只有在请求前缀完全匹配缓存前缀单元时，才能命中缓存

## 集群运行时规则

一次真正的集群运行应创建持久对象：`ClusterRun`、`TeamPlan`、`ClusterDAG`、`AgentSession`、`ClusterArtifact`、`ClusterReport`

Agent 之间通信必须使用类型化产物，而非松散的自然语言：

`plan` | `repo_map` | `file_summary` | `repo_context` | `patch` | `test_report` | `failure_analysis` | `review` | `final_answer`

集群工作优先使用持久化 agent-session 工具：`agent_open`、`agent_eval`、`agent_close`

旧的 `delegate` 工具可保留用于简单推理，但不足以支撑产品级集群能力。

## 工具面规则

当能减少 shell 歧义时，优先使用专用结构化工具：

| 类别 | 工具 |
|---|---|
| 文件 | `read_file`、`list_dir`、`edit_file`、`apply_patch` |
| 搜索 | `grep_files`、`file_search`、`symbol_search` |
| Shell | `run_command`、后台命令、取消/等待 |
| Git | `git_status`、`git_diff`、`git_worktree_create`、`git_worktree_remove` |
| 测试 | `run_tests`、`diagnostics`、`parse_test_failure` |
| Agent | `agent_open`、`agent_eval`、`agent_close` |
| MCP | `mcp_list_servers`、`mcp_call_tool` |

Shell 仍是构建、测试和仓库特定命令的逃生口。变更和破坏性命令必须遵守模式和权限策略。

## 运行时模式

| 模式 | 行为 |
|---|---|
| `plan` | 只读。不可变动文件。不可执行危险 shell。 |
| `agent` | 默认模式。变更工具和 shell 需要审批策略。 |
| `yolo` | 受信任的沙箱/worktree 模式。自动批准常规工作，但仍拦截明显不安全的操作。 |

**高风险操作**：git push、删除文件、网络安装、凭证变更、工作区外写入。

## Eval 和 Benchmark 规则

修改运行时行为时，优先增加确定性断言而非 LLM 评判。

### 重要指标

- 任务完成率、工具正确性、工具调用成功率、规划质量、记忆连续性、安全合规、产物完整度
- 缓存命中率、Pro/Flash token 分配、单任务成本、耗时

### 基准测试管理

- 所有基准测试必须保留在 `D:\test\mygithub\jiqun\benmark\` 目录内
- 基准测试应尽可能覆盖集群智能体的全部核心功能
- 可通过 opencode 检索并引入成熟的 benchmark 方案
- 当基准分数较低时，需要进行设计修复和优化迭代，确保质量持续提升

### 回归门槛

- security 分数应趋向 100%
- 总体分数下降不超过 5 个百分点
- 工具调用成功率应保持在 90% 以上，目标 95%
- 热会话缓存命中率目标 85%+

## 开发命令

除非有特殊原因，否则使用 `pnpm`。

```bash
pnpm type-check
pnpm test
pnpm test:benchmark
pnpm vitest run tests/deepseek-cluster.test.ts
pnpm eval:baseline --live
pnpm eval:baseline --live --layer security
```

纯文档变更可不跑测试，但至少检查 `git diff`。

## 文件地图

### 运行时

`src/agent/loop.ts`、`src/agent/context.ts`、`src/agent/transcript.ts`、`src/tools/`、`src/llm/`

### 集群

`src/orchestrator/TeamBuilder.ts`、`src/orchestrator/ClusterDAGBuilder.ts`、`src/orchestrator/AgentHandoff.ts`、`src/orchestrator/ClusterReporter.ts`、`src/state/Blackboard.ts`

### Eval

`eval/benchmark/runner.ts`、`eval/benchmark/regression.ts`、`eval/scenarios/`、`src/eval/metrics.ts`、`tests/benchmark.test.ts`、`tests/deepseek-cluster.test.ts`

### 文档

`docs/DEEPSEEK_CLUSTER_AGENT_GOAL.md`、`README.md`

## 完成的定义

一个集群功能只有在满足以下条件时才算完成：

- 有类型化契约
- 有对应的 eval 场景或 benchmark 断言
- 在 plan 和 agent 模式下通过安全门禁
- 在报告中产生可观察的产物
- 不破坏已有的单 Agent 工具循环或已有测试
- 通过判断以及能力和完善度已经与claude code相似
```
