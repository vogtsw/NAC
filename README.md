# NAC (NexusAgent-Cluster)

<div align="center">

**多Agent集群编排系统** | Multi-Agent Cluster Orchestration System

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E=20.0.0-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-97.6%25-brightgreen)](tests/)

一个基于**DAG并行调度**的智能多Agent协作框架

[特性](#-核心特性) • [快速开始](#-快速开始) • [文档](#-文档) • [架构](#-架构) • [贡献](#-贡献)

</div>

---

## 📖 项目简介

NAC (NexusAgent-Cluster) 是一个先进的多Agent集群编排系统，通过DAG（有向无环图）实现任务的并行调度和智能路由。系统支持10+种专业Agent和26+种内置技能，可以处理复杂的代码生成、数据分析、文档处理等任务。

### 核心能力

- 🤖 **多Agent协作**: 10种专业Agent协同工作
- ⚡ **DAG并行调度**: 基于优先级的Lane Queue并发控制
- 🎯 **智能意图识别**: 自动解析用户需求并路由到合适的Agent
- 🔌 **插件化技能**: 26+内置技能 + 动态技能创建
- 🛡️ **安全沙箱**: 完整的权限管理和沙箱隔离
- 📊 **可观测性**: 详细的日志、指标和会话追踪

---

## ✨ 核心特性

### 1. 智能Agent路由

```
用户请求 → IntentParser → AgentRouter → 最优Agent
                 ↓
            复杂度评估 + 能力匹配
```

**支持10种Agent**:
- `CodeAgent` - 代码生成与重构
- `DataAgent` - 数据分析与处理
- `AutomationAgent` - 自动化任务
- `AnalysisAgent` - 深度分析
- `GenericAgent` - 通用对话
- `DocumentAgent` - 文档处理
- `AINewsSummarizerAgent` - AI新闻摘要
- `MoeModelAgent` - MoE模型
- `SolidityContractAgent` - 智能合约
- `WorkRecordAgent` - 工作记录

### 2. DAG并行调度

基于Lane Queue的优先级调度系统:

```
Critical Lane (2并发)
    ↑
High Lane (5并发)
    ↑
Normal Lane (10并发)
    ↑
Low Lane (15并发)
```

### 3. 技能系统

**26+内置技能**:
- 💻 `code-generation` - 代码生成
- 📝 `file-ops` - 文件操作
- 🔧 `terminal-exec` - 命令执行
- 🔍 `code-review` - 代码审查
- 📊 `data-analysis` - 数据分析
- 📄 `docx-processing` - 文档处理
- 🌐 `web-search` - 网络搜索
- ⚡ `skill-creator` - 动态创建技能

### 4. 安全隔离

- ✅ 沙箱执行环境
- ✅ 细粒度权限控制
- ✅ 敏感数据过滤
- ✅ 命令白名单

---

## 🚀 快速开始

### 环境要求

- **Node.js**: >= 20.0.0
- **包管理器**: pnpm (推荐) / npm / yarn
- **LLM API**: DeepSeek / Zhipu AI / OpenAI

### 安装

```bash
# 克隆仓库
git clone https://github.com/vogtsw/NAC.git
cd NAC

# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入你的 API 密钥
```

### 配置

在 `.env` 文件中配置：

```bash
# LLM API (必需)
DEEPSEEK_API_KEY=your_deepseek_api_key
# 或
ZHIPU_API_KEY=your_zhipu_api_key

# 可选配置
PORT=3000
LOG_LEVEL=INFO
MAX_PARALLEL_AGENTS=10
```

### 运行

```bash
# 交互式对话模式
pnpm cli chat

# 查看帮助
pnpm cli --help

# 运行测试
pnpm test

# 构建项目
pnpm build

# 启动服务
pnpm start
```

### 使用示例

```bash
# 启动对话
pnpm cli chat

# 示例对话
You> 创建一个TypeScript函数，实现快速排序

You> 分析这个项目的代码质量并给出改进建议

You> 帮我生成一个RESTful API的用户认证模块
```

---

## 📚 文档

### 核心文档

| 文档 | 描述 |
|------|------|
| [doc/NAC_ARCHITECTURE.md](doc/NAC_ARCHITECTURE.md) | 系统架构详解 |
| [doc/AGENT_DEVELOPMENT_GUIDE.md](doc/AGENT_DEVELOPMENT_GUIDE.md) | Agent开发指南 |
| [doc/SECURITY_IMPLEMENTATION_GUIDE.md](doc/SECURITY_IMPLEMENTATION_GUIDE.md) | 安全实施指南 |
| [doc/SMART_AGENT_ROUTING.md](doc/SMART_AGENT_ROUTING.md) | 智能路由机制 |

### 测试报告

| 报告 | 描述 |
|------|------|

### 架构文档

```
NAC/
├── src/
│   ├── agents/          # Agent实现 (10种)
│   ├── orchestrator/    # 编排层 (Orchestrator, DAGBuilder, Scheduler)
│   ├── skills/          # 技能系统 (26+技能)
│   ├── llm/             # LLM抽象层
│   ├── state/           # 状态管理 (Blackboard, EventBus)
│   ├── security/        # 安全模块
│   └── api/             # API服务
├── config/agents/       # Agent配置文件
├── tests/               # 测试套件
└── memory/              # 运行时数据和报告
```

---

## 🏗️ 架构

### 系统架构图

```
┌─────────────────────────────────────────────────────┐
│                   用户输入                           │
└──────────────────┬──────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────┐
│              Orchestrator (主编排器)                  │
│  • IntentParser  • DAGBuilder  • Scheduler          │
└──────────────────┬──────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────┐
│            AgentRouter (智能路由)                     │
│       能力匹配 + 复杂度评估 + 降级策略                │
└──────────────────┬──────────────────────────────────┘
                   ↓
         ┌─────────┴─────────┐
         ↓                   ↓
┌──────────────┐    ┌──────────────┐
│  DAG Builder │    │ AgentFactory │
│  任务依赖图   │    │  Agent创建   │
└──────┬───────┘    └──────┬───────┘
       ↓                   ↓
┌──────────────────────────────────────┐
│      Scheduler (Lane Queues)         │
│  Critical | High | Normal | Low      │
└──────┬───────────────────────────────┘
       ↓
┌──────────────────────────────────────┐
│      Agent + Skills 执行              │
│  • CodeAgent + code-generation        │
│  • DataAgent + data-analysis          │
│  • AutomationAgent + terminal-exec   │
└──────────────────────────────────────┘
```

### 核心组件

| 组件 | 职责 | 文件 |
|------|------|------|
| **Orchestrator** | 主编排器，协调整个流程 | `src/orchestrator/Orchestrator.ts` |
| **IntentParser** | 意图解析，理解用户需求 | `src/orchestrator/IntentParser.ts` |
| **DAGBuilder** | DAG构建，建立任务依赖 | `src/orchestrator/DAGBuilder.ts` |
| **Scheduler** | 任务调度，并行执行控制 | `src/orchestrator/Scheduler.ts` |
| **AgentRouter** | Agent路由，选择最优Agent | `src/orchestrator/AgentRouter.ts` |
| **SkillManager** | 技能管理，注册和执行 | `src/skills/SkillManager.ts` |
| **Blackboard** | 状态共享，全局黑板 | `src/state/Blackboard.ts` |
| **EventBus** | 事件总线，解耦通信 | `src/state/EventBus.ts` |

---

## 🧪 测试

### 测试覆盖

- **核心测试**: 28/28 通过 (100%)
- **集成测试**: 13/14 通过 (92.9%)
- **总体通过率**: 97.6%

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行核心测试
pnpm vitest run tests/core-validation.test.ts

# 运行快速E2E测试
pnpm vitest run tests/integration-quick.test.ts

# 运行完整E2E测试
pnpm vitest run tests/integration.test.ts

# 生成覆盖率报告
pnpm test:coverage
```

---

## 🔒 安全

### 安全特性

- ✅ **沙箱隔离**: 命令执行在受控环境中
- ✅ **权限管理**: 基于角色的访问控制
- ✅ **敏感数据过滤**: 自动过滤API密钥等敏感信息
- ✅ **命令白名单**: 限制可执行的命令
- ✅ **资源限制**: CPU、内存、执行时间限制

### 安全报告

- [安全实施指南](doc/SECURITY_IMPLEMENTATION_GUIDE.md)

---

## 🛠️ 开发

### 开发指南

1. **分支策略**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **代码规范**
   ```bash
   # 类型检查
   pnpm type-check

   # 代码检查
   pnpm lint

   # 代码格式化
   pnpm format
   ```

3. **构建**
   ```bash
   pnpm build
   ```

4. **测试**
   ```bash
   pnpm test
   ```

### 添加新Agent

1. 创建Agent类继承`BaseAgent`
2. 实现`execute()`方法
3. 创建配置文件 `config/agents/YourAgent.system.md`
4. 在`AgentRegistry`中注册

详细指南: [Agent开发指南](doc/AGENT_DEVELOPMENT_GUIDE.md)

### 添加新技能

1. 创建技能文件 `src/skills/builtin/YourSkill.ts`
2. 实现`Skill`接口
3. 在`SkillManager`中注册

或使用动态创建:

```bash
pnpm cli chat

You> 创建一个skill，名称是"email-sender"，描述是"发送邮件的功能"
```

---

## 📊 性能

### 性能指标

- **DAG构建**: ~26秒 (包含LLM调用)
- **任务执行**: 5-10秒/任务
- **并发能力**: 最多10个并行Agent
- **吞吐量**: ~100任务/分钟

### 优化

- Lane Queue优先级调度
- 任务结果缓存
- 增量DAG构建
- 连接池管理

---

## 🎯 Benchmark

当前版本 (v3.0) 基于 `eval/` 评测体系，覆盖 60 个场景、7 个维度层。

### 总体结果

| 指标 | 数值 |
|------|------|
| 评测场景总数 | 60 (7 层) |
| Boundary 场景 | 19 (6 gap categories) |
| Security 层通过率 | **83.3%** (3/5) |
| 工具调用成功率 | **80.0%** |
| 平均迭代/任务 | 4 turns |
| 平均耗时/任务 | ~12s |

### 各维度层

| 层 | 场景数 | 描述 |
|----|--------|------|
| boundary | 19 | 边界条件与模型能力 gap 探测 |
| security | 5 | 安全隔离、权限、注入检测 |
| tools | — | 工具选择、参数正确性 |
| planning | — | 任务规划与多步推理 |
| session-state | — | 跨轮次状态管理 |
| multi-agent | — | 多 Agent 协作与路由 |
| real-chat | — | 真实对话场景端到端 |

### 工具性能

| 工具 | 调用数 | 成功率 |
|------|--------|--------|
| file_read | 2 | 100.0% |
| glob | 5 | 100.0% |
| grep | 2 | 100.0% |
| bash | 11 | 63.6% |

### Gap 类别（Boundary 探测）

| 类别 | 场景数 | 说明 |
|------|--------|------|
| context_attention | 4 | 长上下文注意力衰减 |
| tool_addiction | 1 | prompt 已有答案却仍调用工具 |
| tool_selection_ambiguity | 1 | 多工具可选时的次优选择 |
| argument_hallucination | 1 | 参数幻觉 → 失败 → 恢复 |
| exploration_vs_clarification | 1 | 模糊任务 -> 先问还是先搜 |
| 其他 (13 类) | 11 | 死锁检测、指令层级、secret 曝光等 |

### 运行 Benchmark

```bash
# 运行全部 baseline
pnpm eval:baseline --live

# 仅 security 层
pnpm eval:baseline --live --layer security

# 查看报告
cat eval/reports/benchmark-latest.md
```

报告目录: `eval/reports/` · 场景定义: `eval/scenarios/`

---

## 🤝 贡献

欢迎贡献！请遵循以下步骤：

1. Fork本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启Pull Request

### 贡献指南

- 遵循现有代码风格
- 添加测试覆盖新功能
- 更新相关文档
- 确保所有测试通过

---

## 📝 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

- [DeepSeek](https://www.deepseek.com/) - LLM服务支持
- [Zhipu AI](https://open.bigmodel.cn/) - LLM服务支持
- [Vitest](https://vitest.dev/) - 测试框架
- [Fastify](https://www.fastify.io/) - Web框架

---

## 📮 联系

- **GitHub**: [vogtsw/NAC](https://github.com/vogtsw/NAC)
- **Issue**: [提交问题](https://github.com/vogtsw/NAC/issues)

---

<div align="center">

**Made with ❤️ by the NAC Community**

</div>
