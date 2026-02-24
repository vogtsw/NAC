/**
 * Integration Test
 * Test DeepSeek API and core functionality
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../src/llm/LLMClient.js';
import { IntentParser } from '../src/orchestrator/IntentParser.js';
import { DAGBuilder } from '../src/orchestrator/DAGBuilder.js';
import { SkillManager } from '../src/skills/SkillManager.js';
import { CodeGenerationSkill } from '../src/skills/builtin/CodeGenerationSkill.js';
import { Blackboard } from '../src/state/Blackboard.js';
import { loadConfig } from '../src/config/index.js';

// Test configuration
const TEST_CONFIG = {
  apiKey: process.env.DEEPSEEK_API_KEY || 'sk-b2233a9bb3da43e3b7a56a210220e6cc',
  baseURL: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
};

describe('DeepSeek Integration Tests', () => {
  let llmClient: LLMClient;
  let skillManager: SkillManager;
  let blackboard: Blackboard;

  beforeAll(async () => {
    llmClient = new LLMClient(TEST_CONFIG);
    skillManager = new SkillManager();
    blackboard = new Blackboard();

    try {
      await blackboard.initialize();
    } catch (error) {
      console.warn('Redis not available, some tests will be skipped');
    }
  });

  describe('LLMClient - DeepSeek API', () => {
    it('should complete a simple prompt', async () => {
      const response = await llmClient.complete('Say "Hello, World!" in Chinese', {
        temperature: 0.3,
        maxTokens: 100,
      });

      expect(response).toBeDefined();
      expect(typeof response).toBe('string');
      expect(response.length).toBeGreaterThan(0);
      console.log('Response:', response);
    });

    it('should complete with JSON format', async () => {
      const response = await llmClient.complete(
        'Return a JSON object with keys: name, age, city. Use Chinese values.',
        { responseFormat: 'json' }
      );

      expect(response).toBeDefined();
      const parsed = JSON.parse(response);
      expect(parsed).toHaveProperty('name');
      console.log('JSON Response:', parsed);
    });

    it('should execute streaming completion', async () => {
      const chunks: string[] = [];

      for await (const chunk of llmClient.streamComplete('Count to 5', { maxTokens: 50 })) {
        chunks.push(chunk);
      }

      const fullResponse = chunks.join('');
      expect(fullResponse).toBeDefined();
      expect(chunks.length).toBeGreaterThan(0);
      console.log('Streamed Response:', fullResponse);
    });

    it('should complete JSON response', async () => {
      const result = await llmClient.completeJSON<{ greeting: string }>(
        'Return JSON: {"greeting": "你好"}'
      );

      expect(result).toBeDefined();
      expect(result.greeting).toBe('你好');
      console.log('JSON Result:', result);
    });
  });

  describe('IntentParser', () => {
    it('should parse user intent', async () => {
      const parser = new IntentParser(llmClient);
      const intent = await parser.parse('创建一个用户登录的RESTful API接口');

      expect(intent).toBeDefined();
      expect(intent.type).toBeDefined();
      expect(intent.primaryGoal).toBeDefined();
      expect(intent.capabilities).toBeInstanceOf(Array);
      console.log('Parsed Intent:', intent);
    });

    it('should assess complexity', async () => {
      const parser = new IntentParser(llmClient);
      const intent = await parser.parse('写一个简单的Hello World程序');

      const complexity = parser.assessComplexity(intent);
      expect(complexity).toBeGreaterThanOrEqual(1);
      expect(complexity).toBeLessThanOrEqual(10);
      console.log('Complexity Score:', complexity);
    });
  });

  describe('DAGBuilder', () => {
    it('should build DAG from intent', async () => {
      const builder = new DAGBuilder(llmClient);
      const intent = await new IntentParser(llmClient).parse('创建一个简单的计算器应用');

      const dag = await builder.build(intent);

      expect(dag).toBeDefined();
      const tasks = dag.getAllTasks();
      expect(tasks.length).toBeGreaterThan(0);
      console.log('DAG Tasks:', tasks.map((t) => ({ id: t.id, name: t.name })));
    });
  });

  describe('SkillManager', () => {
    it('should list all skills', () => {
      const skills = skillManager.listSkills();

      expect(Array.isArray(skills)).toBe(true);
      expect(skills.length).toBeGreaterThan(0);
      console.log('Available Skills:', skills.map((s) => s.name));
    });

    it('should execute code generation skill', async () => {
      const result = await skillManager.executeSkill(
        'code-generation',
        {
          language: 'typescript',
          requirements: 'Create a function to add two numbers',
        }
      );

      expect(result).toBeDefined();
      console.log('Code Generation Result:', result);
    }, 30000);
  });

  describe('Blackboard', () => {
    it('should create session', async () => {
      const sessionId = `test-${Date.now()}`;
      const state = await blackboard.createSession(sessionId, {
        intent: { type: 'test' },
      });

      expect(state).toBeDefined();
      expect(state.sessionId).toBe(sessionId);
      console.log('Created Session:', { sessionId, status: state.status });
    });

    it('should get session state', async () => {
      const sessionId = `test-${Date.now()}`;
      await blackboard.createSession(sessionId);

      const state = await blackboard.getState(sessionId);
      expect(state).toBeDefined();
      expect(state!.sessionId).toBe(sessionId);
    });

    it('should update task status', async () => {
      const sessionId = `test-${Date.now()}`;
      await blackboard.createSession(sessionId);

      await blackboard.updateTaskStatus(sessionId, 'task-1', 'running');

      const state = await blackboard.getState(sessionId);
      expect(state!.tasks.has('task-1')).toBe(true);
      expect(state!.tasks.get('task-1')!.status).toBe('running');
    });

    it('should record task result', async () => {
      const sessionId = `test-${Date.now()}`;
      await blackboard.createSession(sessionId);

      await blackboard.recordTaskResult(sessionId, 'task-1', {
        output: 'test result',
      });

      const state = await blackboard.getState(sessionId);
      expect(state!.metrics.completedTasks).toBe(1);
    });
  });

  describe('End-to-End Flow', () => {
    it('should process a complete request', async () => {
      const { Orchestrator } = await import('../src/orchestrator/Orchestrator.js');

      const orchestrator = new Orchestrator({
        maxParallelAgents: 2,
      });

      await orchestrator.initialize();

      const sessionId = `e2e-${Date.now()}`;
      const result = await orchestrator.processRequest({
        sessionId,
        userInput: '分析"创建一个简单的计数器"这个任务',
      });

      expect(result).toBeDefined();
      console.log('E2E Result:', result);

      await orchestrator.shutdown();
    }, 60000);
  });
});
