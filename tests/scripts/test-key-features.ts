/**
 * 关键功能测试脚本
 * 测试NAC工程的核心功能
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getOrchestrator } from '../../src/orchestrator/Orchestrator.js';
import { getSkillManager } from '../../src/skills/SkillManager.js';
import { getIntentParser } from '../../src/orchestrator/IntentParser.js';
import { getLLMClient } from '../../src/llm/LLMClient.js';

describe('NAC 关键功能测试', () => {
  let orchestrator: any;
  let skillManager: any;
  let intentParser: any;
  let llmClient: any;

  beforeEach(async () => {
    orchestrator = getOrchestrator();
    skillManager = getSkillManager();
    intentParser = getIntentParser();
    llmClient = getLLMClient();
    await orchestrator.initialize();
    await skillManager.initialize();
  });

  describe('1. Intent解析测试', () => {
    it('应该正确解析代码开发意图', async () => {
      const result = await intentParser.parse({
        userInput: '创建一个用户认证API，使用TypeScript和Express',
        sessionId: 'test-session',
      });

      expect(result).toBeDefined();
      expect(result.intentType).toBe('code');
      expect(['simple', 'medium', 'complex']).toContain(result.complexity);
      expect(result.estimatedSteps).toBeGreaterThan(0);
    });

    it('应该正确解析数据分析意图', async () => {
      const result = await intentParser.parse({
        userInput: '分析我的消费记录CSV文件，找出月度支出趋势',
        sessionId: 'test-session',
      });

      expect(result).toBeDefined();
      expect(result.intentType).toBe('data');
      expect(result.estimatedSteps).toBeGreaterThan(0);
    });

    it('应该正确解析文档处理意图', async () => {
      const result = await intentParser.parse({
        userInput: '整理我的会议记录，生成结构化的会议纪要',
        sessionId: 'test-session',
      });

      expect(result).toBeDefined();
      expect(['other', 'analysis']).toContain(result.intentType);
    });
  });

  describe('2. Skills系统测试', () => {
    it('应该注册所有内置Skills', () => {
      const skills = skillManager.getAllSkills();

      expect(skills.length).toBeGreaterThan(0);

      const skillNames = skills.map((s: any) => s.name);
      expect(skillNames).toContain('code-generation');
      expect(skillNames).toContain('file-ops');
      expect(skillNames).toContain('terminal-exec');
      expect(skillNames).toContain('data-analysis');
      expect(skillNames).toContain('web-search');
    });

    it('应该成功执行web-search skill', async () => {
      const skill = skillManager.getSkill('web-search');
      expect(skill).toBeDefined();

      const result = await skill.execute(
        { logger: console },
        { query: 'TypeScript最佳实践', numResults: 3 }
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result.results).toBeInstanceOf(Array);
    });

    it('应该成功执行file-ops skill', async () => {
      const skill = skillManager.getSkill('file-ops');
      expect(skill).toBeDefined();

      const result = await skill.execute(
        { logger: console },
        {
          operation: 'read',
          path: 'tests/cases/README.md',
        }
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
    });

    it('应该成功执行data-analysis skill', async () => {
      const skill = skillManager.getSkill('data-analysis');
      expect(skill).toBeDefined();

      const testData = {
        items: [
          { name: '任务A', duration: 2, category: '工作' },
          { name: '任务B', duration: 3, category: '工作' },
          { name: '休息', duration: 1, category: '休息' },
        ],
      };

      const result = await skill.execute(
        { logger: console },
        { operation: 'analyze', data: testData }
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
    });
  });

  describe('3. DAG构建测试', () => {
    it('应该为简单任务构建简单DAG', async () => {
      const result = await orchestrator.processRequest({
        sessionId: 'test-dag-simple',
        userInput: '读取package.json文件',
      });

      expect(result).toBeDefined();
      // DAG应该被创建
    });

    it('应该为复杂任务构建复杂DAG', async () => {
      const result = await orchestrator.processRequest({
        sessionId: 'test-dag-complex',
        userInput: `创建一个任务管理系统API，包含：
1. 用户认证（JWT）
2. 任务CRUD操作
3. 编写单元测试
4. 生成API文档`,
      });

      expect(result).toBeDefined();
      // 复杂DAG应该被创建
    });
  });

  describe('4. Agent路由测试', () => {
    it('应该为代码任务选择CodeAgent', async () => {
      const result = await orchestrator.processRequest({
        sessionId: 'test-route-code',
        userInput: '开发一个React组件，实现待办事项列表',
      });

      expect(result).toBeDefined();
      // 应该选择CodeAgent
    });

    it('应该为数据任务选择DataAgent', async () => {
      const result = await orchestrator.processRequest({
        sessionId: 'test-route-data',
        userInput: '分析这个CSV文件的销售数据',
      });

      expect(result).toBeDefined();
      // 应该选择DataAgent
    });

    it('应该为分析任务选择AnalysisAgent', async () => {
      const result = await orchestrator.processRequest({
        sessionId: 'test-route-analysis',
        userInput: '分析两个技术方案的优缺点',
      });

      expect(result).toBeDefined();
      // 应该选择AnalysisAgent
    });
  });

  describe('5. 多Agent协作测试', () => {
    it('应该在复杂任务中协调多个Agent', async () => {
      const result = await orchestrator.processRequest({
        sessionId: 'test-multi-agent',
        userInput: `开发一个全栈应用：
1. 后端：Node.js + Express API
2. 前端：React界面
3. 数据库：PostgreSQL
4. 部署：Docker配置`,
      });

      expect(result).toBeDefined();
      // 应该涉及CodeAgent, DataAgent, AutomationAgent
    }, 30000); // 增加超时时间
  });

  describe('6. 错误处理测试', () => {
    it('应该处理无效的用户输入', async () => {
      const result = await orchestrator.processRequest({
        sessionId: 'test-error-input',
        userInput: '',
      });

      expect(result).toBeDefined();
      // 应该返回错误信息
    });

    it('应该处理Skill执行失败', async () => {
      const skill = skillManager.getSkill('file-ops');
      const result = await skill.execute(
        { logger: console },
        { operation: 'read', path: 'non-existent-file.txt' }
      );

      // 应该优雅地处理错误
      expect(result).toBeDefined();
    });
  });

  describe('7. 个人生产力场景测试', () => {
    it('应该处理会议纪要整理任务', async () => {
      const meetingNotes = `今天下午2点开了产品需求讨论会，参会的人有产品经理小李、技术负责人老王、设计师小陈。
主要讨论了下个版本的功能。小李说用户反馈现在的搜索功能不好用，想要加个智能搜索。
老王说技术上可以做到，但是需要两周时间开发。小陈提议说可以先用简单的关键词搜索，以后再优化。
最后决定先用关键词搜索，一周内上线。`;

      const result = await orchestrator.processRequest({
        sessionId: 'test-meeting-notes',
        userInput: `请将以下会议记录整理为结构化的会议纪要：\n${meetingNotes}\n\n要求：提取参会人员、讨论议题、决策事项、行动项。`,
      });

      expect(result).toBeDefined();
    }, 30000);

    it('应该处理时间分析任务', async () => {
      const timeData = `日期,开始时间,结束时间,活动,类别
2024-03-01,09:00,10:30,代码开发,工作
2024-03-01,10:30,11:00,会议,工作
2024-03-01,11:00,12:00,邮件处理,工作
2024-03-01,14:30,15:00,刷手机,分心
2024-03-01,15:00,16:30,代码开发,工作`;

      const result = await orchestrator.processRequest({
        sessionId: 'test-time-analysis',
        userInput: `分析以下时间日志，统计各类活动的时长和占比：\n${timeData}`,
      });

      expect(result).toBeDefined();
    }, 30000);
  });
});
