# JIQUN — Agent Harness v2.0

## Project Overview

Agent Harness inspired by Claude Code and Hermes Agent. A single-agent conversation loop with Tool Use, Memory, and Evaluation systems. Built in TypeScript, runs on Node.js >=20.

## Architecture

```
src/
├── agent/
│   ├── loop.ts          # Core Agent Loop (the heart of the system)
│   ├── context.ts       # Context Builder with prompt caching
│   └── types.ts         # All type definitions
├── tools/
│   ├── base.ts          # Abstract Tool base class
│   ├── registry.ts      # Tool registration + discovery
│   ├── executor.ts      # Parallel/sequential tool execution
│   └── builtin/         # Built-in tools (bash, file_read, file_write, file_edit, glob, grep, task_complete)
├── llm/
│   ├── adapter.ts       # Abstract LLM interface (OpenAI-compatible)
│   └── providers/       # DeepSeek, OpenAI adapters
├── memory/
│   └── session-db.ts    # JSON-file session store with search index
├── eval/
│   └── metrics.ts       # Trajectory recording + eval metrics (agentjd capabilities)
├── cli/
│   └── main.ts          # Interactive CLI
└── index.ts             # Public API exports
```

## Key Design Principles

1. **Agent Loop First**: System prompt → LLM → parse response → execute tools → repeat. No premature DAG/multi-agent orchestration.
2. **Stable Prefix + Variable Suffix**: System prompt + tool defs are cached (stable prefix); history + user input are variable suffix.
3. **Tool-Native**: Every capability is a tool with JSON Schema, registered in the ToolRegistry. Tools are safe-for-parallel or require-approval tagged.
4. **Tool Loop Detection**: Same tool + same args 3+ times in a row = stop with `tool_loop_detected`.
5. **Evaluation Built-In**: Every run produces a trajectory for SFT data generation, tool breakdown analytics, and failure mode analysis.

## Development

```bash
npm install          # Install dependencies (pure JS, no native modules)
npm test             # Run all tests (80 tests, 4 suites)
npx tsx src/cli/main.ts  # Interactive CLI mode
```

## Testing

```bash
npm test             # All tests
npx vitest run tests/tools.test.ts     # Tool system (29 tests)
npx vitest run tests/agent-loop.test.ts # Agent loop + context (18 tests)
npx vitest run tests/memory.test.ts     # Session DB + search (19 tests)
npx vitest run tests/eval.test.ts       # Trajectory + eval metrics (14 tests)
```
