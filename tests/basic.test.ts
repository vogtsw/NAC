/**
 * Basic Tests
 * Verify core functionality
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../src/llm/LLMClient.js';
import { IntentParser } from '../src/orchestrator/IntentParser.js';
import { DAGBuilder, DAG } from '../src/orchestrator/DAGBuilder.js';
import { SkillManager } from '../src/skills/SkillManager.js';
import { CodeGenerationSkill } from '../src/skills/builtin/CodeGenerationSkill.js';

describe('LLMClient', () => {
  it('should create LLM client', () => {
    const client = new LLMClient({
      apiKey: 'test-key',
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    });
    expect(client).toBeDefined();
  });
});

describe('IntentParser', () => {
  it('should create intent parser', () => {
    const mockLLM = {
      complete: async (prompt: string, options?: any) => {
        return JSON.stringify({
          intent_type: 'code',
          primary_goal: 'Test goal',
          required_capabilities: ['code_gen'],
          complexity: 'simple',
          estimated_steps: 1,
          constraints: [],
        });
      },
    };

    const parser = new IntentParser(mockLLM as any);
    expect(parser).toBeDefined();
  });

  it('should parse intent', async () => {
    const mockLLM = {
      complete: async (prompt: string, options?: any) => {
        return JSON.stringify({
          intent_type: 'code',
          primary_goal: '创建一个API',
          required_capabilities: ['code_gen', 'api_design'],
          complexity: 'medium',
          estimated_steps: 3,
          constraints: ['需要文档'],
        });
      },
    };

    const parser = new IntentParser(mockLLM as any);
    const intent = await parser.parse('创建一个RESTful API');

    expect(intent.type).toBe('code');
    expect(intent.primaryGoal).toBe('创建一个API');
    expect(intent.capabilities).toContain('code_gen');
  });
});

describe('DAG', () => {
  it('should create empty DAG', () => {
    const dag = new DAG();
    expect(dag.isComplete()).toBe(true);
    expect(dag.getReadyTasks().length).toBe(0);
  });

  it('should add tasks to DAG', () => {
    const dag = new DAG();
    dag.addTask({
      id: 'task-1',
      name: 'First task',
      description: 'Test task',
      agentType: 'CodeAgent',
      requiredSkills: [],
      dependencies: [],
      estimatedDuration: 100,
    });

    expect(dag.isComplete()).toBe(false);
    expect(dag.getReadyTasks().length).toBe(1);
  });

  it('should handle task dependencies', () => {
    const dag = new DAG();

    dag.addTask({
      id: 'task-1',
      name: 'First',
      description: 'First task',
      agentType: 'CodeAgent',
      requiredSkills: [],
      dependencies: [],
      estimatedDuration: 100,
    });

    dag.addTask({
      id: 'task-2',
      name: 'Second',
      description: 'Second task',
      agentType: 'CodeAgent',
      requiredSkills: [],
      dependencies: ['task-1'],
      estimatedDuration: 100,
    });

    // Only first task should be ready
    expect(dag.getReadyTasks().length).toBe(1);
    expect(dag.getReadyTasks()[0].id).toBe('task-1');

    // Mark first as complete
    dag.markTaskComplete('task-1');

    // Now second should be ready
    expect(dag.getReadyTasks().length).toBe(1);
    expect(dag.getReadyTasks()[0].id).toBe('task-2');
  });

  it('should detect circular dependencies', () => {
    const dag = new DAG();

    dag.addTask({
      id: 'task-1',
      name: 'First',
      description: 'First task',
      agentType: 'CodeAgent',
      requiredSkills: [],
      dependencies: ['task-2'],
      estimatedDuration: 100,
    });

    dag.addTask({
      id: 'task-2',
      name: 'Second',
      description: 'Second task',
      agentType: 'CodeAgent',
      requiredSkills: [],
      dependencies: ['task-1'],
      estimatedDuration: 100,
    });

    expect(dag.hasCycle()).toBe(true);
  });
});

describe('SkillManager', () => {
  it('should create skill manager', () => {
    const manager = new SkillManager();
    expect(manager).toBeDefined();
  });

  it('should register skill', () => {
    const manager = new SkillManager();
    manager.register(CodeGenerationSkill);

    const skill = manager.getSkill('code-generation');
    expect(skill).toBeDefined();
    expect(skill!.name).toBe('code-generation');
  });

  it('should list skills', async () => {
    const manager = new SkillManager();
    await manager.initialize();

    const skills = manager.listSkills();

    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThan(0);
  });
});

describe('CodeGenerationSkill', () => {
  it('should validate parameters', () => {
    expect(CodeGenerationSkill.validate({ language: 'ts', requirements: 'test' })).toBe(true);
    expect(CodeGenerationSkill.validate({ language: 'ts' })).toBe(false);
    expect(CodeGenerationSkill.validate({ requirements: 'test' })).toBe(false);
  });
});
