# NAC项目失败测试用例清单

**生成时间**: 2026-03-21
**测试总数**: ~53
**通过**: ~36 (67%)
**失败**: 17 (33%)

---

## 🔴 失败测试用例详细列表

### 一、tests/core-validation.test.ts (13个失败)

#### 1. TC-LLM-003: Prompt 模板应正常工作 ❌
```
错误: Cannot find module '../src/llm/prompts.js'
堆栈:
  - tests/core-validation.test.ts:62:60
  - const { IntentAnalysisPrompt, TaskPlanningPrompt } = require('../src/llm/prompts.js')

原因: 测试文件直接导入.js文件，但源文件是.ts
```

#### 2. TC-SKILL-002: 技能应能正确执行（参数验证）❌
```
错误: ReferenceError: Permission is not defined
堆栈:
  - src/skills/SkillManager.ts:299:51
  - return { granted: true, requiredPermission: Permission.FILE_READ...

原因: SkillManager中使用了Permission枚举但未导入
```

#### 3. TC-AGENT-001: 应能创建所有 Agent 类型 ❌
```
错误: AssertionError: expected undefined to be an instance of Function
堆栈:
  - tests/core-validation.test.ts:142:31
  - expect(agent.execute).toBeInstanceOf(Function)

原因: agent.execute方法返回undefined，可能是AgentFactory初始化问题
```

#### 4. TC-AGENT-002: Agent 应能获取系统提示词 ❌
```
错误: TypeError: codeAgent.getSystemPrompt is not a function
堆栈:
  - tests/core-validation.test.ts:150:44
  - const systemPrompt = await codeAgent.getSystemPrompt()

原因: BaseAgent或其子类没有实现getSystemPrompt()方法
```

#### 5. TC-BB-001: Blackboard 应支持共享状态 ❌
```
错误: TypeError: blackboard.setState is not a function
堆栈:
  - tests/core-validation.test.ts:246:24
  - await blackboard.setState(sessionId, 'testKey', { value: 'testValue' })

原因: 测试调用setState()，但实际API是updateSessionState()
```

#### 6. TC-BB-002: EventBus 应支持发布订阅 ❌
```
错误: TypeError: eventBus.subscribe is not a function
堆栈:
  - tests/core-validation.test.ts:258:16
  - eventBus.subscribe(EventType.SESSION_CREATED, () => { ... })

原因: EventBus没有实现subscribe()方法，或者没有独立的EventBus类
```

#### 7. ✅ L2-1: LLM 抽象层应实现 ❌
```
错误: Cannot find module '../src/llm/PromptBuilder.js'
堆栈:
  - tests/core-validation.test.ts:374:33
  - const { PromptBuilder } = require('../src/llm/PromptBuilder.js')

原因: 测试直接导入.js文件，应该使用index.js或.ts文件
```

#### 8. ✅ L2-3.5: 智能路由系统应实现 ❌
```
错误: Cannot find module '../src/orchestrator/AgentRouter.js'
堆栈:
  - tests/core-validation.test.ts:391:31
  - const { AgentRouter } = require('../src/orchestrator/AgentRouter.js')

原因: 测试直接导入.js文件
```

#### 9. ✅ L2-5: Intent Parser 应实现 ❌
```
错误: Cannot find module '../src/orchestrator/IntentParser.js'
堆栈:
  - tests/core-validation.test.ts:401:32
  - const { IntentParser } = require('../src/orchestrator/IntentParser.js')

原因: 测试直接导入.js文件
```

#### 10. ✅ L2-6: DAG Builder 应实现 ❌
```
错误: Cannot find module '../src/orchestrator/DAGBuilder.js'
堆栈:
  - tests/core-validation.test.ts:406:44
  - const { DAGBuilder, DAGBuilderV2 } = require('../src/orchestrator/DAGBuilder.js')

原因: 测试直接导入.js文件
```

#### 11. ✅ L2-7: Scheduler 应实现 ❌
```
错误: Cannot find module '../src/orchestrator/Scheduler.js'
堆栈:
  - tests/core-validation.test.ts:412:29
  - const { Scheduler } = require('../src/orchestrator/Scheduler.js')

原因: 测试直接导入.js文件
```

#### 12. ✅ L2-8: Orchestrator 应实现 ❌
```
错误: Cannot find module '../src/orchestrator/Orchestrator.js'
堆栈:
  - tests/core-validation.test.ts:417:32
  - const { Orchestrator } = require('../src/orchestrator/Orchestrator.js')

原因: 测试直接导入.js文件
```

#### 13. ✅ L2-10: API 服务应实现 ❌
```
错误: Cannot find module '../src/api/server.js'
堆栈:
  - tests/core-validation.test.ts:422:25
  - const apiModule = require('../src/api/server.js')

原因: 测试直接导入.js文件
```

---

### 二、tests/integration.test.ts (2个失败)

#### 14. should list all skills ❌
```
错误: AssertionError: expected 0 to be greater than 0
堆栈:
  - tests/integration.test.ts:130:29
  - expect(skills.length).toBeGreaterThan(0)

原因: SkillManager.listSkills()返回空数组，可能是初始化问题
```

#### 15. should process a complete request ❌
```
错误: Test timed out in 60000ms
堆栈:
  - tests/integration.test.ts
  - 完整请求流程测试超时

原因: 端到端测试执行超过60秒，可能是LLM调用耗时
```

---

### 三、tests/scripts/test-core-modules.test.ts (加载失败)

#### 16. 整个测试套件加载失败 ❌
```
错误: Failed to load url ./LLM.js (resolved id: ./LLM.js)
     in D:/test/agent/jiqun/src/llm/index.ts
     Does the file exist?

原因: src/llm/index.ts中导出路径错误
```

**影响**: 该文件中的所有测试无法运行
- 应该能够创建CodeAgent
- 应该能够创建DataAgent
- 应该能够创建AutomationAgent
- 应该能够创建AnalysisAgent
- 应该能够创建GenericAgent
- 应该能够创建Orchestrator实例
- 应该能够初始化Orchestrator
- 应该能够获取AgentRegistry实例
- 应该能够注册和查询Agent
- ... (共16个测试)

---

### 四、tests/basic.test.ts (全部通过 ✅)

所有11个基础测试通过！包括：
- 配置加载
- Agent注册
- Skill管理
- DAG构建
- 意图解析
等

---

## 📊 失败原因分类统计

| 失败原因 | 数量 | 占比 | 优先级 |
|---------|------|------|--------|
| **模块导入路径错误** | 8 | 47% | P0 |
| **API方法不存在** | 4 | 24% | P0 |
| **枚举/类型未定义** | 1 | 6% | P1 |
| **初始化问题** | 2 | 12% | P1 |
| **超时** | 2 | 12% | P2 |

---

## 🔧 修复方案详解

### 类别1: 模块导入路径错误 (8个测试) - P0

**问题**: 测试文件使用 `.js` 扩展名导入TypeScript文件

**受影响测试**:
- TC-LLM-003
- L2-1: LLM 抽象层
- L2-3.5: 智能路由系统
- L2-5: Intent Parser
- L2-6: DAG Builder
- L2-7: Scheduler
- L2-8: Orchestrator
- L2-10: API 服务

**修复方案** (3选1):

**方案A**: 修改测试导入使用index文件
```typescript
// 修改前
const { PromptBuilder } = require('../src/llm/PromptBuilder.js');

// 修改后
const { PromptBuilder } = require('../src/llm/index.js');
```

**方案B**: 移除文件扩展名
```typescript
// 修改后
import { PromptBuilder } from '../src/llm';
```

**方案C**: 在测试前运行TypeScript编译
```bash
# 在package.json中
"test": "tsc && vitest"
```

**推荐**: 方案A (最快，风险最小)

---

### 类别2: API方法不存在 (4个测试) - P0

#### 2.1 Blackboard.setState() 不存在

**受影响测试**: TC-BB-001

**当前API**:
```typescript
await blackboard.updateSessionState(sessionId, updates);
```

**测试期望**:
```typescript
await blackboard.setState(sessionId, key, value);
```

**修复方案**:
```typescript
// 添加到 src/state/Blackboard.ts
async setState(sessionId: string, key: string, value: any): Promise<void> {
  const state = await this.getState(sessionId);
  if (!state) return;
  await this.updateSessionState(sessionId, { [key]: value });
}
```

#### 2.2 EventBus.subscribe() 不存在

**受影响测试**: TC-BB-002

**问题**: 可能没有独立的EventBus类，或者方法名不同

**当前实现**: Blackboard有subscribe方法
```typescript
async subscribe(callback: (event: string, data: any) => void): Promise<void>
```

**测试期望**:
```typescript
eventBus.subscribe(EventType.SESSION_CREATED, callback);
```

**修复方案**:
```typescript
// 创建 src/state/EventBus.ts
export class EventBus {
  private listeners: Map<string, Function[]> = new Map();

  subscribe(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  publish(event: string, data: any): void {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(cb => cb(data));
  }
}
```

#### 2.3 Agent.getSystemPrompt() 不存在

**受影响测试**: TC-AGENT-002

**问题**: BaseAgent没有getSystemPrompt方法

**修复方案**:
```typescript
// 添加到 src/agents/BaseAgent.ts
async getSystemPrompt(): Promise<string> {
  const promptBuilder = getPromptBuilder();
  return promptBuilder.buildSystemPrompt(this.config);
}
```

#### 2.4 Agent.execute返回undefined

**受影响测试**: TC-AGENT-001

**问题**: AgentFactory创建的agent.execute是undefined

**可能原因**: Agent未正确初始化或execute方法未绑定

**修复方案**: 检查AgentFactory和BaseAgent初始化逻辑

---

### 类别3: 枚举未定义 (1个测试) - P1

**受影响测试**: TC-SKILL-002

**问题**: Permission枚举未定义

**修复方案**:
```typescript
// 创建 src/security/permissions.ts
export enum Permission {
  FILE_READ = 'file:read',
  FILE_WRITE = 'file:write',
  TERMINAL_EXEC = 'terminal:exec',
  WEB_SEARCH = 'web:search',
  // ...
}

// 在 SkillManager.ts中导入
import { Permission } from '../security/permissions.js';
```

---

### 类别4: 初始化问题 (2个测试) - P1

#### 4.1 SkillManager.listSkills()返回空数组

**受影响测试**: should list all skills

**问题**: SkillManager未正确初始化

**修复方案**: 确保在测试中调用await skillManager.initialize()

#### 4.2 test-core-modules.test.ts加载失败

**问题**: src/llm/index.ts导出路径错误

**已修复**: 但可能需要重新运行vitest

---

### 类别5: 超时问题 (2个测试) - P2

**受影响测试**:
- should process a complete request (60秒超时)
- test-core-modules.test.ts (整个套件)

**修复方案**:
1. 增加测试超时时间
2. Mock LLM调用以减少耗时
3. 检查是否有死循环或阻塞

---

## 🎯 修复优先级和时间估算

### P0 - 立即修复 (2-3小时)
1. ✅ 修改8个测试的导入路径 (30分钟)
2. ✅ 添加Blackboard.setState()方法 (15分钟)
3. ✅ 添加EventBus类 (30分钟)
4. ✅ 添加Agent.getSystemPrompt()方法 (15分钟)
5. ✅ 修复Agent.execute问题 (30分钟)

### P1 - 今日修复 (1-2小时)
6. ✅ 定义Permission枚举 (15分钟)
7. ✅ 修复SkillManager初始化 (15分钟)
8. ✅ 修复test-core-modules加载问题 (15分钟)

### P2 - 后续优化 (1小时)
9. ✅ 优化超时测试 (30分钟)
10. ✅ 性能优化 (30分钟)

---

## 📝 修复检查清单

### 第一步: 修复导入路径 (8个测试)
- [ ] 修改 tests/core-validation.test.ts 中所有直接.js导入
- [ ] 将导入改为使用index.js文件
- [ ] 验证所有模块可以从index文件正确导出

### 第二步: 添加缺失方法 (4个测试)
- [ ] Blackboard.setState()
- [ ] EventBus类及subscribe方法
- [ ] Agent.getSystemPrompt()
- [ ] 修复AgentFactory.execute()

### 第三步: 修复类型问题 (1个测试)
- [ ] 创建Permission枚举
- [ ] 在SkillManager中导入
- [ ] 验证所有权限检查正常

### 第四步: 修复初始化 (2个测试)
- [ ] SkillManager.listSkills()
- [ ] test-core-modules加载

### 第五步: 优化性能 (2个测试)
- [ ] 增加端到端测试超时
- [ ] Mock LLM调用

---

**总计**: 17个失败测试
**预计修复时间**: 4-6小时
**修复后预期通过率**: 90%+

---

*生成时间: 2026-03-21*
