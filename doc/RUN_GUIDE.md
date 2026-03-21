# NexusAgent-Cluster 运行指南

## 快速开始

### 1. 环境要求

- **Node.js**: 20.0.0 或更高版本
- **包管理器**: pnpm（推荐）或 npm
- **Redis**: 7.0+（可选，用于分布式状态）
- **LLM API Key**: 智谱 AI / DeepSeek / OpenAI

### 2. 安装依赖

```bash
# 进入项目目录
cd D:\test\agent\jiqun

# 安装依赖
pnpm install
```

### 3. 配置环境变量

```bash
# 复制环境变量模板
copy .env.example .env

# 编辑 .env 文件，设置你的 API Key
```

**必需配置（`.env` 文件）:**

```bash
# LLM 配置 - 选择一个即可
OPENAI_API_KEY=sk-your-openai-key-here
# 或
ZHIPU_API_KEY=your-zhipu-api-key-here
# 或
DEEPSEEK_API_KEY=your-deepseek-api-key-here

# 存储配置（可选，默认使用内存）
REDIS_URL=redis://localhost:6379

# API 配置
API_HOST=0.0.0.0
API_PORT=3000

# 日志配置
LOG_LEVEL=info
```

### 4. 启动方式

---

## 方式一：CLI 模式（推荐快速测试）

### ⚠️ Windows 用户注意

**Windows 命令行可能存在中文编码问题**，有以下解决方案：

#### 方案 A: 使用文件输入（推荐）

```bash
# 1. 创建任务文件
echo 生成一个用户登录 API > task.txt

# 2. 从文件运行
pnpm cli run --file task.txt
```

#### 方案 B: 使用交互式输入

```bash
# 启动交互模式
pnpm cli run --interactive

# 然后输入任务
请输入任务描述: 生成一个用户登录 API
```

#### 方案 C: 使用 PowerShell

```powershell
# PowerShell 对 UTF-8 支持更好
$env:NODE_OPTIONS="--max-old-space-size=4096"
pnpm cli run "生成一个用户登录 API"
```

#### 方案 D: 使用 Git Bash / WSL

```bash
# Git Bash 通常对 UTF-8 支持很好
pnpm cli run "生成一个用户登录 API"
```

### 基本用法（非中文任务）

```bash
# 运行单个任务（英文或简单任务）
pnpm cli run "generate a fibonacci function"
```

### 示例命令

```bash
# 代码生成（英文）
pnpm cli run "generate a REST API for user authentication"

# 使用文件输入（中文任务）
pnpm cli run --file task.txt
```

### 其他 CLI 命令

```bash
# 启动 API 服务器
pnpm cli serve

# 查看系统状态
pnpm cli status

# 列出所有技能
pnpm cli skills list

# 查看技能详情
pnpm cli skill info code-generation

# 清理临时文件
pnpm cli clean

# 显示帮助
pnpm cli help
```

---

## 方式二：API 服务器模式

### 启动服务器

```bash
# 开发模式（支持热重载）
pnpm dev

# 生产模式
pnpm build
pnpm start

# 或使用 CLI
pnpm cli serve
```

### API 端点

服务器启动后，访问 `http://localhost:3000`

#### 1. 健康检查

```bash
curl http://localhost:3000/health
```

#### 2. 提交任务

```bash
curl -X POST http://localhost:3000/api/v1/tasks/submit \
  -H "Content-Type: application/json" \
  -d '{
    "userInput": "生成一个 TypeScript 斐波那契函数",
    "context": {}
  }'
```

#### 3. 查询任务状态

```bash
curl http://localhost:3000/api/v1/tasks/{task_id}
```

#### 4. 列出所有 Agent

```bash
curl http://localhost:3000/api/v1/agents/
```

#### 5. 列出所有技能

```bash
curl http://localhost:3000/api/v1/skills/
```

### API 文档

启动服务器后访问 Swagger UI:
```
http://localhost:3000/docs
```

---

## 方式三：编程方式使用

### 示例代码

```typescript
import { createOrchestrator } from './src/orchestrator/Orchestrator.js';

async function main() {
  // 创建编排器
  const orchestrator = createOrchestrator({
    maxParallelAgents: 3,
    enableDAGOptimization: true,
  });

  // 初始化
  await orchestrator.initialize();

  // 处理请求
  const result = await orchestrator.processRequest({
    sessionId: 'my-session-001',
    userInput: '生成一个用户登录 API',
    context: {},
  });

  console.log('结果:', result);

  // 关闭
  await orchestrator.shutdown();
}

main();
```

---

## 工作流程演示

### 场景 1: 代码开发

```bash
pnpm cli run "创建一个待办事项管理的 REST API，包含增删改查功能"
```

**预期输出:**
```
Executing task: 创建一个待办事项管理的 REST API...
Session ID: cli-1700000000000
---
[INFO] Intent parsed: type=code, complexity=medium
[INFO] Agent routed: CodeAgent (confidence: 0.95)
[INFO] DAG built: 4 tasks
[INFO] Executing task 1/4: 设计数据模型...
[INFO] Executing task 2/4: 创建 API 端点...
[INFO] Executing task 3/4: 实现控制器...
[INFO] Executing task 4/4: 添加验证...
---
Result: {
  "success": true,
  "response": "已为您创建待办事项管理 API...",
  "artifacts": [...]
}
```

### 场景 2: 文档处理

```bash
pnpm cli run "重写 D:\\Documents\\report.txt 使其更加专业"
```

**预期输出:**
```
Executing task: 重写文档...
Session ID: cli-1700000000001
---
[INFO] Intent parsed: type=other
[INFO] Agent routed: DocumentAgent (confidence: 0.92)
[INFO] Using skills: docx-processing, file-ops
---
Result: {
  "success": true,
  "result": {
    "action": "rewrite",
    "input": "D:\\Documents\\report.txt",
    "output": "D:\\Documents\\report_rewritten.txt"
  }
}
```

---

## 常见问题

### Q1: 提示 "LLM API Key 未配置"

**解决方法:**
1. 检查 `.env` 文件是否存在
2. 确保设置了正确的 API Key:
   ```bash
   OPENAI_API_KEY=sk-xxx
   # 或
   ZHIPU_API_KEY=xxx
   ```

### Q2: Redis 连接失败

**解决方法:**
1. 启动 Redis:
   ```bash
   docker run -d -p 6379:6379 redis:7
   ```
2. 或者在 `.env` 中注释掉 Redis 配置（使用内存存储）

### Q3: 端口被占用

**解决方法:**
修改 `.env` 中的端口:
```bash
API_PORT=3001
```

### Q4: 找不到模块

**解决方法:**
```bash
# 重新构建
pnpm build

# 清理并重新安装
pnpm clean
pnpm install
```

---

## 开发模式

### 热重载开发

```bash
pnpm dev
```

### 运行测试

```bash
# 所有测试
pnpm test

# 核心验证测试
pnpm test tests/core-validation.test.ts --run

# 测试覆盖率
pnpm test:coverage
```

### 代码检查

```bash
# 类型检查
pnpm type-check

# Lint
pnpm lint

# 格式化
pnpm format
```

---

## 目录结构

```
nexus-agent-cluster/
├── src/                      # 源代码
│   ├── agents/               # Agent 系统
│   │   ├── custom/           # 自定义 Agent
│   │   └── ...
│   ├── orchestrator/         # 编排系统
│   ├── skills/               # 技能系统
│   ├── llm/                  # LLM 抽象层
│   ├── state/                # 状态管理
│   ├── api/                  # API 服务器
│   └── cli.ts                # CLI 入口
├── config/                   # 配置文件
│   └── agents/               # Agent 系统提示词
├── skills/                   # 外部技能
├── memory/                   # 运行时数据
│   ├── sessions/             # 会话历史
│   ├── feedback/             # 用户反馈
│   └── artifacts/            # 任务产物
├── tests/                    # 测试文件
├── .env                      # 环境变量
├── package.json
└── README.md
```

---

## 配置选项

### 环境变量完整列表

| 变量 | 说明 | 默认值 |
|:---|:---|:---|
| `OPENAI_API_KEY` | OpenAI API Key | - |
| `ZHIPU_API_KEY` | 智谱 AI API Key | - |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | - |
| `REDIS_URL` | Redis 连接地址 | `redis://localhost:6379` |
| `API_HOST` | API 监听地址 | `0.0.0.0` |
| `API_PORT` | API 监听端口 | `3000` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `MAX_PARALLEL_AGENTS` | 最大并行 Agent 数 | `10` |

---

## 下一步

1. **运行第一个任务**
   ```bash
   pnpm cli run "生成一个 Hello World 程序"
   ```

2. **查看 API 文档**
   ```
   http://localhost:3000/docs
   ```

3. **创建自定义 Agent**
   参考 `docs/AGENT_DEVELOPMENT_GUIDE.md`

4. **添加自定义技能**
   在 `skills/` 目录创建新的技能包
