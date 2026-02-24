# NexusAgent-Cluster (NAC)

**Multi-Agent Orchestration System** - A TypeScript/Node.js based distributed agent cluster for intelligent task automation.

## Overview

NexusAgent-Cluster (NAC) is an extensible multi-agent orchestration system that automatically generates, schedules, and manages specialized sub-agents to complete complex tasks through parallel collaboration.

### Core Features

| Feature | Description |
|---------|-------------|
| **Intent-to-Action** | Converts natural language intent into executable task sequences using LLM |
| **Dynamic Agent Generation** | Creates specialized agents on-demand based on task requirements |
| **DAG-Based Scheduling** | Identifies parallelizable tasks using Directed Acyclic Graph algorithms |
| **Skills System** | Modular, pluggable capabilities that agents can dynamically load |
| **Multi-LLM Support** | Works with Zhipu AI, DeepSeek, OpenAI, Qwen, and more |
| **Event-Driven Architecture** | Real-time event broadcasting with in-memory and Redis-based EventBus |
| **RESTful API** | Fastify-based high-performance HTTP server |
| **Type-Safe** | Built with TypeScript 5+ for full type safety |

### Supported Task Types

- **Code Development** - Generate, review, and refactor code
- **Data Analysis** - Process and analyze datasets
- **Automation** - Terminal commands and file operations
- **Analysis** - Code review and data insights
- **Deployment** - Build and deployment workflows

## Tech Stack

```yaml
Runtime:
  - Node.js 20+
  - TypeScript 5+

Package Manager:
  - pnpm

API Framework:
  - Fastify (high-performance HTTP)
  - WebSocket support

State Management:
  - Redis 7+ (optional, for distributed state)
  - In-memory fallback

LLM Integration:
  - OpenAI SDK (compatible with multiple providers)

Testing:
  - Vitest (unit testing)
  - tsx (test runner)

Build Tools:
  - tsup / esbuild
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm (recommended) or npm
- Redis 7+ (optional, for distributed features)

### Installation

```bash
# Clone the repository
git clone https://github.com/vogtsw/NAC.git
cd NAC

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env
```

### Configuration

Edit `.env` file with your LLM provider credentials:

```bash
# Choose your LLM provider
LLM_PROVIDER=zhipu

# Zhipu AI (智谱)
ZHIPU_API_KEY=your_api_key_here
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
ZHIPU_MODEL=glm-4-flash

# DeepSeek
# DEEPSEEK_API_KEY=your_api_key_here
# DEEPSEEK_BASE_URL=https://api.deepseek.com
# DEEPSEEK_MODEL=deepseek-chat

# OpenAI
# OPENAI_API_KEY=your_api_key_here
# OPENAI_BASE_URL=https://api.openai.com/v1
# OPENAI_MODEL=gpt-4o

# Qwen (阿里云)
# QWEN_API_KEY=your_api_key_here
# QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
# QWEN_MODEL=qwen-max
```

### Running

```bash
# Run CLI interface
pnpm cli run "Create a user login RESTful API"

# Start API server
pnpm start

# Development mode with hot reload
pnpm dev

# Run tests
pnpm test

# Run integration tests
pnpm test:integration
```

## Project Structure

```
nexus-agent-cluster/
├── src/
│   ├── agents/                # Agent System
│   │   ├── BaseAgent.ts       # Abstract base class
│   │   ├── GenericAgent.ts    # General-purpose agent
│   │   ├── CodeAgent.ts       # Code development agent
│   │   ├── DataAgent.ts       # Data analysis agent
│   │   ├── AutomationAgent.ts # Automation agent
│   │   ├── AnalysisAgent.ts   # Analysis agent
│   │   ├── AgentFactory.ts    # Dynamic agent creation
│   │   └── index.ts
│   ├── orchestrator/          # Core Orchestration
│   │   ├── Orchestrator.ts    # Main coordinator
│   │   ├── IntentParser.ts    # Natural language parser
│   │   ├── DAGBuilder.ts      # Task dependency graph
│   │   └── Scheduler.ts       # Parallel task executor
│   ├── skills/                # Skills System
│   │   ├── SkillManager.ts    # Skill registry
│   │   ├── types.ts           # Type definitions
│   │   └── builtin/           # Built-in skills
│   │       ├── CodeGenerationSkill.ts
│   │       ├── CodeReviewSkill.ts
│   │       ├── DataAnalysisSkill.ts
│   │       ├── FileOpsSkill.ts
│   │       └── TerminalSkill.ts
│   ├── llm/                   # LLM Abstraction
│   │   ├── LLMClient.ts       # Universal LLM client
│   │   └── prompts.ts         # Prompt templates
│   ├── state/                 # State Management
│   │   ├── Blackboard.ts      # Shared state (Redis)
│   │   ├── EventBus.ts        # Event pub/sub
│   │   └── models.ts          # Data models
│   ├── api/                   # API Layer
│   │   ├── server.ts          # Fastify server
│   │   └── routes/            # HTTP routes
│   ├── monitoring/            # Logging & Metrics
│   ├── config/                # Configuration
│   └── cli.ts                 # CLI interface
├── scripts/                   # Test Scripts
│   ├── test-zhipu.ts         # Zhipu API tests
│   ├── test-deepseek.ts      # DeepSeek API tests
│   └── test-integration.ts   # Integration tests
├── tests/                     # Tests
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## API Endpoints

### Task Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/tasks/submit` | POST | Submit a new task |
| `/api/v1/tasks/:id` | GET | Get task details |
| `/api/v1/tasks/session/:id/tasks` | GET | Get session tasks |
| `/api/v1/tasks/:id/cancel` | DELETE | Cancel a task |

### Agent Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/agents/` | GET | List all agents |
| `/api/v1/agents/:id` | GET | Get agent details |
| `/api/v1/agents/stats` | GET | Get statistics |
| `/api/v1/agents/types` | GET | List agent types |

### Skills

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/skills/` | GET | List all skills |
| `/api/v1/skills/:id` | GET | Get skill details |
| `/api/v1/skills/execute` | POST | Execute a skill |

### Health

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |

## CLI Usage

```bash
# Execute a task
pnpm cli run "Generate a TypeScript function to calculate Fibonacci numbers"

# Show help
pnpm cli --help
```

## Development

### Code Quality

```bash
# Type checking
pnpm check

# Build
pnpm build

# Run linter
pnpm lint
```

### Testing

```bash
# Unit tests
pnpm test

# Integration tests
pnpm test:integration

# Test coverage
pnpm test:coverage
```

## Architecture

### Request Flow

```
User Input
    ↓
Intent Parser (LLM)
    ↓
DAG Builder (Task Planning)
    ↓
Scheduler (Parallel Execution)
    ↓
Agent Factory (Create Agents)
    ↓
Skills Execution
    ↓
Result Aggregation
```

### Event Flow

```
Event Publisher
    ↓
Event Bus (Redis/Memory)
    ↓
Subscribers (Agents, Monitors)
    ↓
Real-time Updates (WebSocket)
```

## Configuration

See `.env.example` for all available configuration options.

```bash
# Cluster
MAX_PARALLEL_AGENTS=10
TASK_TIMEOUT=300000

# Orchestrator
ENABLE_DAG_OPTIMIZATION=true
MAX_TASK_RETRIES=3

# API
API_HOST=0.0.0.0
API_PORT=3000

# Monitoring
LOG_LEVEL=info
ENABLE_METRICS=true
```

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

**Built with ❤️ using TypeScript + Node.js**
