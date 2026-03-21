# NexusAgent-Cluster (NAC) 工程架构

> **工程定位**: 在OpenClaw基础上扩展的多Agent集群编排系统
> **核心特性**: DAG并行调度 + Agent自进化机制 + 安全可靠性保障
> **版本**: 4.0
> **更新日期**: 2026-03-21

---

## 工程概述

NAC (NexusAgent-Cluster) 是一个基于多Agent集群的智能任务编排系统，在OpenClaw的单Agent架构基础上，增加了多Agent协作、DAG并行调度和自进化能力。

### 核心增强

相比OpenClaw，NAC新增了：
- **多Agent集群** - 多个专业化Agent并行协作
- **DAG编排** - 智能识别任务依赖，并行调度
- **智能路由** - 基于语义匹配选择最合适的Agent
- **自进化** - 基于反馈持续优化Agent配置

### 架构分层

```
输入层 (保留OpenClaw Gateway)
    ↓
编排层 (Orchestrator) - 新增
    ↓
执行层 (多Agent集群) - 新增
    ↓
进化层 (反馈优化) - 新增
```

---

## L1: 编排层

### 核心职责
将用户输入解析为可并行执行的任务图，智能分配Agent，协调多Agent协作。

### 模块组成

**位置**: `src/orchestrator/`

#### 1. Orchestrator (主编排器)
- **文件**: `Orchestrator.ts`
- **职责**: 统一入口，协调整个编排流程
- **流程**: 接收输入 → 意图解析 → DAG构建 → 调度执行

#### 2. IntentParser (意图解析器)
- **文件**: `IntentParser.ts`
- **职责**: 将自然语言转换为结构化任务序列
- **输出**: 任务类型、步骤、所需Skills

#### 3. DAGBuilder (DAG构建器)
- **文件**: `DAGBuilder.ts`
- **职责**: 识别任务依赖关系，构建有向无环图
- **能力**: 识别可并行任务，优化执行顺序

#### 4. DAGBuilderV2 (增强版构建器)
- **文件**: `DAGBuilderV2.ts`
- **职责**: 支持智能路由和多Agent协作建议

#### 5. Scheduler (调度器)
- **文件**: `Scheduler.ts`
- **职责**: 基于DAG并行调度任务执行
- **策略**: 拓扑排序，识别ready集合，并行执行

#### 6. AgentRouter (智能路由器)
- **文件**: `AgentRouter.ts`
- **职责**: 基于语义匹配选择最合适的Agent
- **能力**: LLM驱动的语义理解

#### 7. AgentRegistry (Agent注册表)
- **文件**: `AgentRegistry.ts`
- **职责**: 维护所有Agent的能力描述
- **功能**: Agent发现、能力查询

#### 8. DAGValidator (DAG验证器)
- **文件**: `DAGValidator.ts`
- **职责**: 验证和修复DAG生成质量
- **功能**:
  - 检测占位符任务名称和描述
  - 自动生成具体化的任务内容
  - 推断和添加缺失的技能配置
  - 应用修复到DAG

#### 9. TaskExecutor (增强任务执行器)
- **文件**: `TaskExecutor.ts`
- **职责**: 集成验证和反思的任务执行
- **功能**:
  - 执行任务时自动验证输出质量
  - 输出不合格时触发反思和重试
  - 记录执行历史和性能统计
  - 生成详细的成功/失败报告

---

## L2: 执行层

### 核心职责
多个专业化Agent并行执行任务，各自处理擅长领域。

### 模块组成

**位置**: `src/agents/`

#### 1. Agent类型体系

**BaseAgent (抽象基类)**
- **文件**: `BaseAgent.ts`
- **职责**: 定义Agent通用接口和生命周期
- **功能**: LLM调用、Skill调用、上下文管理

**专业化Agent**
- **CodeAgent** (`CodeAgent.ts`) - 代码开发、重构、审查
- **DataAgent** (`DataAgent.ts`) - 数据分析、可视化
- **AutomationAgent** (`AutomationAgent.ts`) - 自动化任务、脚本执行
- **AnalysisAgent** (`AnalysisAgent.ts`) - 代码分析、架构评估
- **GenericAgent** (`GenericAgent.ts`) - 通用任务处理

#### 2. Agent管理

**AgentFactory (工厂)**
- **文件**: `AgentFactory.ts`
- **职责**: 动态创建Agent实例
- **功能**: 根据任务类型创建合适Agent

**AgentGenerator (生成器)**
- **文件**: `AgentGenerator.ts`
- **职责**: 基于反馈生成新Agent配置
- **功能**: 自动化Agent演进

#### 3. 自定义Agent

**位置**: `src/agents/custom/`
- 支持用户自定义Agent类型
- 示例: `DocumentAgent` - 文档处理专用Agent

#### 4. 新增专业Agent配置

**位置**: `config/agents/`

- **AINewsSummarizerAgent** - AI新闻搜索和总结专家
- **MoeModelAgent** - Moe模型设计和验证专家
- **SolidityContractAgent** - Ethereum智能合约开发专家
- **WorkRecordAgent** - 日常工作记录软件开发助手

---

## L3: Skills系统

### 核心职责
提供可插拔的能力模块，Agent可动态调用。

### 模块组成

**位置**: `src/skills/`

#### 1. Skill管理

**SkillManager**
- **文件**: `SkillManager.ts`
- **职责**: Skill注册、发现、调用
- **功能**: 智能匹配任务所需Skills

**SkillInstaller**
- **文件**: `SkillInstaller.ts`
- **职责**: Skill安装和初始化

#### 2. 内置Skills (8个)

**位置**: `src/skills/builtin/`

1. **CodeGenerationSkill** - 代码生成
2. **FileOpsSkill** - 文件操作 (v1.1.0安全加固)
3. **TerminalSkill** - 终端命令执行
4. **CodeReviewSkill** - 代码审查
5. **DataAnalysisSkill** - 数据分析
6. **DocxProcessingSkill** - Word文档处理
7. **WebSearchSkill** - 网络搜索
8. **SkillCreatorSkill** - 创建新Skill (元编程)

#### 3. 自定义Skills

**位置**: `skills/custom/`
- 支持用户自定义技能开发
- 标准化的技能接口
- 参数验证和类型检查
- 示例: hello-world - 打招呼功能

#### 4. 保留OpenClaw设计

- 声明式SKILL.md格式
- 动态加载机制
- 可复用OpenClaw的Skills

---

## L4: 状态管理层

### 核心职责
管理会话状态、共享状态、事件通信。

### 模块组成

**位置**: `src/state/`

#### 1. 共享状态

**Blackboard (黑板模式)**
- **文件**: `Blackboard.ts`
- **职责**: 跨Agent共享状态
- **存储**: Redis或内存
- **内容**: 会话、DAG、任务状态、产物

#### 2. 会话管理

**SessionStore**
- **文件**: `SessionStore.ts`
- **职责**: 会话历史存储
- **格式**: Markdown
- **功能**: 对话上下文持久化

#### 3. 事件通信

**EventBus**
- **文件**: `EventBus.ts`
- **职责**: 事件发布订阅
- **功能**: 解耦组件通信

#### 4. 其他状态组件

- **ScheduledTaskStore** - 定时任务存储
- **UserProfile** - 用户个性化配置
- **UserStore** - 用户数据存储
- **models.ts** - 数据模型定义
- **models_extended.ts** - 扩展数据模型

---

## L5: 进化层

### 核心职责
收集用户反馈，持续优化系统性能。

### 模块组成

**位置**: `src/evolution/`

#### 1. FeedbackCollector (反馈收集器)
- **文件**: `FeedbackCollector.ts`
- **职责**: 收集和分析用户反馈
- **功能**: 
  - 记录用户评价
  - 分析Agent表现
  - 生成优化建议

#### 2. 进化机制

- 基于反馈生成新Agent配置
- 优化Prompt策略
- 优化DAG调度策略

---

## L6: 安全层

### 核心职责
保障系统安全，隔离执行环境，保护敏感数据，实现细粒度权限控制。

### 模块组成

**位置**: `src/security/`

#### 1. SandboxManager (沙箱管理)
- **文件**: `SandboxManager.ts`
- **职责**: 隔离Agent执行环境
- **功能**:
  - 沙箱创建和管理
  - 资源限制
  - 环境隔离

#### 2. SensitiveDataFilter (敏感数据过滤)
- **文件**: `SensitiveDataFilter.ts`
- **职责**: 保护和过滤敏感信息
- **功能**:
  - API Key过滤
  - 敏感信息脱敏
  - 日志清理

#### 3. InputValidator (输入验证器)
- **文件**: `InputValidator.ts`
- **职责**: 验证和清理用户输入，防止注入攻击
- **功能**:
  - 检测命令注入、路径遍历、XSS、SQL注入
  - 危险模式检测
  - 风险等级评估
  - 输入清理和脱敏

#### 4. SecureSessionStore (安全会话存储)
- **文件**: `SecureSessionStore.ts`
- **职责**: 提供加密的会话存储
- **功能**:
  - AES-256-GCM加密
  - 敏感数据自动检测和过滤
  - 输入验证管道
  - 安全密钥管理

#### 5. SkillPermissionManager (技能权限管理)
- **文件**: `SkillPermissionManager.ts`
- **职责**: 基于权限的技能访问控制
- **功能**:
  - 细粒度权限检查
  - 资源限制验证
  - 执行审计和日志
  - 危险操作检测

#### 6. permissions (权限定义)
- **文件**: `permissions.ts`
- **职责**: 定义所有权限类型和权限组
- **功能**:
  - 20种权限类型
  - 9个权限组（文件、终端、网络、代码、数据、文档、系统、数据库、安全）
  - 权限组操作
  - 默认技能权限配置

---

## L7: LLM抽象层

### 核心职责
统一多种LLM提供商的接口。

### 模块组成

**位置**: `src/llm/`

#### 1. LLMClient (通用客户端)
- **文件**: `LLMClient.ts`
- **职责**: 统一LLM调用接口
- **支持**: Zhipu AI, DeepSeek, OpenAI, Qwen等

#### 2. PromptBuilder (提示词构建器)
- **文件**: `PromptBuilder.ts`
- **职责**: 组装Agent上下文和提示词
- **内容**:
  - System Prompt (config/agents/*.system.md)
  - 会话历史
  - Skills描述
  - 用户输入

#### 3. prompts (系统提示词)
- **文件**: `prompts.ts`
- **职责**: 存储系统级提示词模板

#### 4. index (统一导出)
- **文件**: `index.ts`
- **职责**: LLM模块统一导出接口
- **导出**:
  - LLMClient, PromptBuilder, prompts
  - LLMConfig, CompleteOptions, ChatMessage 类型

---

## L8: 调度层

### 核心职责
定时任务调度、优先级队列和周期性执行。

### 模块组成

**位置**: `src/scheduler/`

#### 1. CronScheduler (定时调度器)
- **文件**: `CronScheduler.ts`
- **职责**: 基于Cron表达式的任务调度
- **功能**: 定时触发Agent任务

#### 2. Scheduler (通用调度器)
- **文件**: `Scheduler.ts`
- **职责**: 通用任务调度逻辑

#### 3. LaneQueue (车道队列)
- **文件**: `LaneQueue.ts`
- **职责**: 基于优先级的并发任务执行
- **功能**:
  - 4个优先级车队（critical、high、normal、low）
  - 并发限制和超时控制
  - 任务优先级分配
  - 重试策略配置
  - 车队间资源隔离

---

## L9: API层

### 核心职责
提供REST API接口。

### 模块组成

**位置**: `src/api/`

#### 1. server (REST服务器)
- **文件**: `server.ts`
- **职责**: HTTP服务器
- **端口**: 3000

#### 2. index (统一导出)
- **文件**: `index.ts`
- **职责**: API模块统一导出接口
- **导出**:
  - APIServer, getAPIServer, createAPIServer

---

## L10: 可靠性层

### 核心职责
提供重试机制、幂等性保证、输出验证和自动反思，确保系统输出质量。

### 模块组成

**位置**: `src/reliability/`

#### 1. RetryManager (重试管理器)
- **文件**: `RetryManager.ts`
- **职责**: 处理自动重试逻辑
- **功能**:
  - 3种退避策略（指数、线性、固定）
  - 可配置重试次数和超时
  - 智能错误类型识别
  - 批量操作支持
  - 装饰器模式

#### 2. IdempotencyManager (幂等性管理器)
- **文件**: `IdempotencyManager.ts`
- **职责**: 确保操作只执行一次
- **功能**:
  - 防止重复执行
  - 结果缓存和TTL管理
  - 飞行中任务去重
  - 会话级缓存管理
  - 自动清理过期缓存

#### 3. OutputValidator (输出验证器)
- **文件**: `OutputValidator.ts`
- **职责**: 验证Agent输出是否符合预期
- **功能**:
  - 检测占位符和模板内容
  - 检查输出相关性和完整性
  - 质量评分（0-100）
  - 生成改进建议
  - 自动优化低质量输出

#### 4. ReflexionSystem (反思系统)
- **文件**: `ReflexionSystem.ts`
- **职责**: 执行失败时自动反思和重试
- **功能**:
  - 多次尝试执行任务
  - 分析失败原因并优化指令
  - 学习失败模式
  - 记录Agent性能统计
  - 生成失败诊断报告

---

## L11: 前端交互层

### 核心职责
提供Web界面，方便用户与NAC系统交互。

### 模块组成

**位置**: `web/`

#### 1. Web控制台
- **文件**: `index.html`, `app.js`, `styles.css`
- **职责**: 提供用户交互界面
- **功能**:
  - 任务输入和提交
  - 实时显示执行结果
  - 查看系统日志
  - 快捷任务模板
  - 结果导出

#### 2. 启动脚本
- **文件**: `scripts/start-web.sh`, `scripts/start-web.bat`
- **职责**: 快速启动Web服务
- **功能**:
  - 环境检查
  - 自动启动服务
  - 访问地址提示

#### 3. 使用文档
- **文件**: `web/README.md`
- **职责**: 详细的使用说明
- **内容**:
  - 快速开始指南
  - 功能说明
  - 使用示例
  - 故障排查

### 启动方式

```bash
# 方式1: 使用pnpm命令
pnpm web

# 方式2: 使用启动脚本
./scripts/start-web.sh      # Linux/Mac
scripts\start-web.bat        # Windows

# 访问地址
http://localhost:3000
```

### 主要功能

**任务输入**:
- 自然语言描述
- 快捷任务模板
- 实时输入验证

**结果展示**:
- Markdown格式化
- 代码高亮
- 任务指标
- 导出功能

**系统监控**:
- 连接状态
- Agent/Skill统计
- 运行任务数
- 实时日志

---

## 数据流架构

### 完整执行流程

```
用户输入
  ↓
InputValidator (输入验证和安全检查) [安全层]
  ↓
Orchestrator (主编排器)
  ↓
IntentParser (解析意图 → 任务序列)
  ↓
AgentRouter (语义匹配 → 选择Agent)
  ↓
DAGBuilder (构建任务依赖图)
  ↓
DAGValidator (验证DAG质量 → 修复占位符) [编排层]
  ↓
Scheduler + LaneQueue (并行调度 + 优先级队列) [调度层]
  ↓
TaskExecutor (增强执行器 → 带验证和反思) [可靠性层]
  ↓
AgentFactory (创建Agent实例)
  ├─→ CodeAgent (并行执行)
  ├─→ DataAgent (并行执行)
  ├─→ AutomationAgent (并行执行)
  └─→ AnalysisAgent (并行执行)
  ↓
SkillPermissionManager (权限检查) [安全层]
  ↓
Skills (可复用OpenClaw Skills)
  ↓
OutputValidator (验证输出质量) [可靠性层]
  ↓
ReflexionSystem (不合格 → 反思和重试) [可靠性层]
  ↓
Blackboard (跨Agent共享状态)
  ↓
SecureSessionStore (加密会话存储) [安全层]
  ↓
FeedbackCollector (收集反馈 → 进化优化)
```

---

## 配置说明

### LLM配置
```bash
ZHIPU_API_KEY=720a710f969c4205ba062583c96171a2.lu1a4JdyoBxWNp0I
ZHIPU_MODEL=glm-4-flash
```

### 系统配置
```bash
MAX_PARALLEL_AGENTS=10      # 最大并行Agent数
TASK_TIMEOUT=300000         # 任务超时时间
ENABLE_DAG_OPTIMIZATION=true # 启用DAG优化
LOG_LEVEL=info              # 日志级别

# 安全配置
ENABLE_INPUT_VALIDATION=true # 启用输入验证
ENABLE_PERMISSION_CHECK=true # 启用权限检查
SESSION_ENCRYPTION=true      # 启用会话加密

# 可靠性配置
ENABLE_RETRY=true           # 启用重试机制
MAX_RETRY_ATTEMPTS=3        # 最大重试次数
IDEMPOTENCY_CACHE_TTL=3600  # 幂等性缓存TTL(秒)

# 输出验证和反思配置
ENABLE_OUTPUT_VALIDATION=true  # 启用输出验证
ENABLE_REFLEXION=true          # 启用自动反思
MIN_OUTPUT_QUALITY_SCORE=60    # 最低输出质量分数(0-100)
MAX_REFLEXION_ATTEMPTS=2       # 最大反思重试次数
```

---

## 技术栈

- **运行时**: Node.js 20+, TypeScript 5+
- **包管理**: pnpm
- **状态存储**: Redis 7+ (可选), Markdown文件
- **LLM集成**: OpenAI SDK (兼容多提供商)
- **构建**: tsup / esbuild

---

## 与OpenClaw的关系

### 保留的OpenClaw能力

✅ **消息网关** (可选)
- WebSocket Gateway (18789端口)
- Channel Registry渠道抽象

✅ **Skills系统基础**
- 声明式SKILL.md格式
- 动态加载机制

✅ **LLM抽象**
- 统一的LLM客户端
- 提示词构建器

### NAC新增能力

🆅 **编排层** - DAG任务编排
🆅 **多Agent集群** - 并行协作
🆅 **智能路由** - 语义匹配
🆅 **进化层** - 反馈优化
🆅 **安全层** - 输入验证、权限控制、数据加密、沙箱隔离
🆅 **可靠性层** - 重试机制、幂等性保证

---

*文档版本: 4.0*
*最后更新: 2026-03-21*
