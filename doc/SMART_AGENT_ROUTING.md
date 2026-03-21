# 智能改进方案 - 使用指南

本文档介绍 NexusAgent-Cluster 的智能改进功能及其使用方法。

---

## 改进概览

### 原系统的问题

| 问题 | 原实现 | 问题 |
|------|--------|------|
| Agent 判断 | 简单关键词匹配 | `includes('code')` 太粗糙 |
| Skills 系统 | 未使用 | `requiredSkills: []` |
| 扩展性 | 硬编码 5 种 Agent | 无法动态添加 |

### 改进后的架构

```
用户输入
    ↓
┌─────────────────────────────────────────┐
│     AgentRouter (智能路由器)              │
│  - LLM 语义匹配                          │
│  - 多 Agent 协作决策                      │
│  - 置信度评分                            │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│     AgentRegistry (Agent 注册表)         │
│  - 动态注册/发现                         │
│  - 能力描述 (Profile)                    │
│  - 自定义 Agent 加载                     │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│     SkillMatcher (技能匹配器)            │
│  - 任务 → Skill 映射                     │
│  - 动态加载                              │
└─────────────────────────────────────────┘
    ↓
合适的 Agent + Skills
```

---

## 核心改进

### 1. AgentRouter - 智能路由器

**位置：** `src/orchestrator/AgentRouter.ts`

**功能：**
- 使用 LLM 进行语义匹配，而非简单关键词
- 为每个 Agent 评分（0-1 置信度）
- 自动检测是否需要多 Agent 协作
- 降级策略（LLM 失败时使用关键词匹配）

**使用示例：**

```typescript
import { AgentRouter } from './orchestrator/AgentRouter.js';

const router = new AgentRouter(llmClient);

const matches = await router.route({
  description: '重写 C:\\Users\\Documents\\draft.docx 使其更专业',
  intent: 'other',
  capabilities: ['document-processing', 'text-analysis'],
  complexity: 5,
});

// 返回结果示例
// [
//   { agentType: 'DocumentAgent', confidence: 0.92, reason: '...', suggestedSkills: ['docx-processing'] },
//   { agentType: 'GenericAgent', confidence: 0.45, reason: '...', suggestedSkills: [] }
// ]
```

### 2. AgentRegistry - Agent 注册表

**位置：** `src/orchestrator/AgentRegistry.ts`

**功能：**
- 管理所有 Agent 类型和能力描述
- 支持动态加载自定义 Agent
- Agent 能力自描述（strengths, weaknesses, idealTasks）
- 根据 Skill 查找 capable Agents

**注册方法：**

```typescript
import { getAgentRegistry } from './orchestrator/AgentRegistry.js';

const registry = getAgentRegistry();
await registry.initialize();

// 注册自定义 Agent
registry.registerAgent('MyAgent', MyAgentClass, {
  agentType: 'MyAgent',
  description: '我的自定义 Agent',
  strengths: ['擅长的事1', '擅长的事2'],
  weaknesses: ['不擅长的事'],
  idealTasks: ['keyword1', 'keyword2'],
  requiredSkills: ['skill1'],
  examples: ['示例任务'],
  version: '1.0.0',
  author: 'Your Name',
});
```

**自动加载：**

系统会自动从以下目录加载自定义 Agent：
- `src/agents/custom/*/`
- `agents/*/`

每个自定义 Agent 目录需包含：
- `agent.config.json` - Agent 配置
- `index.ts` - Agent 实现

### 3. DAGBuilderV2 - 改进的 DAG 构建器

**位置：** `src/orchestrator/DAGBuilderV2.ts`

**功能：**
- 使用 AgentRouter 而非简单关键词匹配
- 将路由结果传递给 LLM 生成更精确的执行计划
- 支持多 Agent 协作场景

**对比：**

| 特性 | 原 DAGBuilder | DAGBuilderV2 |
|------|---------------|--------------|
| Agent 选择 | `inferAgentType()` 关键词 | AgentRouter LLM 语义匹配 |
| Skills | 始终为空 `[]` | 从路由结果获取 |
| 协作支持 | 无 | 检测并规划协作 |

---

## 创建自定义 Agent

### 快速开始

**1. 创建 Agent 目录结构：**

```
src/agents/custom/MyAgent/
├── agent.config.json       # 必需
├── index.ts                # 必需
└── MyAgent.system.md       # 可选
```

**2. 配置文件 (agent.config.json)：**

```json
{
  "description": "Agent 功能描述",
  "strengths": ["擅长的事情"],
  "weaknesses": ["不擅长的事情"],
  "idealTasks": ["keyword1", "keyword2"],
  "requiredSkills": ["skill-name"],
  "examples": ["示例任务"],
  "version": "1.0.0",
  "author": "Your Name"
}
```

**3. Agent 实现 (index.ts)：**

```typescript
import { BaseAgent } from '../../BaseAgent.js';

export class MyAgent extends BaseAgent {
  constructor(llm: any, skillManager: any) {
    super(llm, skillManager, 'MyAgent');
  }

  async execute(task: any): Promise<any> {
    this.setStatus('busy');

    try {
      // 处理任务
      const result = await this.processTask(task);

      this.tasksCompleted++;
      this.setStatus('idle');

      return { success: true, result };
    } catch (error) {
      this.setStatus('error');
      return { success: false, error: error.message };
    }
  }
}

export default MyAgent;
```

### 示例：DocumentAgent

完整的文档处理 Agent 已包含在项目中：

```
src/agents/custom/DocumentAgent/
├── agent.config.json
├── index.ts
└── DocumentAgent.system.md
```

**功能：**
- 文档重写
- 内容分析
- 文档摘要
- 格式转换

**使用：**

```bash
# 通过 CLI 使用
pnpm cli run "重写 C:\\Users\\Documents\\draft.docx 使其更专业"
```

---

## 新增 Skills

### DocxProcessingSkill

**位置：** `src/skills/builtin/DocxProcessingSkill.ts`

**功能：**
- 读取 .docx 文件内容
- 转换为 Markdown/HTML/Text 格式
- 提取原始文本

**依赖：**

```bash
pnpm add mammoth
pnpm add -D @types/mammoth
```

**使用：**

```typescript
const result = await skillManager.executeSkill('docx-processing', {
  action: 'extract',
  path: 'document.docx',
  outputFormat: 'markdown',
});
```

---

## 使用智能路由

### 启用改进版本

在 `Orchestrator.ts` 中替换 DAGBuilder：

```typescript
// 原版本
// import { DAGBuilder } from './DAGBuilder.js';
// this.dagBuilder = new DAGBuilder(this.llm);

// 改进版本
import { DAGBuilderV2 } from './DAGBuilderV2.js';
this.dagBuilder = new DAGBuilderV2(this.llm);
```

### 查看路由决策

日志会显示路由结果：

```bash
pnpm cli run "你的任务"

# 日志输出
# [INFO] Routing task to agents
# [INFO] Routing complete
#   topMatch: DocumentAgent
#   confidence: 0.92
#   alternatives: [
#     { type: 'GenericAgent', score: 0.45 },
#     { type: 'CodeAgent', score: 0.23 }
#   ]
```

### 多 Agent 协作

当任务复杂且适合多个 Agent 时，系统会自动建议协作：

```bash
# [INFO] Collaboration suggested
#   Primary: DocumentAgent (0.92)
#   Supporters: AnalysisAgent (0.75), GenericAgent (0.60)
#   Strategy: DocumentAgent 主导，AnalysisAgent 提供支持
```

---

## 配置选项

### RouterConfig

```typescript
interface RouterConfig {
  enableCache?: boolean;        // 启用路由缓存
  cacheTTL?: number;            // 缓存过期时间 (ms)
  fallbackToGeneric?: boolean;  // 失败时是否回退到 GenericAgent
  collaborationThreshold?: number; // 协作阈值 (0-1)
}
```

**示例：**

```typescript
const router = new AgentRouter(llm, {
  enableCache: true,
  cacheTTL: 300000,     // 5 分钟
  fallbackToGeneric: true,
  collaborationThreshold: 0.7,
});
```

---

## API 参考

### AgentRouter

| 方法 | 说明 |
|------|------|
| `route(task)` | 为任务路由到合适的 Agent |
| `shouldCollaborate(matches)` | 判断是否需要协作 |
| `getCollaborationPlan(matches)` | 获取协作计划 |

### AgentRegistry

| 方法 | 说明 |
|------|------|
| `registerAgent(type, class, profile)` | 注册 Agent |
| `getAgentClass(type)` | 获取 Agent 类 |
| `getCapability(type)` | 获取能力描述 |
| `findAgentsBySkill(skill)` | 按 Skill 查找 Agent |
| `findAgentsForTask(desc)` | 按任务描述查找 Agent |
| `getStats()` | 获取统计信息 |

---

## 最佳实践

### 1. 编写 good idealTasks

```json
{
  "idealTasks": [
    "generate code",     // 使用英文关键词
    "create API",
    "implement feature"
  ]
}
```

### 2. 合理设置 strengths/weaknesses

帮助路由器做出更好的决策：

```json
{
  "strengths": ["代码生成", "API 设计"],
  "weaknesses": ["不适合数据分析", "不擅长文档编写"]
}
```

### 3. 提供清晰的 examples

```json
{
  "examples": [
    "生成一个用户认证 REST API",
    "实现数据验证中间件"
  ]
}
```

---

## 故障排查

### Agent 未被加载

1. 检查目录结构是否正确
2. 确认 `agent.config.json` 格式正确
3. 查看 AgentRegistry 初始化日志

### 路由不准确

1. 检查 `idealTasks` 关键词是否覆盖任务场景
2. 添加更多 examples
3. 调整 `strengths` 和 `weaknesses`

### Skills 未生效

1. 确认 Skill 已在 SkillManager 中注册
2. 检查 Agent 的 `requiredSkills` 配置
3. 查看 Skill 的 `enabled` 状态

---

## 下一步

- 阅读 [Agent 开发指南](./AGENT_DEVELOPMENT_GUIDE.md)
- 查看 [DocumentAgent 示例](../src/agents/custom/DocumentAgent/)
- 创建自定义 Skill 扩展功能
