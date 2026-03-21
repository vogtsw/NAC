import { spawn } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const TEST_OUTPUT_DIR = join(process.cwd(), 'memory', 'test-results');

// 确保输出目录存在
if (!existsSync(TEST_OUTPUT_DIR)) {
  mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
}

interface TestCase {
  id: string;
  category: string;
  input: string;
  expectedAgents: string[];
}

const testCases: TestCase[] = [
  // ==================== 代码开发类 (5个) ====================
  {
    id: 'TC-CODE-001',
    category: '代码开发',
    input: 'Develop a user authentication REST API using TypeScript and Express with: user registration (POST /auth/register), user login (POST /auth/login), JWT auth middleware, bcrypt password hashing, input validation middleware, and unit tests.',
    expectedAgents: ['CodeAgent', 'AnalysisAgent', 'AutomationAgent']
  },
  {
    id: 'TC-CODE-002',
    category: '代码开发',
    input: 'Create a Python Flask data analysis API with: /upload endpoint for CSV files, /analyze endpoint for statistical analysis, /visualize endpoint for charts using pandas and matplotlib, with error handling and logging.',
    expectedAgents: ['CodeAgent', 'DataAgent']
  },
  {
    id: 'TC-CODE-003',
    category: '代码开发',
    input: 'Develop a React task management component with TypeScript: TaskList component for display, TaskForm for adding tasks, task status toggle, Tailwind CSS styling, and PropTypes definitions.',
    expectedAgents: ['CodeAgent']
  },
  {
    id: 'TC-CODE-004',
    category: '代码开发',
    input: 'Create a Go user service microservice with: gRPC service definition (user.proto), user CRUD operations, PostgreSQL database integration, Docker configuration, Makefile build script, and error handling.',
    expectedAgents: ['CodeAgent', 'DataAgent']
  },
  {
    id: 'TC-CODE-005',
    category: '代码开发',
    input: 'Create a Spring Boot order management service with: Order entity and Repository, OrderService business logic, OrderController REST API, JPA database configuration, global exception handling, and integration tests.',
    expectedAgents: ['CodeAgent']
  },

  // ==================== 数据分析类 (4个) ====================
  {
    id: 'TC-DATA-001',
    category: '数据分析',
    input: 'Analyze the following sales data: Date,Product,Sales,Amount; 2024-01,ProductA,100,5000; 2024-01,ProductB,80,4000; 2024-02,ProductA,120,6000; 2024-02,ProductB,90,4500. Calculate: 1) Monthly total sales, 2) Best selling product, 3) Monthly growth rate, 4) Generate analysis report.',
    expectedAgents: ['DataAgent', 'AnalysisAgent']
  },
  {
    id: 'TC-DATA-002',
    category: '数据分析',
    input: 'Analyze and optimize this slow SQL query: SELECT * FROM orders o LEFT JOIN order_items oi ON o.id = oi.order_id LEFT JOIN products p ON oi.product_id = p.id LEFT JOIN customers c ON o.customer_id = c.id WHERE o.created_at > "2024-01-01" ORDER BY c.name. Provide: 1) Execution plan analysis, 2) Index optimization suggestions, 3) SQL rewrite recommendations, 4) Performance improvement estimates.',
    expectedAgents: ['AnalysisAgent', 'CodeAgent']
  },
  {
    id: 'TC-DATA-003',
    category: '数据分析',
    input: 'Design a data visualization solution for an IoT monitoring system with: real-time sensor data display (temperature, humidity, pressure), historical trend charts, anomaly alert visualization, recommended frontend chart libraries, and data storage structure design.',
    expectedAgents: ['AnalysisAgent', 'CodeAgent']
  },
  {
    id: 'TC-DATA-004',
    category: '数据分析',
    input: 'Clean and transform inconsistent user data. Original examples: {"name":"张三","age":"25","email":"zhang@example.com"}, {"name":"李四","age":30,"email":"lisi@test.com"}, {"name":"王五","email":"wangwu@example.com"}. Requirements: 1) Unify field formats, 2) Fill missing values (age default 0), 3) Validate email format, 4) Remove duplicates, 5) Generate cleaned JSON.',
    expectedAgents: ['DataAgent', 'CodeAgent']
  },

  // ==================== 文档处理类 (3个) ====================
  {
    id: 'TC-DOC-001',
    category: '文档处理',
    input: 'Generate complete API documentation in Markdown for a user authentication API with: POST /api/auth/register (params: username, email, password; returns: user_id, token), POST /api/auth/login (params: email, password; returns: user_id, token), GET /api/auth/me (header: Authorization Bearer token; returns: user info). Include: endpoint descriptions, request parameters, response formats, error codes, and usage examples.',
    expectedAgents: ['AnalysisAgent', 'GenericAgent']
  },
  {
    id: 'TC-DOC-002',
    category: '文档处理',
    input: 'Refactor the following technical documentation to be more professional: "This function calculates things, takes some numbers as input, returns result. Returns null if input is wrong, otherwise returns calculated result." Requirements: 1) Use standard technical documentation format, 2) Add function signature, 3) Add parameter descriptions, 4) Add return value description, 5) Add usage examples, 6) Add exception handling notes.',
    expectedAgents: ['AnalysisAgent', 'GenericAgent']
  },
  {
    id: 'TC-DOC-003',
    category: '文档处理',
    input: 'Generate architecture design document for a microservice e-commerce system with: service decomposition (user service, product service, order service, payment service), inter-service communication (REST/gRPC/message queue), database design for each service, caching strategy (Redis usage), service discovery, load balancing, and monitoring and logging solutions.',
    expectedAgents: ['AnalysisAgent', 'CodeAgent']
  },

  // ==================== 自动化任务类 (3个) ====================
  {
    id: 'TC-AUTO-001',
    category: '自动化任务',
    input: 'Design complete CI/CD pipeline for a Node.js project: GitHub Actions workflow, code quality checks (ESLint, Prettier), unit tests (Jest), E2E tests (Playwright), Docker image build, Kubernetes deployment, and notification mechanism (Slack/Email).',
    expectedAgents: ['AutomationAgent', 'CodeAgent']
  },
  {
    id: 'TC-AUTO-002',
    category: '自动化任务',
    input: 'Create automated test scripts for a REST API using Playwright: test user registration flow, test user login flow, test data CRUD operations, test error handling (401, 404, 500), generate HTML test report, and add data-driven testing with CSV data source.',
    expectedAgents: ['AutomationAgent', 'CodeAgent']
  },
  {
    id: 'TC-AUTO-003',
    category: '自动化任务',
    input: 'Design application deployment automation: write Dockerfile (multi-stage build), write docker-compose.yml, environment variable configuration, database initialization script, health check endpoint, rolling update strategy, and rollback mechanism.',
    expectedAgents: ['AutomationAgent', 'CodeAgent']
  },

  // ==================== 多Agent协作类 (3个) ====================
  {
    id: 'TC-MULTI-001',
    category: '多Agent协作',
    input: 'Develop a complete full-stack task management application. Backend (Node.js + Express): RESTful API, PostgreSQL database, JWT authentication. Frontend (React + TypeScript): task list page, task create/edit form, API integration with state management. Deployment: Docker configuration, Nginx reverse proxy. Execute in order: 1) Database design, 2) Backend API development, 3) Frontend development, 4) Deployment configuration, 5) Integration testing.',
    expectedAgents: ['DataAgent', 'CodeAgent', 'AutomationAgent']
  },
  {
    id: 'TC-MULTI-002',
    category: '多Agent协作',
    input: 'Develop a payment system with: payment interface design (Alipay, WeChat Pay integration), order state machine (pending, paid, refunded), payment callback handling, transaction log recording, reconciliation function, security review (signature verification, replay prevention), and performance testing (1000 TPS).',
    expectedAgents: ['CodeAgent', 'AnalysisAgent', 'DataAgent']
  },
  {
    id: 'TC-MULTI-003',
    category: '多Agent协作',
    input: 'Design a complete mid-size e-commerce system architecture. Function modules: user center, product center, shopping cart, order system, review system, marketing system. Tech requirements: microservice architecture, MySQL + Redis + MongoDB, message queue (RabbitMQ/Kafka), Elasticsearch. Provide: 1) Service decomposition, 2) Database design, 3) API design, 4) Deployment architecture.',
    expectedAgents: ['AnalysisAgent', 'CodeAgent', 'DataAgent', 'AutomationAgent']
  },

  // ==================== 复杂问题分析类 (2个) ====================
  {
    id: 'TC-ANALYSIS-001',
    category: '问题分析',
    input: 'A web application has performance issues: 1) First screen load time exceeds 5 seconds, 2) API response time is long (average 2 seconds), 3) Some database queries are slow (over 10 seconds), 4) Response becomes slow under high concurrency. Provide: 1) Performance bottleneck analysis, 2) Optimization solution design, 3) Implementation plan, 4) Expected improvement assessment.',
    expectedAgents: ['AnalysisAgent', 'CodeAgent']
  },
  {
    id: 'TC-ANALYSIS-002',
    category: '问题分析',
    input: 'Select technology stack for a real-time collaborative office system. Requirements: real-time collaboration (multi-user editing), low latency (<100ms), high availability (99.9% SLA), large scale (1M+ users). Candidates: Frontend: React vs Vue vs Angular, Backend: Node.js vs Go vs Java, Database: PostgreSQL vs MySQL vs MongoDB, Real-time: WebSocket vs SSE vs WebRTC, Cache: Redis vs Memcached. Provide: 1) Pros and cons analysis of each option, 2) Final recommended solution, 3) Technical risk notes, 4) Implementation recommendations.',
    expectedAgents: ['AnalysisAgent']
  }
];

async function executeTest(testCase: TestCase, index: number): Promise<{
  success: boolean;
  output: string;
  error?: string;
  executionTime: number;
  agentsUsed?: string[];
  taskCount?: number;
}> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const output: string[] = [];
    const errors: string[] = [];

    console.log(`[${testCase.id}] Starting test...`);

    // 创建临时输入文件
    const tempInputPath = join(TEST_OUTPUT_DIR, `temp-input-${index}.txt`);
    writeFileSync(tempInputPath, testCase.input, 'utf8');

    // 使用 pnpm cli run --file 命令
    const args = ['cli', 'run', '--file', tempInputPath];
    const child = spawn('pnpm', args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });

    // 设置超时（6分钟）
    const timeout = setTimeout(() => {
      child.kill();
      resolve({
        success: false,
        output: output.join('\n'),
        error: 'Test timeout after 6 minutes',
        executionTime: Date.now() - startTime,
        agentsUsed: [],
        taskCount: 0
      });
    }, 360000);

    child.stdout.on('data', (data) => {
      const text = data.toString();
      output.push(text);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      errors.push(text);
      console.error(`[${testCase.id}] ERROR: ${text.substring(0, 200)}`);
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        output: output.join('\n'),
        error: error.message,
        executionTime: Date.now() - startTime,
        agentsUsed: [],
        taskCount: 0
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);

      // 解析完整的输出
      const fullOutput = output.join('\n');
      let actualSuccess = code === 0;
      let agentsUsed: string[] = [];
      let taskCount = 0;

      // 提取 Agent 信息 - 支持多种格式
      // 格式1: "agentType": "AnalysisAgent" (JSON格式)
      const agentMatchJson = fullOutput.match(/"agentType":\s*"(\w+)"/g);
      if (agentMatchJson) {
        agentMatchJson.forEach(m => {
          const match = m.match(/"agentType":\s*"(\w+)"/);
          if (match && match[1]) {
            const agentType = match[1];
            if (!agentsUsed.includes(agentType)) {
              agentsUsed.push(agentType);
            }
          }
        });
      }

      // 格式2: agentType: AnalysisAgent (日志格式)
      const agentMatchLog = fullOutput.match(/agentType:\s*(\w+)/g);
      if (agentMatchLog) {
        agentMatchLog.forEach(m => {
          const agentType = m.split(':')[1]?.trim();
          if (agentType && !agentsUsed.includes(agentType)) {
            agentsUsed.push(agentType);
          }
        });
      }

      // 提取任务数量 - 支持多种格式
      // 格式1: "totalTasks": 8 (JSON格式)
      const taskMatchJson = fullOutput.match(/"totalTasks":\s*(\d+)/);
      if (taskMatchJson) {
        taskCount = parseInt(taskMatchJson[1], 10);
      }

      // 格式2: taskCount: 8 (日志格式)
      const taskMatchLog = fullOutput.match(/taskCount:\s*(\d+)/);
      if (taskMatchLog) {
        taskCount = parseInt(taskMatchLog[1], 10);
      }

      // 格式3: "taskCount": 8 (JSON格式)
      const taskMatchJson2 = fullOutput.match(/"taskCount":\s*(\d+)/);
      if (taskMatchJson2) {
        taskCount = parseInt(taskMatchJson2[1], 10);
      }

      // 尝试从输出中提取实际的success状态
      // 查找最后一个包含success字段的JSON对象
      const successMatches = fullOutput.match(/\{[^{}]*"success":\s*(true|false)[^{}]*\}/g);
      if (successMatches && successMatches.length > 0) {
        // 取最后一个匹配（通常是最终结果）
        const lastMatch = successMatches[successMatches.length - 1];
        try {
          const jsonObj = JSON.parse(lastMatch);
          if (typeof jsonObj.success === 'boolean') {
            actualSuccess = jsonObj.success;
          }
        } catch {
          // 忽略解析错误，使用退出码
        }
      }

      resolve({
        success: actualSuccess,
        output: fullOutput,
        error: errors.length > 0 ? errors.join('\n') : undefined,
        executionTime: Date.now() - startTime,
        agentsUsed,
        taskCount
      });
    });
  });
}

async function main() {
  console.log('='.repeat(70));
  console.log('NexusAgent-Cluster 复杂测试用例执行');
  console.log('使用模式: pnpm cli run --file');
  console.log('='.repeat(70));

  const results: any[] = [];
  const passed: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n[${i + 1}/${testCases.length}] ${testCase.id}`);
    console.log(`类别: ${testCase.category}`);
    console.log(`预期 Agents: ${testCase.expectedAgents.join(', ')}`);
    console.log('-'.repeat(70));

    try {
      const result = await executeTest(testCase, i);

      const testResult = {
        ...testCase,
        ...result,
        timestamp: new Date().toISOString()
      };

      results.push(testResult);

      // 保存结果
      const resultFilePath = join(TEST_OUTPUT_DIR, `${testCase.id}.json`);
      writeFileSync(resultFilePath, JSON.stringify(testResult, null, 2));

      console.log(`\n结果: ${result.success ? '✅ 通过' : '❌ 失败'}`);
      console.log(`执行时间: ${(result.executionTime / 1000).toFixed(2)}秒`);
      if (result.agentsUsed) {
        console.log(`使用的 Agents: ${result.agentsUsed.join(', ')}`);
      }
      if (result.taskCount !== undefined) {
        console.log(`任务数量: ${result.taskCount}`);
      }
      if (result.error) {
        console.log(`错误: ${result.error.substring(0, 200)}`);
      }

      if (result.success) {
        passed.push(testCase.id);
      } else {
        failed.push(testCase.id);
      }
    } catch (error: any) {
      console.error(`\n❌ 测试异常: ${error.message}`);
      failed.push(testCase.id);
    }

    console.log('='.repeat(70) + '\n');

    // 等待一段时间再执行下一个测试
    if (i < testCases.length - 1) {
      console.log('等待 10 秒后执行下一个测试...\n');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }

  // 生成汇总报告
  const summary = {
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passed: passed.length,
    failed: failed.length,
    passRate: ((passed.length / results.length) * 100).toFixed(2) + '%',
    results: results.map(r => ({
      id: r.id,
      category: r.category,
      success: r.success,
      executionTime: r.executionTime,
      agentsUsed: r.agentsUsed || [],
      taskCount: r.taskCount || 0
    }))
  };

  const summaryPath = join(TEST_OUTPUT_DIR, 'summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  // 生成 Markdown 报告
  const markdownReport = generateMarkdownReport(summary);
  const reportPath = join(TEST_OUTPUT_DIR, 'test-report.md');
  writeFileSync(reportPath, markdownReport);

  console.log('\n' + '='.repeat(70));
  console.log('测试完成！');
  console.log('='.repeat(70));
  console.log(`总计: ${summary.totalTests}`);
  console.log(`通过: ${summary.passed}`);
  console.log(`失败: ${summary.failed}`);
  console.log(`通过率: ${summary.passRate}`);
  console.log(`\n报告路径:`);
  console.log(`  JSON: ${summaryPath}`);
  console.log(`  Markdown: ${reportPath}`);
  console.log('='.repeat(70));

  // 显示失败的测试
  if (failed.length > 0) {
    console.log(`\n失败的测试: ${failed.join(', ')}`);
  }
}

function generateMarkdownReport(summary: any): string {
  let md = '# NexusAgent-Cluster 测试报告\n\n';
  md += `> 测试时间: ${summary.timestamp}\n`;
  md += `> 测试模式: pnpm cli run --file\n\n`;

  md += '## 测试概览\n\n';
  md += `| 指标 | 数值 |\n`;
  md += '|:---|:---:|\n';
  md += `| 总测试数 | ${summary.totalTests} |\n`;
  md += `| 通过 | ${summary.passed} |\n`;
  md += `| 失败 | ${summary.failed} |\n`;
  md += `| 通过率 | ${summary.passRate} |\n\n`;

  md += '## 测试结果详情\n\n';
  md += '| 用例ID | 类别 | 状态 | 执行时间(秒) | 使用的Agent | 任务数 |\n';
  md += '|:---|:---|:---:|:---:|:---:|\n';

  summary.results.forEach((r: any) => {
    md += `| ${r.id} | ${r.category} | ${r.success ? '✅' : '❌'} | ${(r.executionTime / 1000).toFixed(2)} | ${(r.agentsUsed || []).join(', ') || '-'} | ${r.taskCount} |\n`;
  });

  md += '\n## 失败的测试\n\n';
  const failedResults = summary.results.filter((r: any) => !r.success);
  if (failedResults.length === 0) {
    md += '无失败测试 🎉\n';
  } else {
    failedResults.forEach((r: any) => {
      md += `### ${r.id}\n`;
      md += `**类别**: ${r.category}\n`;
      md += `**错误**: ${r.error ? r.error.substring(0, 200) + '...' : '未知错误'}\n\n`;
    });
  }

  return md;
}

main().catch(console.error);
