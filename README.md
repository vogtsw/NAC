# NexusAgent-Cluster (NAC)

**Multi-Agent Orchestration System** - A TypeScript/Node.js based distributed agent cluster for intelligent task automation with DAG-based parallel scheduling.

## Overview

NexusAgent-Cluster (NAC) is an extensible multi-agent orchestration system that automatically generates, schedules, and manages specialized sub-agents to complete complex tasks through parallel collaboration.

### Core Features

| Feature | Description |
|---------|-------------|
| **Intent-to-Action** | Converts natural language intent into executable task sequences using LLM |
| **Dynamic Agent Generation** | Creates specialized agents on-demand based on task requirements |
| **DAG-Based Scheduling** | Identifies parallelizable tasks using Directed Acyclic Graph algorithms |
| **Skills System** | Modular, pluggable capabilities that agents can dynamically load |
| **Session Memory** | Markdown-based conversation history storage (no RAG required) |
| **Agent Prompts** | Configurable system prompts stored as MD files |
| **Multi-LLM Support** | Works with Zhipu AI, DeepSeek, OpenAI, Qwen, and more |
| **Event-Driven Architecture** | Real-time event broadcasting with in-memory and Redis-based EventBus |
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

State Management:
  - Redis 7+ (optional, for distributed state)
  - In-memory fallback
  - Markdown-based session storage

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
git clone https://github.com/your-org/nexus-agent-cluster.git
cd nexus-agent-cluster

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

# Interactive chat mode
pnpm cli chat

# Build the project
pnpm build

# Run tests
pnpm test
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
│   │   ├── Scheduler.ts       # Parallel task executor
│   │   ├── AgentRouter.ts     # LLM-based agent routing
│   │   └── AgentRegistry.ts   # Dynamic agent registration
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
│   │   ├── PromptBuilder.ts   # Context assembler
│   │   └── prompts.ts         # System prompts
│   ├── state/                 # State Management
│   │   ├── Blackboard.ts      # Shared state (Redis)
│   │   ├── SessionStore.ts    # MD-based session storage
│   │   ├── EventBus.ts        # Event pub/sub
│   │   └── models.ts          # Data models
│   ├── monitoring/            # Logging & Metrics
│   ├── config/                # Configuration
│   └── cli.ts                 # CLI interface
├── config/                    # Configuration Files
│   └── agents/                # Agent System Prompts
│       ├── CodeAgent.system.md
│       ├── DataAgent.system.md
│       ├── AnalysisAgent.system.md
│       ├── AutomationAgent.system.md
│       ├── GenericAgent.system.md
│       └── default.system.md
├── memory/                    # Session & Artifact Storage
│   ├── sessions/              # Conversation history (MD)
│   ├── feedback/              # User feedback (MD)
│   └── artifacts/             # Task outputs
├── skills/                    # User Skills (SKILL.md)
├── tests/                     # Tests
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## CLI Usage

```bash
# Interactive chat mode
pnpm cli chat

# Execute a single task
pnpm cli run "Generate a TypeScript function to calculate Fibonacci numbers"

# Execute from file (avoid encoding issues)
pnpm cli run --file task.txt

# Show system status
pnpm cli status

# List all skills
pnpm cli skills list

# Show skill info
pnpm cli skill info code-generation

# Enable/disable a skill
pnpm cli skill enable code-generation
pnpm cli skill disable code-generation

# Test a skill
pnpm cli skill test code-generation

# Show help
pnpm cli help
```

### Interactive Mode Commands

When in interactive mode (`pnpm cli chat`), you can use:

| Command | Description |
|---------|-------------|
| `/status` | Show system status |
| `/skills` | List available skills |
| `/session` | Show current session info |
| `/clear` | Clear screen |
| `/exit`, `/quit` | Exit interactive mode |

## Architecture

### Request Flow

```
User Input
    ↓
Session Store (Create/Update Session)
    ↓
Intent Parser (LLM)
    ↓
Agent Router (LLM-based semantic matching)
    ↓
DAG Builder (Task Planning with intelligent routing)
    ↓
Scheduler (Parallel Execution)
    ↓
Agent Factory (Create Agents)
    ↓
PromptBuilder (Assemble Context)
├── System Prompt (config/agents/*.system.md)
├── Session History (memory/sessions/*.md)
├── Skills Summary
└── User Input
    ↓
LLM Call
    ↓
Skills Execution
    ↓
Session Store (Save Response)
    ↓
Result Aggregation
```

### Intelligent Agent Routing

The system uses LLM-based semantic matching to select the most appropriate agents for each task:

1. **AgentRegistry** - Maintains capability profiles for all agents
2. **AgentRouter** - Uses LLM to semantically match tasks to agents
3. **Collaboration Detection** - Identifies when multiple agents should work together
4. **Dynamic Skill Assignment** - Suggests relevant skills based on task requirements

### Custom Agents

Create custom agents by extending `BaseAgent`:

```typescript
import { BaseAgent } from './BaseAgent.js';

export class MyCustomAgent extends BaseAgent {
  constructor(llm: any, skillManager: any) {
    super(llm, skillManager, 'MyCustomAgent');
  }

  async execute(task: any): Promise<any> {
    // Your custom logic here
  }
}
```

### Custom Skills

Add custom skills to the `skills/` directory:

```bash
skills/
└── my-skill/
    └── SKILL.md
```

SKILL.md format:

```markdown
---
name: my-skill
description: My custom skill
category: custom
---

## Overview
Description of what this skill does.

## Usage
\`\`\`
my-skill.execute(param1, param2)
\`\`\`
```

## Development

### Code Quality

```bash
# Type checking
pnpm type-check

# Build
pnpm build

# Run linter
pnpm lint
```

### Testing

```bash
# Unit tests
pnpm test

# Test coverage
pnpm test:coverage
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
