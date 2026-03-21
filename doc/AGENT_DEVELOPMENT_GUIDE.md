# Agent 开发指南

本指南将帮助你在 NexusAgent-Cluster 中编写自定义 Agent。

## 目录

1. [快速开始](#快速开始)
2. [Agent 架构](#agent-架构)
3. [创建自定义 Agent](#创建自定义-agent)
4. [Agent 能力配置](#agent-能力配置)
5. [系统提示词](#系统提示词)
6. [最佳实践](#最佳实践)
7. [示例：DocumentAgent](#示例-documentagent)

---

## 快速开始

### 方式一：使用生成器脚本

```bash
# 创建新的 Agent
pnpm cli agent:create MyAgent

# 这将创建：
# src/agents/custom/MyAgent/
#   ├── agent.config.json    # Agent 配置
#   ├── index.ts             # Agent 实现
#   └── MyAgent.system.md    # 系统提示词
```

### 方式二：手动创建

1. 在 `src/agents/custom/` 下创建新目录
2. 创建必需的配置文件和实现文件
3. 系统会自动发现并加载

---

## Agent 架构

```
src/agents/custom/YourAgent/
├── agent.config.json       # 必需：Agent 能力描述
├── index.ts                # 必需：Agent 实现
├── YourAgent.system.md     # 可选：自定义系统提示词
└── skills/                 # 可选：Agent 专用技能
    └── custom-skill.ts
```

### 继承结构

```
BaseAgent (抽象基类)
    ↓
YourAgent (自定义实现)
```

**BaseAgent 提供的方法：**

| 方法 | 说明 |
|------|------|
| `execute(task)` | 必须实现，执行任务的核心方法 |
| `callLLM(prompt)` | 调用 LLM |
| `callLLMWithContext(options)` | 带完整上下文调用 LLM |
| `useSkill(name, params)` | 使用技能 |
| `getSystemPrompt()` | 获取系统提示词 |
| `setStatus(status)` | 设置状态 |
| `getStats()` | 获取统计信息 |

---

## 创建自定义 Agent

### 步骤 1: 创建目录和配置文件

**`src/agents/custom/MyAgent/agent.config.json`**

```json
{
  "description": "Agent 的简要描述",
  "strengths": [
    "擅长的事情1",
    "擅长的事情2"
  ],
  "weaknesses": [
    "不擅长的事情1"
  ],
  "idealTasks": [
    "task keyword 1",
    "task keyword 2"
  ],
  "requiredSkills": [
    "skill-name-1",
    "skill-name-2"
  ],
  "examples": [
    "示例任务描述1",
    "示例任务描述2"
  ],
  "version": "1.0.0",
  "author": "Your Name",
  "systemPromptFile": "MyAgent.system.md"
}
```

### 步骤 2: 实现 Agent 类

**`src/agents/custom/MyAgent/index.ts`**

```typescript
/**
 * MyAgent - 自定义 Agent 实现
 */

import { BaseAgent } from '../../BaseAgent.js';

export class MyAgent extends BaseAgent {
  constructor(llm: any, skillManager: any) {
    super(llm, skillManager, 'MyAgent');
  }

  /**
   * 执行任务（必须实现）
   */
  async execute(task: {
    description: string;
    input?: string;
    output?: string;
    options?: Record<string, any>;
  }): Promise<any> {
    this.setStatus('busy');
    const startTime = Date.now();

    try {
      this.logger.info({ task }, 'Executing task');

      // 1. 解析任务
      const taskType = this.parseTaskType(task.description);

      // 2. 执行相应操作
      let result: any;
      switch (taskType) {
        case 'action1':
          result = await this.handleAction1(task);
          break;
        case 'action2':
          result = await this.handleAction2(task);
          break;
        default:
          result = await this.handleGenericTask(task);
      }

      // 3. 更新统计
      this.tasksCompleted++;
      this.totalExecutionTime += Date.now() - startTime;
      this.setStatus('idle');

      return {
        success: true,
        result,
      };
    } catch (error: any) {
      this.setStatus('error');
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 解析任务类型
   */
  private parseTaskType(description: string): string {
    const desc = description.toLowerCase();

    if (desc.includes('keyword1')) return 'action1';
    if (desc.includes('keyword2')) return 'action2';

    return 'generic';
  }

  /**
   * 处理特定操作
   */
  private async handleAction1(task: any): Promise<any> {
    // 使用 LLM 处理
    const response = await this.callLLMWithContext({
      userInput: task.description,
      includeSessionHistory: true,
    });

    return { response };
  }

  /**
   * 处理通用任务
   */
  private async handleGenericTask(task: any): Promise<any> {
    const response = await this.callLLMWithContext({
      userInput: task.description,
      includeSessionHistory: true,
    });

    return { response };
  }
}

// 默认导出
export default MyAgent;
```

### 步骤 3: 创建系统提示词（可选）

**`src/agents/custom/MyAgent/MyAgent.system.md`**

```markdown
# MyAgent System Prompt

你是一个专业的 XXX Agent，负责 XXX 相关任务。

## 核心能力

1. 能力描述 1
2. 能力描述 2
3. 能力描述 3

## 工作原则

1. 原则 1
2. 原则 2

## 任务处理流程

对于每个任务：
1. 理解需求
2. 执行操作
3. 返回结果
```

---

## Agent 能力配置

### agent.config.json 字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `description` | string | ✅ | Agent 的功能描述 |
| `strengths` | string[] | ✅ | Agent 擅长的能力列表 |
| `weaknesses` | string[] | ✅ | Agent 不擅长的事情列表 |
| `idealTasks` | string[] | ✅ | 适合处理的任务关键词（用于路由匹配） |
| `requiredSkills` | string[] | ✅ | 需要的技能列表 |
| `examples` | string[] | ✅ | 示例任务描述 |
| `version` | string | ✅ | 版本号 |
| `author` | string | ❌ | 作者信息 |
| `systemPromptFile` | string | ❌ | 自定义系统提示词文件名 |

### 路由匹配原理

系统使用以下信息进行智能路由：

1. **idealTasks** - 关键词匹配（主要依据）
2. **strengths** - 能力匹配
3. **description** - 语义匹配（通过 LLM）

**示例配置：**

```json
{
  "idealTasks": [
    "generate code",
    "create API",
    "implement feature",
    "write tests"
  ]
}
```

当用户输入 "帮我生成一个用户登录 API" 时，系统会：
1. 检测到 "generate" 和 "API" 关键词
2. 与 idealTasks 匹配
3. 推荐使用此 Agent

---

## 系统提示词

### 提示词加载优先级

1. **自定义文件** - `MyAgent.system.md`
2. **全局配置** - `config/agents/MyAgent.system.md`
3. **默认提示词** - `src/llm/prompts.ts` 中的 `SystemPrompts`

### 提示词最佳实践

✅ **好的提示词：**

```markdown
# CodeAgent System Prompt

你是一个专业的软件开发 Agent。

## 核心职责
1. 生成高质量代码
2. 遵循最佳实践
3. 处理边界条件

## 输出格式
- 代码使用 markdown 代码块
- 添加必要的注释
- 包含使用示例
```

❌ **不好的提示词：**

```
你是一个写代码的助手。
```

---

## 最佳实践

### 1. 任务解析

使用清晰的任务类型解析：

```typescript
private parseTaskType(description: string): string {
  const keywords = {
    create: ['create', 'generate', 'build', 'make', '创建', '生成'],
    analyze: ['analyze', 'examine', 'check', '分析', '检查'],
    fix: ['fix', 'repair', 'solve', '修复', '解决'],
  };

  const desc = description.toLowerCase();

  for (const [type, words] of Object.entries(keywords)) {
    if (words.some(w => desc.includes(w))) {
      return type;
    }
  }

  return 'generic';
}
```

### 2. 错误处理

始终包含适当的错误处理：

```typescript
try {
  const result = await this.performAction(task);
  this.tasksCompleted++;
  return { success: true, result };
} catch (error: any) {
  this.logger.error({ error: error.message }, 'Task failed');
  this.setStatus('error');
  return {
    success: false,
    error: error.message,
    retryable: this.isRetryable(error),
  };
}
```

### 3. 日志记录

使用适当的日志级别：

```typescript
this.logger.debug({ detail }, 'Detailed debug info');
this.logger.info({ task }, 'Task started');
this.logger.warn({ issue }, 'Potential issue detected');
this.logger.error({ error }, 'Operation failed');
```

### 4. 技能使用

优先使用技能而不是直接实现：

```typescript
// 好的做法
const result = await this.useSkill('file-read', { path: filePath });

// 而不是
const content = await fs.readFile(filePath, 'utf-8');
```

### 5. LLM 交互

使用完整的上下文：

```typescript
const response = await this.callLLMWithContext({
  userInput: prompt,
  sessionId: task.sessionId,
  includeSessionHistory: true,
  includeSkills: true,
  additionalContext: customContext,
});
```

---

## 示例：DocumentAgent

完整的 DocumentAgent 实现已包含在项目中：

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
- 格式转换（部分）

**使用示例：**

```typescript
// 任务会被自动路由到 DocumentAgent
const result = await orchestrator.processRequest({
  sessionId: 'session-123',
  userInput: '重写 C:\\Users\\Documents\\draft.docx 使其更专业',
});
```

---

## 测试自定义 Agent

### 单元测试

```typescript
// tests/agents/MyAgent.test.ts
import { describe, it, expect } from 'vitest';
import { MyAgent } from '../../src/agents/custom/MyAgent/index.js';

describe('MyAgent', () => {
  it('should parse task type correctly', async () => {
    const agent = new MyAgent(mockLLM, mockSkillManager);
    const result = await agent.execute({
      description: 'create a new feature',
    });
    expect(result.success).toBe(true);
  });
});
```

### 集成测试

```bash
# 通过 CLI 测试
pnpm cli run "你的任务描述"

# 检查是否使用了正确的 Agent
# 日志会显示路由结果
```

---

## 常见问题

### Q: Agent 没有被自动加载？

**A:** 检查以下内容：
1. 文件是否在 `src/agents/custom/YourAgent/` 目录下
2. `agent.config.json` 和 `index.ts` 是否存在
3. `index.ts` 是否正确导出了 Agent 类

### Q: 如何调试 Agent 路由？

**A:** 查看日志中的路由信息：

```typescript
logger.info({
  topMatch: 'CodeAgent',
  confidence: 0.95,
  alternatives: [...]
}, 'Routing complete');
```

### Q: 可以动态重新加载 Agent 吗？

**A:** 当前版本需要重启应用。未来版本可能支持热重载。

---

## 下一步

- 查看 `src/agents/` 下的内置 Agent 实现作为参考
- 阅读 `src/orchestrator/` 了解系统如何使用 Agent
- 创建自定义技能来扩展 Agent 能力
