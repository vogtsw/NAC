/**
 * 测试CLI聊天模式的关键功能
 * 模拟用户输入测试各种场景
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TEST_RESULTS: any[] = [];

/**
 * 运行单个测试用例
 */
async function runTestCase(testCase: {
  name: string;
  input: string;
  expectedAgent?: string;
  expectedSkills?: string[];
}) {
  console.log(`\n📝 测试用例: ${testCase.name}`);
  console.log(`输入: ${testCase.input.substring(0, 100)}...`);

  // 这里我们模拟测试，实际应该通过CLI交互
  // 由于无法直接交互式测试，我们记录测试用例
  TEST_RESULTS.push({
    ...testCase,
    status: 'pending',
    timestamp: new Date().toISOString(),
  });
}

/**
 * 执行所有测试用例
 */
async function executeTests() {
  console.log('🚀 开始执行测试用例...\n');

  // 1. 个人办公自动化测试
  await runTestCase({
    name: 'TC-OFF-001: 每日工作计划与任务管理',
    input: `我是一名全栈开发工程师，今天需要完成以下任务：
1. 修复用户登录页面的响应式布局问题（CSS）
2. 编写订单模块的单元测试（JavaScript/Jest）
3. 优化数据库查询性能（SQL索引优化）
4. 代码审查团队成员提交的PR
5. 更新项目文档（README.md）

请帮我：
1. 按优先级和依赖关系安排今天的任务执行顺序
2. 估算每个任务的时间
3. 识别哪些任务可以并行处理
4. 为每个任务提供具体的执行建议`,
    expectedAgent: 'AnalysisAgent',
    expectedSkills: ['data-analysis'],
  });

  await runTestCase({
    name: 'TC-OFF-003: 会议纪要自动整理',
    input: `请将以下会议记录整理为结构化的会议纪要：

会议记录（原始文本）：
"今天下午2点开了产品需求讨论会，参会的人有产品经理小李、技术负责人老王、设计师小陈、还有我。
主要讨论了下个版本的功能。小李说用户反馈现在的搜索功能不好用，想要加个智能搜索。
老王说技术上可以做到，但是需要两周时间开发。小陈提议说可以先用简单的关键词搜索，以后再优化。
最后决定先用关键词搜索，一周内上线。然后大家还讨论了用户界面的问题，小陈说下周能出设计稿。
我这边负责后端开发，小张负责前端。下周三之前要完成接口定义。会议大概开了1个半小时。"

请整理成以下格式：
1. 会议基本信息（时间、地点、参会人员）
2. 讨论议题
3. 决策事项
4. 行动项（负责人+截止日期）
5. 待讨论问题`,
    expectedAgent: 'AnalysisAgent',
    expectedSkills: ['data-analysis', 'docx-processing'],
  });

  // 2. 信息整理测试
  await runTestCase({
    name: 'TC-INFO-004: 笔记智能去重与合并',
    input: `我有以下学习笔记需要整理：

笔记1（markdown文件）：
# JavaScript 闭包

闭包是指有权访问另一个函数作用域中变量的函数。
闭包的用途：
1. 数据私有化
2. 柯里化
3. 模块模式

笔记2（markdown文件）：
# JS闭包详解

闭包（Closure）是JavaScript中的重要概念。
定义：函数可以访问其定义时的作用域，而不是调用时的作用域。

闭包的应用场景：
- 创建私有变量
- 函数柯里化
- 实现模块化
- 防抖和节流函数

笔记3（markdown文件）：
# 闭包的最佳实践

闭包使用注意事项：
1. 避免在循环中创建闭包
2. 及时释放不需要的闭包
3. 注意内存泄漏风险

请帮我：
1. 识别三个笔记中重复的内容
2. 合并为一个完整的学习笔记
3. 保留每个笔记的独特内容
4. 按逻辑重新组织结构`,
    expectedAgent: 'DataAgent',
    expectedSkills: ['data-analysis', 'file-ops'],
  });

  // 3. 数据分析测试
  await runTestCase({
    name: 'TC-DATA-001: 个人时间使用分析',
    input: `我记录了一周的时间日志，请帮我分析：

时间日志（CSV格式）：
日期,开始时间,结束时间,活动,类别
2024-03-01,09:00,10:30,代码开发,工作
2024-03-01,10:30,11:00,会议,工作
2024-03-01,11:00,12:00,邮件处理,工作
2024-03-01,12:00,13:00,午餐,休息
2024-03-01,13:00,14:30,代码开发,工作
2024-03-01,14:30,15:00,刷手机,分心
2024-03-01,15:00,16:30,代码开发,工作
2024-03-01,16:30,17:00,代码审查,工作
2024-03-01,17:00,18:00,学习新技术,学习

请帮我：
1. 统计各类活动的总时长和占比
2. 分析工作时间的分布（高效时段、低效时段）
3. 识别时间黑洞（哪些活动耗时过长）
4. 分析分心事件的频率和时长
5. 提供改进建议（如何优化时间分配）`,
    expectedAgent: 'DataAgent',
    expectedSkills: ['data-analysis'],
  });

  // 4. 多Agent协作测试
  await runTestCase({
    name: 'TC-MULTI-001: 复杂报告自动化生成',
    input: `我需要生成一份"项目月度总结报告"，需要多个步骤：

原始材料：
1. Git提交记录（git log）
2. Jira任务清单（CSV文件）
3. 代码质量报告（SonarQube导出）
4. 团队周报（多个Markdown文件）

请帮我完成以下任务流程：

步骤1（DataAgent）：
- 读取Git日志，统计提交次数、代码行数变化
- 读取Jira任务，统计完成任务数、新增任务数
- 读取质量报告，提取Bug数量、代码覆盖率
- 读取周报，提取关键成就和问题

步骤2（AnalysisAgent）：
- 分析进度是否符合预期（vs计划）
- 分析代码质量趋势（改善或下降）
- 识别主要风险和阻塞因素
- 提出下月重点改进方向

步骤3（CodeAgent + GenericAgent）：
- 生成Markdown格式的报告，包含：
  - 执行摘要
  - 进度统计（表格）
  - 质量指标（图表）
  - 团队贡献分析
  - 风险与问题
  - 下月计划
- 生成PPT大纲（用于汇报）

步骤4（AutomationAgent）：
- 将报告发送到指定邮箱
- 归档到文档目录
- 更新项目看板`,
    expectedAgent: 'Multi-Agent',
    expectedSkills: ['data-analysis', 'file-ops', 'code-generation', 'terminal-exec'],
  });

  // 5. Web搜索测试
  await runTestCase({
    name: 'TC-WEB-001: 行业动态自动追踪',
    input: `我想建立一个"前端技术动态追踪"系统：

需求：
1. 搜索以下关键词的最新信息：
   - "React 2024 新特性"
   - "Vue 3.4 更新"
   - "TypeScript 5.3"
   - "Vite 5.0"
   - "前端性能优化 2024"

2. 对于每个关键词：
   - 搜索最新文章（最近1周）
   - 提取标题、链接、发布时间、摘要
   - 评估信息质量（官方文档 vs 个人博客）

3. 整合为周报格式：
   - 按技术栈分类
   - 按重要性排序（大版本更新 > 新特性 > 文章）
   - 添加"值得关注"标签

4. 生成Markdown周报：
   - 本周重要更新
   - 推荐阅读文章（Top 5）
   - 学习建议

请执行一次完整的流程，生成示例周报`,
    expectedAgent: 'AutomationAgent',
    expectedSkills: ['web-search', 'data-analysis', 'docx-processing'],
  });

  // 保存测试结果
  const resultsPath = path.join(process.cwd(), 'tests/reports/test-execution-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(TEST_RESULTS, null, 2));

  console.log('\n✅ 测试用例已准备完成');
  console.log(`📊 测试用例数量: ${TEST_RESULTS.length}`);
  console.log(`💾 结果已保存到: ${resultsPath}`);
  console.log('\n📋 测试用例列表:');
  TEST_RESULTS.forEach((tc, index) => {
    console.log(`${index + 1}. ${tc.name}`);
  });

  console.log('\n⚠️ 注意：这些测试用例需要通过 `pnpm cli chat` 手动执行');
  console.log('每个测试用例都需要完整输入到聊天界面进行验证\n');
}

// 执行测试
executeTests().catch(console.error);
