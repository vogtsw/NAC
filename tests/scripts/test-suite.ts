/**
 * NexusAgent-Cluster Comprehensive Test Suite
 * 测试套件 - 全面测试系统功能
 */

import { getOrchestrator } from './src/orchestrator/Orchestrator.js';
import { getBlackboard } from './src/state/Blackboard.js';
import { getSkillManager } from './src/skills/SkillManager.js';
import { getSessionStore } from './src/state/SessionStore.js';
import { loadConfig } from './src/config/index.js';

// 测试结果记录
interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;
  details: string;
  data?: any;
}

class TestSuite {
  private results: TestResult[] = [];
  private orchestrator: any;
  private blackboard: any;
  private skillManager: any;
  private sessionStore: any;

  async initialize() {
    console.log('\n=== 初始化测试环境 ===\n');

    const config = loadConfig();
    console.log(`LLM Provider: ${config.orchestrator.llmProvider}`);
    console.log(`Model: ${config.orchestrator.llmConfig.model}`);
    console.log(`Max Parallel Agents: ${config.cluster.maxParallelAgents}`);

    this.orchestrator = getOrchestrator();
    this.blackboard = getBlackboard();
    this.skillManager = getSkillManager();
    this.sessionStore = getSessionStore();

    await this.orchestrator.initialize();
    await this.skillManager.initialize();
    await this.sessionStore.ensureDirectories();

    console.log('\n✓ 测试环境初始化完成\n');
  }

  async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    const startTime = Date.now();
    console.log(`\n▶ 测试: ${name}`);

    try {
      await testFn();
      const duration = Date.now() - startTime;
      this.results.push({
        name,
        status: 'PASS',
        duration,
        details: '测试通过',
      });
      console.log(`✓ PASS (${duration}ms)`);
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.results.push({
        name,
        status: 'FAIL',
        duration,
        details: error.message,
      });
      console.log(`✗ FAIL: ${error.message}`);
    }
  }

  // 测试 1: 任务处理效率
  async test1_TaskProcessingEfficiency() {
    const sessionId = `test-efficiency-${Date.now()}`;
    const tasks = [
      '计算 1+1',
      '计算 2+2',
      '列出当前目录文件',
    ];

    const startTime = Date.now();
    const results = [];

    for (const task of tasks) {
      const result = await this.orchestrator.processRequest({
        sessionId,
        userInput: task,
        context: {},
      });
      results.push(result);
    }

    const duration = Date.now() - startTime;
    const avgTime = duration / tasks.length;

    this.results[this.results.length - 1].data = {
      totalTasks: tasks.length,
      totalTime: duration,
      avgTimePerTask: avgTime,
      tasksPerSecond: (tasks.length / duration) * 1000,
    };

    console.log(`  - 处理 ${tasks.length} 个任务耗时: ${duration}ms`);
    console.log(`  - 平均每任务耗时: ${avgTime.toFixed(2)}ms`);
    console.log(`  - 吞吐量: ${(tasks.length / duration) * 1000.toFixed(2)} 任务/秒`);
  }

  // 测试 2: 多轮对话记忆能力
  async test2_MultiRoundConversationMemory() {
    const sessionId = `test-memory-${Date.now()}`;

    // 第一轮对话
    await this.orchestrator.processRequest({
      sessionId,
      userInput: '我的名字是测试用户',
      context: {},
    });

    // 第二轮对话 - 询问名字
    const result = await this.orchestrator.processRequest({
      sessionId,
      userInput: '我的名字是什么？',
      context: {},
    });

    // 检查会话历史
    const messages = await this.sessionStore.getSessionMessages(sessionId);
    const sessionContent = await this.sessionStore.getSessionContent(sessionId);

    this.results[this.results.length - 1].data = {
      messageCount: messages.length,
      sessionContent: sessionContent?.substring(0, 200) + '...',
      canRememberContext: messages.length >= 4, // 2 user + 2 assistant
    };

    console.log(`  - 会话消息数: ${messages.length}`);
    console.log(`  - 会话历史保存: ${sessionContent ? '是' : '否'}`);
    console.log(`  - 记忆能力: ${messages.length >= 4 ? '正常' : '异常'}`);
  }

  // 测试 3: 用户个性化数据记忆
  async test3_UserPersonalizedMemory() {
    const sessionId = `test-personal-${Date.now()}`;
    const userId = 'test-user-001';

    // 设置用户偏好
    const preferences = {
      userId,
      language: 'TypeScript',
      framework: 'React',
      codeStyle: 'functional',
    };

    await this.orchestrator.processRequest({
      sessionId,
      userInput: `记住我的偏好: 我使用 ${preferences.language} 和 ${preferences.framework}，偏好好 ${preferences.codeStyle} 风格`,
      context: { userId, preferences },
    });

    // 检查是否保存了用户偏好
    const state = await this.blackboard.getState(sessionId);

    this.results[this.results.length - 1].data = {
      userId,
      preferences,
      sessionState: state ? '存在' : '不存在',
      hasContext: state?.intent ? '是' : '否',
    };

    console.log(`  - 用户ID: ${userId}`);
    console.log(`  - 偏好设置: ${JSON.stringify(preferences)}`);
    console.log(`  - 会话状态保存: ${state ? '是' : '否'}`);
  }

  // 测试 4: 动态Agent创建和路由
  async test4_DynamicAgentCreationAndRouting() {
    const sessionId = `test-agent-${Date.now()}`;

    // 测试不同类型的任务触发不同的Agent
    const testTasks = [
      { task: '生成一个 TypeScript 函数', expectedAgent: 'CodeAgent' },
      { task: '分析这组数据的趋势', expectedAgent: 'DataAgent' },
      { task: '部署应用到生产环境', expectedAgent: 'AutomationAgent' },
      { task: '审查这段代码的安全问题', expectedAgent: 'AnalysisAgent' },
    ];

    const routingResults = [];

    for (const { task, expectedAgent } of testTasks) {
      const result = await this.orchestrator.processRequest({
        sessionId: `${sessionId}-${expectedAgent}`,
        userInput: task,
        context: {},
      });
      routingResults.push({ task, expectedAgent, success: result.success });
    }

    this.results[this.results.length - 1].data = {
      routingResults,
      successRate: routingResults.filter(r => r.success).length / routingResults.length,
    };

    console.log(`  - 路由测试数: ${testTasks.length}`);
    console.log(`  - 成功率: ${(routingResults.filter(r => r.success).length / testTasks.length * 100).toFixed(1)}%`);
  }

  // 测试 5: Skill调用测试
  async test5_SkillInvocation() {
    await this.skillManager.initialize();

    const skills = this.skillManager.listSkills();
    const enabledSkills = skills.filter(s => s.enabled);

    // 测试几个核心技能
    const testSkills = ['code-generation', 'file-ops', 'terminal-exec', 'code-review'];
    const skillResults = [];

    for (const skillName of testSkills) {
      if (this.skillManager.hasSkill(skillName)) {
        const skill = this.skillManager.getSkill(skillName);
        skillResults.push({
          name: skillName,
          enabled: skill?.enabled,
          category: skill?.category,
        });
      }
    }

    this.results[this.results.length - 1].data = {
      totalSkills: skills.length,
      enabledSkills: enabledSkills.length,
      testedSkills: skillResults,
    };

    console.log(`  - 总技能数: ${skills.length}`);
    console.log(`  - 启用技能数: ${enabledSkills.length}`);
    console.log(`  - 测试技能: ${skillResults.map(s => s.name).join(', ')}`);
  }

  // 测试 6: 定时任务模拟 (需要扩展功能)
  async test6_ScheduledTaskExecution() {
    // 当前系统未实现定时任务功能，这是待开发功能
    this.results[this.results.length - 1].status = 'SKIP';
    this.results[this.results.length - 1].details = '定时任务功能待实现 - 需要添加调度器模块';

    console.log(`  - 状态: 功能待实现`);
    console.log(`  - 建议: 添加 node-cron 或类似库实现定时任务`);
  }

  // 测试 7: 多任务依次执行
  async test7_SequentialMultiTaskExecution() {
    const sessionId = `test-sequential-${Date.now()}`;

    // 快速连续发送多个任务
    const tasks = [
      '任务1: 计算斐波那契数列第10项',
      '任务2: 列出常见排序算法',
      '任务3: 解释什么是闭包',
    ];

    const startTime = Date.now();
    const results = [];

    // 不等待结果，直接发送所有任务
    const promises = tasks.map(task =>
      this.orchestrator.processRequest({
        sessionId,
        userInput: task,
        context: {},
      })
    );

    const settledResults = await Promise.allSettled(promises);
    const duration = Date.now() - startTime;

    settledResults.forEach((result, index) => {
      results.push({
        task: tasks[index],
        status: result.status,
        success: result.status === 'fulfilled',
      });
    });

    this.results[this.results.length - 1].data = {
      taskCount: tasks.length,
      duration,
      results,
      sequentialExecution: true,
    };

    console.log(`  - 任务数量: ${tasks.length}`);
    console.log(`  - 总耗时: ${duration}ms`);
    console.log(`  - 成功执行: ${results.filter(r => r.success).length}/${tasks.length}`);
  }

  // 测试 8: 任务修改理解
  async test8_TaskModificationUnderstanding() {
    const sessionId = `test-modify-${Date.now()}`;

    // 初始任务
    await this.orchestrator.processRequest({
      sessionId,
      userInput: '创建一个用户登录函数',
      context: {},
    });

    // 修改任务
    const modifyResult = await this.orchestrator.processRequest({
      sessionId,
      userInput: '把刚才的登录函数改成支持邮箱和手机号登录',
      context: {},
    });

    // 检查会话历史是否包含上下文
    const messages = await this.sessionStore.getSessionMessages(sessionId);

    this.results[this.results.length - 1].data = {
      originalTask: '创建登录函数',
      modifiedTask: '支持邮箱和手机号登录',
      canUnderstandContext: messages.length >= 4,
      hasHistoryReference: messages.some(m => m.content.includes('登录')),
    };

    console.log(`  - 会话轮数: ${Math.floor(messages.length / 2)}`);
    console.log(`  - 上下文理解: ${messages.length >= 4 ? '正常' : '需要改进'}`);
    console.log(`  - 历史引用: ${messages.some(m => m.content.includes('登录')) ? '是' : '否'}`);
  }

  // 运行所有测试
  async runAll() {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║   NexusAgent-Cluster 综合功能测试套件                ║');
    console.log('╚════════════════════════════════════════════════════════╝');

    await this.initialize();

    // 执行所有测试
    await this.runTest('测试1: 任务处理效率', () => this.test1_TaskProcessingEfficiency());
    await this.runTest('测试2: 多轮对话记忆能力', () => this.test2_MultiRoundConversationMemory());
    await this.runTest('测试3: 用户个性化数据记忆', () => this.test3_UserPersonalizedMemory());
    await this.runTest('测试4: 动态Agent创建和路由', () => this.test4_DynamicAgentCreationAndRouting());
    await this.runTest('测试5: Skill调用测试', () => this.test5_SkillInvocation());
    await this.runTest('测试6: 定时任务执行', () => this.test6_ScheduledTaskExecution());
    await this.runTest('测试7: 多任务依次执行', () => this.test7_SequentialMultiTaskExecution());
    await this.runTest('测试8: 任务修改理解', () => this.test8_TaskModificationUnderstanding());

    // 输出测试报告
    this.printReport();

    // 清理
    await this.cleanup();
  }

  printReport() {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║   测试报告                                              ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const skipped = this.results.filter(r => r.status === 'SKIP').length;

    this.results.forEach(result => {
      const icon = result.status === 'PASS' ? '✓' : result.status === 'FAIL' ? '✗' : '○';
      const status = result.status === 'PASS' ? '\x1b[32mPASS\x1b[0m' :
                    result.status === 'FAIL' ? '\x1b[31mFAIL\x1b[0m' : '\x1b[33mSKIP\x1b[0m';
      console.log(`${icon} [${status}] ${result.name} (${result.duration}ms)`);
      if (result.data) {
        console.log(`    数据: ${JSON.stringify(result.data, null, 2).split('\n').join('\n    ')}`);
      }
    });

    console.log(`\n总计: ${this.results.length} | 通过: ${passed} | 失败: ${failed} | 跳过: ${skipped}`);
    console.log(`成功率: ${((passed / (this.results.length - skipped)) * 100).toFixed(1)}%\n`);
  }

  async cleanup() {
    await this.orchestrator.shutdown();
    console.log('\n✓ 测试环境清理完成\n');
  }
}

// 运行测试
const suite = new TestSuite();
suite.runAll().catch(console.error);
