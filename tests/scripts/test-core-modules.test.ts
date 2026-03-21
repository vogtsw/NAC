/**
 * 核心模块功能测试
 * 验证NAC工程的各个核心组件是否正常工作
 */

import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../../src/orchestrator/Orchestrator.js';
import { getAgentRegistry } from '../../src/orchestrator/AgentRegistry.js';
import { getSkillManager } from '../../src/skills/SkillManager.js';
import { getBlackboard } from '../../src/state/Blackboard.js';
import { IntentParser } from '../../src/orchestrator/IntentParser.js';
import { DAGBuilder } from '../../src/orchestrator/DAGBuilder.js';
import { AgentFactory } from '../../src/agents/AgentFactory.js';
import { getCodeAgent, getDataAgent, getAutomationAgent, getAnalysisAgent, getGenericAgent } from '../../src/agents/index.js';

describe('NAC核心模块测试', () => {
  describe('Agent系统', () => {
    it('应该能够创建CodeAgent', () => {
      const agent = getCodeAgent();
      expect(agent).toBeDefined();
      expect(agent.name).toBe('CodeAgent');
    });

    it('应该能够创建DataAgent', () => {
      const agent = getDataAgent();
      expect(agent).toBeDefined();
      expect(agent.name).toBe('DataAgent');
    });

    it('应该能够创建AutomationAgent', () => {
      const agent = getAutomationAgent();
      expect(agent).toBeDefined();
      expect(agent.name).toBe('AutomationAgent');
    });

    it('应该能够创建AnalysisAgent', () => {
      const agent = getAnalysisAgent();
      expect(agent).toBeDefined();
      expect(agent.name).toBe('AnalysisAgent');
    });

    it('应该能够创建GenericAgent', () => {
      const agent = getGenericAgent();
      expect(agent).toBeDefined();
      expect(agent.name).toBe('GenericAgent');
    });
  });

  describe('Orchestrator系统', () => {
    it('应该能够创建Orchestrator实例', async () => {
      const orchestrator = new Orchestrator();
      expect(orchestrator).toBeDefined();
      await orchestrator.initialize();
      expect(orchestrator).toBeInstanceOf(Orchestrator);
    });

    it('应该能够初始化Orchestrator', async () => {
      const orchestrator = new Orchestrator();
      await orchestrator.initialize();
      expect(orchestrator).toBeDefined();
    });
  });

  describe('AgentRegistry系统', () => {
    it('应该能够获取AgentRegistry实例', () => {
      const registry = getAgentRegistry();
      expect(registry).toBeDefined();
    });

    it('应该能够注册和查询Agent', () => {
      const registry = getAgentRegistry();
      const agents = registry.listAgents();
      expect(Array.isArray(agents)).toBe(true);
      expect(agents.length).toBeGreaterThan(0);
    });
  });

  describe('SkillManager系统', () => {
    it('应该能够获取SkillManager实例', async () => {
      const skillManager = getSkillManager();
      expect(skillManager).toBeDefined();
      await skillManager.initialize();
    });

    it('应该能够列出所有已注册的Skills', async () => {
      const skillManager = getSkillManager();
      await skillManager.initialize();
      const skills = skillManager.listSkills();
      expect(Array.isArray(skills)).toBe(true);
      expect(skills.length).toBeGreaterThan(0);
    });
  });

  describe('Blackboard系统', () => {
    it('应该能够获取Blackboard实例', async () => {
      const blackboard = getBlackboard();
      expect(blackboard).toBeDefined();
      await blackboard.initialize();
    });

    it('应该能够读写共享状态', async () => {
      const blackboard = getBlackboard();
      await blackboard.initialize();

      const testKey = 'test_key';
      const testValue = { test: 'data' };

      await blackboard.set(testKey, testValue);
      const retrieved = await blackboard.get(testKey);
      expect(retrieved).toEqual(testValue);
    });
  });

  describe('IntentParser系统', () => {
    it('应该能够创建IntentParser实例', () => {
      const intentParser = new IntentParser(undefined);
      expect(intentParser).toBeDefined();
    });
  });

  describe('DAGBuilder系统', () => {
    it('应该能够创建DAGBuilder实例', () => {
      const dagBuilder = new DAGBuilder(undefined);
      expect(dagBuilder).toBeDefined();
    });
  });

  describe('AgentFactory系统', () => {
    it('应该能够创建AgentFactory实例', () => {
      const factory = new AgentFactory(undefined);
      expect(factory).toBeDefined();
    });
  });
});
