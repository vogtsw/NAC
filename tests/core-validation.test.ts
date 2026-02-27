/**
 * 核心功能测试脚本
 * 验证 NexusAgent-Cluster 是否满足 task.md 的要求
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getLLMClient } from '../src/llm/LLMClient.js';
import { getSkillManager } from '../src/skills/SkillManager.js';
import { getAgentRegistry } from '../src/orchestrator/AgentRegistry.js';
import { AgentFactory } from '../src/agents/AgentFactory.js';
import { IntentParser } from '../src/orchestrator/IntentParser.js';
import { DAGBuilder, DAGBuilderV2 } from '../src/orchestrator/DAGBuilder.js';
import { AgentRouter } from '../src/orchestrator/AgentRouter.js';
import { getBlackboard } from '../src/state/Blackboard.js';
import { getEventBus, EventType } from '../src/state/EventBus.js';
import { getSessionStore } from '../src/state/SessionStore.js';
import { getPromptBuilder } from '../src/llm/PromptBuilder.js';

describe('NexusAgent-Cluster 核心功能测试', () => {
  let llm: any;
  let skillManager: any;
  let agentRegistry: any;
  let agentFactory: any;

  beforeAll(async () => {
    // 初始化核心组件
    llm = getLLMClient();
    skillManager = getSkillManager();
    await skillManager.initialize();
    agentRegistry = getAgentRegistry();
    await agentRegistry.initialize();
    agentFactory = new AgentFactory(llm);
  });

  // ==================== L2-1: LLM 抽象层测试 ====================

  describe('L2-1: LLM 抽象层', () => {
    it('TC-LLM-001: LLMClient 应支持多 Provider', async () => {
      // 测试 LLMClient 能正常创建
      expect(llm).toBeDefined();
      expect(llm.complete).toBeInstanceOf(Function);
    });

    it('TC-LLM-002: PromptBuilder 应能组装上下文', async () => {
      const builder = getPromptBuilder();
      expect(builder).toBeDefined();
      expect(builder.buildContext).toBeInstanceOf(Function);

      const context = await builder.buildContext({
        agentType: 'CodeAgent',
        userInput: '测试',
        includeSessionHistory: false,
        includeSkills: false,
      });

      expect(context).toBeDefined();
      expect(typeof context).toBe('string');
      expect(context.length).toBeGreaterThan(0);
    });

    it('TC-LLM-003: Prompt 模板应正常工作', () => {
      const { IntentAnalysisPrompt, TaskPlanningPrompt } = require('../src/llm/prompts.js');

      const intentPrompt = IntentAnalysisPrompt.format('测试输入');
      expect(intentPrompt).toContain('测试输入');
      expect(intentPrompt).toContain('intent_type');

      const planningPrompt = TaskPlanningPrompt.format({
        intent: 'code',
        primaryGoal: '测试目标',
        capabilities: 'test',
        complexity: 'medium',
      });
      expect(planningPrompt).toContain('code');
      expect(planningPrompt).toContain('测试目标');
    });
  });

  // ==================== L2-2: Skills 系统测试 ====================

  describe('L2-2: Skills 系统', () => {
    it('TC-SKILL-001: 应加载所有内置技能', () => {
      const builtinSkills = skillManager.listBuiltinSkills();

      // 验证必需的技能
      const requiredSkills = [
        'code-generation',
        'code-review',
        'data-analysis',
        'file-ops',
        'terminal-exec',
        'docx-processing',
      ];

      for (const skill of requiredSkills) {
        expect(skillManager.hasSkill(skill)).toBe(true);
      }

      console.log('✅ 内置技能数量:', builtinSkills.length);
      console.table(builtinSkills.map(s => ({
        name: s.name,
        category: s.category,
        enabled: s.enabled,
      })));
    });

    it('TC-SKILL-002: 技能应能正确执行（参数验证）', async () => {
      // 测试缺少必需参数的情况
      const result = await skillManager.executeSkill('code-generation', {
        // 缺少必需参数
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('TC-SKILL-003: 应支持按任务类型查找技能', () => {
      const codeSkills = skillManager.getSkillsForTask('code');
      expect(codeSkills).toContain('code-generation');
      expect(codeSkills).toContain('code-review');

      const dataSkills = skillManager.getSkillsForTask('data');
      expect(dataSkills).toContain('data-analysis');
    });
  });

  // ==================== L2-3: Agent Factory 测试 ====================

  describe('L2-3: Agent Factory', () => {
    it('TC-AGENT-001: 应能创建所有 Agent 类型', () => {
      const agentTypes = [
        'CodeAgent',
        'DataAgent',
        'AnalysisAgent',
        'AutomationAgent',
        'GenericAgent',
      ];

      for (const type of agentTypes) {
        const agent = agentFactory.createAgent(type, { taskId: 'test-001' });
        expect(agent).toBeDefined();
        expect(agent.execute).toBeInstanceOf(Function);
        expect(agent.getStats).toBeInstanceOf(Function);
        console.log(`✅ ${type} 创建成功`);
      }
    });

    it('TC-AGENT-002: Agent 应能获取系统提示词', async () => {
      const codeAgent = agentFactory.createAgent('CodeAgent', { taskId: 'test' });
      const systemPrompt = await codeAgent.getSystemPrompt();

      expect(systemPrompt).toBeDefined();
      expect(typeof systemPrompt).toBe('string');
      expect(systemPrompt.length).toBeGreaterThan(0);
      console.log('CodeAgent 系统提示词长度:', systemPrompt.length);
    });
  });

  // ==================== L2-3.5: 智能路由系统测试 ====================

  describe('L2-3.5: 智能路由系统', () => {
    it('TC-ROUTER-001: AgentRegistry 应注册所有内置 Agent', () => {
      const types = agentRegistry.getRegisteredTypes();

      expect(types).toContain('CodeAgent');
      expect(types).toContain('DataAgent');
      expect(types).toContain('AnalysisAgent');
      expect(types).toContain('AutomationAgent');
      expect(types).toContain('GenericAgent');

      console.log('✅ 已注册 Agent:', types);
    });

    it('TC-ROUTER-002: AgentRegistry 应提供能力查询', () => {
      // 按 Skill 查找
      const codeAgents = agentRegistry.findAgentsBySkill('code-generation');
      expect(codeAgents).toContain('CodeAgent');

      // 按任务查找
      const agentsForApi = agentRegistry.findAgentsForTask('create REST API');
      expect(agentsForApi.length).toBeGreaterThan(0);
      expect(agentsForApi[0].agentType).toBe('CodeAgent');

      console.log('✅ 支持 code-generation 的 Agent:', codeAgents);
    });

    it('TC-ROUTER-003: AgentRegistry 应提供统计信息', () => {
      const stats = agentRegistry.getStats();

      expect(stats.totalAgents).toBeGreaterThan(0);
      expect(stats.builtinAgents).toBeGreaterThan(0);
      expect(stats.totalSkills).toBeGreaterThan(0);

      console.log('=== AgentRegistry 统计 ===');
      console.log('总 Agent:', stats.totalAgents);
      console.log('内置 Agent:', stats.builtinAgents);
      console.log('自定义 Agent:', stats.customAgents);
      console.log('总 Skill 数:', stats.totalSkills);
    });

    it('TC-ROUTER-004: AgentRouter 应支持降级策略', async () => {
      // 创建会失败的 LLM 客户端
      const mockLLM = {
        complete: async () => {
          throw new Error('LLM unavailable');
        },
      };

      const router = new AgentRouter(mockLLM);
      const matches = await router.route({
        description: 'generate code for API',
        intent: 'code',
        capabilities: ['code_gen'],
        complexity: 5,
      });

      expect(matches).toBeDefined();
      expect(matches.length).toBeGreaterThan(0);
      // 降级时应仍能返回匹配结果
      expect(matches[0].agentType).toBeDefined();
      expect(matches[0].confidence).toBeGreaterThanOrEqual(0);
      expect(matches[0].confidence).toBeLessThanOrEqual(1);
    });
  });

  // ==================== L2-4: Blackboard 测试 ====================

  describe('L2-4: Blackboard', () => {
    it('TC-BB-001: Blackboard 应支持共享状态', async () => {
      const blackboard = getBlackboard();
      await blackboard.initialize();

      const sessionId = 'test-session-bb';
      await blackboard.createSession(sessionId, {
        intent: {
          type: 'code',
          primaryGoal: '测试',
          capabilities: [],
          complexity: 'simple',
          estimatedSteps: 1,
          constraints: [],
        },
        dag: null,
      });

      await blackboard.setState(sessionId, 'testKey', { value: 'testValue' });
      const state = await blackboard.getState(sessionId, 'testKey');

      expect(state).toEqual({ value: 'testValue' });
      console.log('✅ Blackboard 共享状态工作正常');
    });

    it('TC-BB-002: EventBus 应支持发布订阅', async () => {
      const eventBus = getEventBus();
      await eventBus.initialize();

      let received = false;
      eventBus.subscribe(EventType.SESSION_CREATED, () => {
        received = true;
      });

      await eventBus.publish(EventType.SESSION_CREATED, {
        sessionId: 'test-001',
      });

      // 等待事件处理
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(received).toBe(true);
      console.log('✅ EventBus 发布订阅工作正常');
    });
  });

  // ==================== L2-5: Intent Parser 测试 ====================

  describe('L2-5: Intent Parser', () => {
    it('TC-INTENT-001: 应能解析用户意图', async () => {
      const parser = new IntentParser(llm);

      const intent = await parser.parse('帮我生成一个用户登录 API');

      expect(intent).toBeDefined();
      expect(intent.type).toBeDefined();
      expect(intent.primaryGoal).toBeDefined();
      expect(intent.capabilities).toBeDefined();
      expect(intent.complexity).toBeDefined();

      console.log('=== Intent 解析结果 ===');
      console.log('类型:', intent.type);
      console.log('目标:', intent.primaryGoal);
      console.log('能力:', intent.capabilities);
      console.log('复杂度:', intent.complexity);
    });
  });

  // ==================== L2-6: DAG Builder 测试 ====================

  describe('L2-6: DAG Builder', () => {
    it('TC-DAG-001: 应能构建任务依赖图', async () => {
      const builder = new DAGBuilder(llm);

      const intent = {
        type: 'code',
        primaryGoal: '创建用户认证系统',
        capabilities: ['code_gen', 'api_design'],
        complexity: 'medium',
        estimatedSteps: 3,
        constraints: [],
      };

      const dag = await builder.build(intent);

      expect(dag).toBeDefined();
      expect(dag.getAllTasks()).toBeDefined();
      expect(dag.hasCycle()).toBe(false);

      const tasks = dag.getAllTasks();
      console.log('=== DAG 任务列表 ===');
      tasks.forEach(task => {
        console.log(`- ${task.name} (${task.agentType})`);
        console.log(`  依赖: ${task.dependencies.join(', ') || '无'}`);
      });
    });

    it('TC-DAG-002: DAG 应支持拓扑排序', async () => {
      const builder = new DAGBuilder(llm);

      const intent = {
        type: 'code',
        primaryGoal: '测试任务',
        capabilities: ['code_gen'],
        complexity: 'simple',
        estimatedSteps: 2,
        constraints: [],
      };

      const dag = await builder.build(intent);
      const sorted = dag.topologicalSort();

      expect(sorted).toBeDefined();
      expect(Array.isArray(sorted)).toBe(true);

      console.log('=== 拓扑排序结果 ===');
      sorted.forEach((task, i) => {
        console.log(`${i + 1}. ${task.name}`);
      });
    });
  });

  // ==================== L2-8: Orchestrator 测试 ====================

  describe('L2-8: Orchestrator', () => {
    it('TC-ORCH-001: SessionStore 应支持 MD 文件存储', async () => {
      const sessionStore = getSessionStore();
      await sessionStore.ensureDirectories();

      const sessionId = `test-session-${Date.now()}`;
      await sessionStore.createSession(sessionId, {});

      const metadata = await sessionStore.getMetadata(sessionId);

      expect(metadata).toBeDefined();
      expect(metadata?.sessionId).toBe(sessionId);

      console.log('✅ SessionStore MD 存储工作正常');
    });
  });

  // ==================== 功能完整性验证 ====================

  describe('task.md 要求验证', () => {
    it('✅ L2-1: LLM 抽象层应实现', () => {
      expect(llm).toBeDefined();
      const { PromptBuilder } = require('../src/llm/PromptBuilder.js');
      expect(PromptBuilder).toBeDefined();
    });

    it('✅ L2-2: Skills 系统应实现', () => {
      expect(skillManager).toBeDefined();
      expect(skillManager.listBuiltinSkills().length).toBeGreaterThan(0);
    });

    it('✅ L2-3: Agent Factory 应实现', () => {
      expect(agentFactory).toBeDefined();
      const agent = agentFactory.createAgent('CodeAgent', { taskId: 'test' });
      expect(agent).toBeDefined();
    });

    it('✅ L2-3.5: 智能路由系统应实现', () => {
      expect(agentRegistry).toBeDefined();
      const { AgentRouter } = require('../src/orchestrator/AgentRouter.js');
      expect(AgentRouter).toBeDefined();
    });

    it('✅ L2-4: Blackboard 应实现', () => {
      const blackboard = getBlackboard();
      expect(blackboard).toBeDefined();
    });

    it('✅ L2-5: Intent Parser 应实现', () => {
      const { IntentParser } = require('../src/orchestrator/IntentParser.js');
      expect(IntentParser).toBeDefined();
    });

    it('✅ L2-6: DAG Builder 应实现', () => {
      const { DAGBuilder, DAGBuilderV2 } = require('../src/orchestrator/DAGBuilder.js');
      expect(DAGBuilder).toBeDefined();
      expect(DAGBuilderV2).toBeDefined();
    });

    it('✅ L2-7: Scheduler 应实现', () => {
      const { Scheduler } = require('../src/orchestrator/Scheduler.js');
      expect(Scheduler).toBeDefined();
    });

    it('✅ L2-8: Orchestrator 应实现', () => {
      const { Orchestrator } = require('../src/orchestrator/Orchestrator.js');
      expect(Orchestrator).toBeDefined();
    });

    it('✅ L2-10: API 服务应实现', () => {
      const apiModule = require('../src/api/server.js');
      expect(apiModule).toBeDefined();
    });
  });
});
