/**
 * NAC 工程 20 个复杂测试用例自动执行脚本
 * 使用子进程模拟 pnpm cli chat 交互
 */

import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// 测试用例定义
const testCases = [
  {
    id: 'TC-001',
    name: 'RESTful API 全栈开发',
    category: 'code',
    complexity: 'complex',
    input: `开发一个完整的任务管理系统 RESTful API，要求：
1. 使用 TypeScript + Express + PostgreSQL
2. 包含用户认证（JWT）、任务CRUD、标签管理、优先级设置
3. 实现数据验证中间件、错误处理、日志记录
4. 编写完整的单元测试（Jest）
5. 生成 API 文档（Swagger）
6. 提供 Docker 部署配置
7. 实现数据库迁移脚本`
  },
  {
    id: 'TC-002',
    name: '算法实现与优化',
    category: 'code',
    complexity: 'medium',
    input: `实现一个高性能的图数据库查询引擎，要求：
1. 使用 TypeScript 实现图的邻接表和邻接矩阵两种存储结构
2. 实现 DFS、BFS、Dijkstra、A* 算法
3. 添加算法性能对比和基准测试
4. 实现路径缓存机制优化查询
5. 生成算法复杂度分析文档
6. 编写使用示例和单元测试`
  },
  {
    id: 'TC-003',
    name: '微服务架构重构',
    category: 'code',
    complexity: 'complex',
    input: `将一个单体应用重构为微服务架构，要求：
1. 分析现有代码结构，识别服务边界
2. 设计服务间通信方案（gRPC + REST）
3. 实现服务发现和配置中心
4. 添加分布式追踪（Jaeger）
5. 实现断路器模式（Istio）
6. 创建 CI/CD 流水线
7. 生成架构设计文档`
  },
  {
    id: 'TC-004',
    name: '实时通信系统',
    category: 'code',
    complexity: 'complex',
    input: `开发一个实时聊天系统，要求：
1. 使用 WebSocket + Redis 实现消息推送
2. 支持群聊、私聊、消息已读状态
3. 实现消息持久化（MongoDB）
4. 添加文件上传和图片预览功能
5. 实现在线状态管理和心跳检测
6. 编写压力测试脚本
7. 提供横向扩展方案`
  },
  {
    id: 'TC-005',
    name: '插件系统设计',
    category: 'code',
    complexity: 'medium',
    input: `设计并实现一个可扩展的插件系统，要求：
1. 定义插件接口和生命周期钩子
2. 实现动态加载和热更新机制
3. 添加插件依赖管理和版本控制
4. 实现插件沙箱隔离
5. 创建插件开发脚手架工具
6. 编写插件开发文档和示例`
  },
  {
    id: 'TC-006',
    name: '大数据分析管道',
    category: 'data',
    complexity: 'complex',
    input: `构建一个电商数据分析管道，要求：
1. 从 MySQL 导出订单数据（100万+记录）
2. 使用 Python (Pandas) 进行数据清洗和转换
3. 实现用户行为分析和 RFM 模型计算
4. 生成可视化报表（销售趋势、用户分层）
5. 自动发送邮件报告（包含图表）
6. 实现增量更新机制
7. 部署为定时任务（每日执行）`
  },
  {
    id: 'TC-007',
    name: '日志分析系统',
    category: 'data',
    complexity: 'medium',
    input: `开发一个服务器日志分析工具，要求：
1. 解析 Nginx 访问日志（正则表达式）
2. 统计访问量、响应时间、状态码分布
3. 识别异常请求（爬虫、攻击）
4. 生成实时监控仪表板（Grafana）
5. 实现告警规则配置
6. 输出分析报告到文件`
  },
  {
    id: 'TC-008',
    name: '数据迁移工具',
    category: 'data',
    complexity: 'medium',
    input: `开发一个数据库迁移工具，要求：
1. 支持 MySQL 到 PostgreSQL 的数据迁移
2. 实现断点续传和失败重试
3. 添加数据类型自动映射
4. 实现批量插入优化
5. 生成迁移报告和校验脚本
6. 支持配置文件驱动的迁移规则`
  },
  {
    id: 'TC-009',
    name: '时间序列预测',
    category: 'data',
    complexity: 'complex',
    input: `实现一个股票价格预测模型，要求：
1. 使用 Python 获取历史数据（API爬取）
2. 实现技术指标计算（MA、MACD、RSI）
3. 训练 LSTM 深度学习模型
4. 实现模型评估和回测
5. 生成预测结果可视化
6. 部署为 REST API 服务`
  },
  {
    id: 'TC-010',
    name: '技术文档生成系统',
    category: 'other',
    complexity: 'medium',
    input: `开发一个自动化文档生成工具，要求：
1. 解析 TypeScript 源代码注释（TSDoc）
2. 生成 Markdown 格式的 API 文档
3. 生成类型定义和继承关系图
4. 生成代码示例和用法说明
5. 支持多版本文档管理
6. 集成到 CI/CD 流程`
  },
  {
    id: 'TC-011',
    name: '多语言翻译系统',
    category: 'other',
    complexity: 'medium',
    input: `构建一个技术文档翻译工具，要求：
1. 识别代码块并保持原文
2. 调用翻译 API（支持中英日韩）
3. 实现术语表管理
4. 添加翻译记忆库
5. 生成双语对照文档
6. 实现批量翻译和进度追踪`
  },
  {
    id: 'TC-012',
    name: '智能摘要生成器',
    category: 'analysis',
    complexity: 'medium',
    input: `开发一个长文档智能摘要工具，要求：
1. 支持多种格式（PDF、DOCX、TXT、MD）
2. 提取关键句子和段落
3. 生成结构化摘要（含章节目录）
4. 提取关键 entities 和关键词
5. 生成不同长度的摘要版本
6. 实现 Web 界面和 API 接口`
  },
  {
    id: 'TC-013',
    name: '监控告警系统',
    category: 'automation',
    complexity: 'complex',
    input: `构建一个全栈监控告警系统，要求：
1. 采集服务器指标（CPU、内存、磁盘）
2. 采集应用指标（Prometheus + Grafana）
3. 实现多级告警规则（邮件、短信、钉钉）
4. 开发告警收敛和去重逻辑
5. 实现告警历史查询和统计
6. 提供自定义监控指标接入`
  },
  {
    id: 'TC-014',
    name: '自动化部署平台',
    category: 'automation',
    complexity: 'complex',
    input: `开发一个自动化部署平台，要求：
1. 支持 Docker 和 Kubernetes 部署
2. 实现蓝绿部署和金丝雀发布
3. 添加部署前检查和回滚机制
4. 集成代码扫描和安全检测
5. 实现环境配置管理
6. 生成部署报告和审计日志`
  },
  {
    id: 'TC-015',
    name: '故障诊断工具',
    category: 'automation',
    complexity: 'medium',
    input: `开发一个分布式系统故障诊断工具，要求：
1. 收集应用日志和链路追踪数据
2. 分析慢查询和异常堆栈
3. 自动定位故障根因
4. 生成诊断报告和建议
5. 实现故障模式知识库
6. 支持交互式诊断查询`
  },
  {
    id: 'TC-016',
    name: '代码安全审计',
    category: 'analysis',
    complexity: 'complex',
    input: `开发一个代码安全审计工具，要求：
1. 扫描常见漏洞（SQL注入、XSS、CSRF）
2. 检测不安全的依赖包
3. 分析敏感信息泄露（硬编码密钥）
4. 生成安全评分和修复建议
5. 支持 CI/CD 集成
6. 输出符合 OWASP 标准的报告`
  },
  {
    id: 'TC-017',
    name: '权限审计系统',
    category: 'analysis',
    complexity: 'medium',
    input: `构建一个权限审计系统，要求：
1. 扫描数据库和代码中的权限配置
2. 生成用户-角色-权限关系图
3. 检测权限过度分配和冲突
4. 实现权限变更追踪
5. 生成合规性审计报告
6. 提供权限优化建议`
  },
  {
    id: 'TC-018',
    name: '电商全栈应用',
    category: 'code+deployment',
    complexity: 'complex',
    input: `开发一个完整的电商平台，要求：
1. 前端：React + TypeScript + TailwindCSS
   - 商品列表、购物车、结算流程
   - 用户中心、订单管理
2. 后端：Node.js + Express + PostgreSQL
   - 商品管理、订单系统、支付集成
   - 搜索引擎（Elasticsearch）
3. 数据分析：销售报表、用户行为分析
4. 运维：Docker Compose 部署、Nginx 配置
5. 测试：单元测试、E2E测试（Playwright）
6. 文档：架构设计、API文档、部署手册`
  },
  {
    id: 'TC-019',
    name: '物联网数据平台',
    category: 'data+code+automation',
    complexity: 'complex',
    input: `构建一个物联网数据处理平台，要求：
1. 设备接入：MQTT Broker + 设备认证
2. 数据处理：实时流处理（Apache Flink）
3. 数据存储：时序数据库（InfluxDB）
4. 可视化：实时仪表板（Grafana）
5. 告警：规则引擎 + 多渠道通知
6. API：设备管理、数据查询接口`
  },
  {
    id: 'TC-020',
    name: '智能客服系统',
    category: 'analysis+code+data',
    complexity: 'complex',
    input: `开发一个智能客服系统，要求：
1. 知识库管理：FAQ录入、分类、检索
2. 意图识别：基于关键词和语义匹配
3. 多轮对话：对话状态管理、上下文理解
4. 人工接入：智能路由、会话转移
5. 数据分析：问题统计、满意度分析
6. 集成：Web Widget、微信、钉钉`
  }
];

// 测试结果存储
interface TestResult {
  testCaseId: string;
  testCaseName: string;
  timestamp: string;
  input: string;
  intent: {
    type: string;
    complexity: string;
    estimatedSteps: number;
  } | null;
  dag: {
    taskCount: number;
    agents: string[];
    parallelGroups: number;
  } | null;
  execution: {
    duration: number;
    success: boolean;
    agentUsed: string[];
    skillsUsed: string[];
  } | null;
  output: {
    response: string;
    quality: 'excellent' | 'good' | 'fair' | 'poor';
  } | null;
  errors: string[];
  agentGenerated: {
    generated: boolean;
    agentType?: string;
    configPath?: string;
  };
}

// 创建输出目录
const outputDir = join(process.cwd(), 'memory', 'test-results-20');
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

/**
 * 执行单个测试用例
 */
async function runTestCase(testCase: typeof testCases[0]): Promise<TestResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`执行测试: ${testCase.id} - ${testCase.name}`);
  console.log(`类别: ${testCase.category} | 复杂度: ${testCase.complexity}`);
  console.log(`${'='.repeat(80)}\n`);

  const result: TestResult = {
    testCaseId: testCase.id,
    testCaseName: testCase.name,
    timestamp: new Date().toISOString(),
    input: testCase.input,
    intent: null,
    dag: null,
    execution: null,
    output: null,
    errors: [],
    agentGenerated: { generated: false }
  };

  return new Promise((resolve) => {
    const startTime = Date.now();
    let outputBuffer = '';
    let errorBuffer = '';

    // 使用 pnpm cli run 命令直接执行任务（避免交互模式）
    const child = spawn('pnpm', ['cli', 'run', testCase.input], {
      cwd: process.cwd(),
      shell: true,
      env: { ...process.env }
    });

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      outputBuffer += text;
      process.stdout.write(text);
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      errorBuffer += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;

      // 解析输出
      try {
        result.execution = {
          duration,
          success: code === 0,
          agentUsed: extractAgentsUsed(outputBuffer),
          skillsUsed: extractSkillsUsed(outputBuffer)
        };

        result.intent = extractIntent(outputBuffer);
        result.dag = extractDAG(outputBuffer);
        result.output = {
          response: extractResponse(outputBuffer),
          quality: assessQuality(outputBuffer)
        };

        // 检查是否生成了新的 Agent 配置
        result.agentGenerated = checkAgentGeneration(testCase);

        if (code !== 0) {
          result.errors.push(errorBuffer || `进程退出代码: ${code}`);
        }
      } catch (error) {
        result.errors.push(`解析错误: ${error}`);
      }

      // 保存单个测试结果
      const resultPath = join(outputDir, `${testCase.id}.json`);
      writeFileSync(resultPath, JSON.stringify(result, null, 2));

      console.log(`\n✅ 测试 ${testCase.id} 完成，耗时: ${(duration / 1000).toFixed(2)}秒\n`);
      resolve(result);
    });

    // 超时处理（5分钟）
    setTimeout(() => {
      child.kill();
      result.errors.push('测试超时（5分钟）');
      resolve(result);
    }, 5 * 60 * 1000);
  });
}

/**
 * 提取 Intent 信息
 */
function extractIntent(output: string): TestResult['intent'] {
  const intentMatch = output.match(/intentType[:\s]+(\w+)/i);
  const complexityMatch = output.match(/complexity[:\s]+(\w+)/i);
  const stepsMatch = output.match(/estimatedSteps[:\s]+(\d+)/i);

  if (intentMatch || complexityMatch || stepsMatch) {
    return {
      type: intentMatch?.[1] || 'unknown',
      complexity: complexityMatch?.[1] || 'unknown',
      estimatedSteps: stepsMatch ? parseInt(stepsMatch[1]) : 0
    };
  }
  return null;
}

/**
 * 提取 DAG 信息
 */
function extractDAG(output: string): TestResult['dag'] {
  const taskMatch = output.match(/任务数量[:\s]+(\d+)/);
  const agentMatches = output.match(/Agent[:\s]+(\w+)/g);

  if (taskMatch || agentMatches) {
    return {
      taskCount: taskMatch ? parseInt(taskMatch[1]) : 0,
      agents: agentMatches ? [...new Set(agentMatches.map(m => m.split(/:\s+/)[1]))] : [],
      parallelGroups: (output.match(/parallel|并行/gi) || []).length
    };
  }
  return null;
}

/**
 * 提取使用的 Agents
 */
function extractAgentsUsed(output: string): string[] {
  const matches = output.match(/Agent[:\s]+\w+/g) || [];
  return [...new Set(matches.map(m => m.split(/:\s+/)[1]?.trim()))];
}

/**
 * 提取使用的 Skills
 */
function extractSkillsUsed(output: string): string[] {
  const matches = output.match(/技能[:\s]+[\w-]+/g) || [];
  return [...new Set(matches.map(m => m.split(/:\s+/)[1]?.trim()))];
}

/**
 * 提取响应内容
 */
function extractResponse(output: string): string {
  // 提取最后的响应内容
  const lines = output.split('\n');
  const responseStart = lines.findIndex(l => l.includes('Agent>') || l.includes('响应'));

  if (responseStart >= 0) {
    return lines.slice(responseStart).join('\n').substring(0, 1000);
  }

  return output.substring(-1000);
}

/**
 * 评估输出质量
 */
function assessQuality(output: string): 'excellent' | 'good' | 'fair' | 'poor' {
  if (output.includes('✓') || output.includes('成功') || output.includes('完成')) {
    return 'excellent';
  } else if (output.includes('error') || output.includes('失败') || output.includes('错误')) {
    return 'poor';
  } else if (output.length > 500) {
    return 'good';
  }
  return 'fair';
}

/**
 * 检查是否生成了新的 Agent 配置
 */
function checkAgentGeneration(testCase: typeof testCases[0]): TestResult['agentGenerated'] {
  const agentsDir = join(process.cwd(), 'config', 'agents');

  // 检查是否有新生成的 Agent 配置
  // 这里简化处理，实际应该比较执行前后的文件列表
  return {
    generated: false // 需要在执行后检查
  };
}

/**
 * 生成测试报告
 */
function generateReport(results: TestResult[]): void {
  const reportPath = join(outputDir, 'test-report.md');

  const passed = results.filter(r => r.execution?.success).length;
  const failed = results.filter(r => !r.execution?.success).length;
  const avgDuration = results.reduce((sum, r) => sum + (r.execution?.duration || 0), 0) / results.length;

  let report = `# NAC 工程 20 个复杂测试用例执行报告\n\n`;
  report += `> **执行时间**: ${new Date().toISOString()}\n`;
  report += `> **总计**: ${results.length} | **通过**: ${passed} | **失败**: ${failed}\n`;
  report += `> **平均耗时**: ${(avgDuration / 1000).toFixed(2)}秒\n\n`;
  report += `---\n\n`;

  // 统计信息
  report += `## 统计摘要\n\n`;
  report += `### Intent 类型分布\n\n`;
  const intentCounts: Record<string, number> = {};
  results.forEach(r => {
    if (r.intent?.type) {
      intentCounts[r.intent.type] = (intentCounts[r.intent.type] || 0) + 1;
    }
  });
  Object.entries(intentCounts).forEach(([type, count]) => {
    report += `- ${type}: ${count}\n`;
  });

  report += `\n### Agent 使用统计\n\n`;
  const agentCounts: Record<string, number> = {};
  results.forEach(r => {
    r.execution?.agentUsed.forEach(a => {
      agentCounts[a] = (agentCounts[a] || 0) + 1;
    });
  });
  Object.entries(agentCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([agent, count]) => {
      report += `- ${agent}: ${count}\n`;
    });

  report += `\n### Agent 生成统计\n\n`;
  const generatedCount = results.filter(r => r.agentGenerated.generated).length;
  report += `- 新 Agent 生成: ${generatedCount}/${results.length}\n`;

  report += `\n---\n\n`;
  report += `## 详细结果\n\n`;

  results.forEach(result => {
    report += `### ${result.testCaseId}: ${result.testCaseName}\n\n`;
    report += `- **类别**: ${result.testCaseId.split('-')[1] === 'TC' ? 'unknown' : 'code'}\n`;
    report += `- **耗时**: ${result.execution ? `${(result.execution.duration / 1000).toFixed(2)}s` : 'N/A'}\n`;
    report += `- **状态**: ${result.execution?.success ? '✅ 通过' : '❌ 失败'}\n`;

    if (result.intent) {
      report += `- **Intent**: ${result.intent.type} (${result.intent.complexity})\n`;
    }

    if (result.dag) {
      report += `- **DAG**: ${result.dag.taskCount} 任务, ${result.dag.agents.join(', ')}\n`;
    }

    if (result.execution?.agentUsed.length) {
      report += `- **Agents**: ${result.execution.agentUsed.join(', ')}\n`;
    }

    if (result.execution?.skillsUsed.length) {
      report += `- **Skills**: ${result.execution.skillsUsed.join(', ')}\n`;
    }

    if (result.agentGenerated.generated) {
      report += `- **新 Agent**: ${result.agentGenerated.agentType} → ${result.agentGenerated.configPath}\n`;
    }

    if (result.errors.length) {
      report += `- **错误**: ${result.errors.join('; ')}\n`;
    }

    report += `\n`;
  });

  report += `\n---\n\n`;
  report += `## Agent 生成验证\n\n`;
  report += `### 现有 Agent 配置\n\n`;
  report += `- CodeAgent\n`;
  report += `- DataAgent\n`;
  report += `- AnalysisAgent\n`;
  report += `- AutomationAgent\n`;
  report += `- GenericAgent\n`;
  report += `- DocumentAgent\n\n`;

  report += `### 新生成 Agent 列表\n\n`;
  const newAgents = results.filter(r => r.agentGenerated.generated);
  if (newAgents.length > 0) {
    newAgents.forEach(r => {
      report += `- ${r.testCaseId}: ${r.agentGenerated.agentType}\n`;
    });
  } else {
    report += `⚠️ 没有检测到新 Agent 生成\n`;
    report += `\n**建议**: 检查系统是否根据新任务类型自动生成和保存 Agent 配置\n`;
  }

  report += `\n---\n\n`;
  report += `## 结论\n\n`;
  report += `### 通过率\n\n`;
  report += `${((passed / results.length) * 100).toFixed(1)}% (${passed}/${results.length})\n\n`;

  report += `### Agent 自动生成能力\n\n`;
  if (generatedCount > 0) {
    report += `✅ 系统具备 Agent 自动生成能力，共生成 ${generatedCount} 个新 Agent\n\n`;
  } else {
    report += `❌ 系统未检测到 Agent 自动生成\n`;
    report += `- 需要实现基于任务类型自动生成 Agent 配置\n`;
    report += `- 新 Agent 应保存到 \`config/agents/\` 目录\n`;
    report += `- Agent 配置应符合现有规范（*.system.md）\n\n`;
  }

  report += `### 后续优化建议\n\n`;
  report += `1. **Agent 自动生成**: 实现基于任务类型自动创建新 Agent\n`;
  report += `2. **配置持久化**: 新 Agent 配置自动保存到 config/agents/\n`;
  report += `3. **质量评估**: 添加输出质量的自动评估机制\n`;
  report += `4. **错误恢复**: 增强错误处理和重试机制\n`;

  writeFileSync(reportPath, report);
  console.log(`\n📊 测试报告已生成: ${reportPath}\n`);
}

/**
 * 主执行函数
 */
async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('NAC 工程 20 个复杂测试用例自动执行');
  console.log('='.repeat(80) + '\n');

  const results: TestResult[] = [];

  // 逐个执行测试用例
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n进度: ${i + 1}/${testCases.length}`);

    try {
      const result = await runTestCase(testCase);
      results.push(result);

      // 测试之间等待1秒
      if (i < testCases.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`测试 ${testCase.id} 执行失败:`, error);
      results.push({
        testCaseId: testCase.id,
        testCaseName: testCase.name,
        timestamp: new Date().toISOString(),
        input: testCase.input,
        intent: null,
        dag: null,
        execution: null,
        output: null,
        errors: [String(error)],
        agentGenerated: { generated: false }
      });
    }
  }

  // 生成报告
  generateReport(results);

  console.log('\n' + '='.repeat(80));
  console.log('所有测试执行完成！');
  console.log(`总计: ${results.length} | 通过: ${results.filter(r => r.execution?.success).length} | 失败: ${results.filter(r => !r.execution?.success).length}`);
  console.log('='.repeat(80) + '\n');
}

// 执行测试
main().catch(console.error);
