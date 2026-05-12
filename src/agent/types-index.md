# Agent Harness Type Index

> Auto-generated from `src/agent/types.ts`.  
> Core types for the Agent Harness — defines the message/tool/turn/state primitives that the agent loop operates on.

---

## ── Messages ──────────────────────────────────────────────

### `TextContent`

Represents a plain-text segment within a message's content array.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"text"` | Discriminant literal |
| `text` | `string` | The actual text content |

---

### `ToolCallContent`

Represents a tool invocation embedded within a message's content array.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"tool_call"` | Discriminant literal |
| `id` | `string` | Unique identifier for this tool call |
| `name` | `string` | Name of the tool being called |
| `arguments` | `Record<string, unknown>` | Arguments passed to the tool |

---

### `ToolResultContent`

Represents the result of a tool execution embedded within a message's content array.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"tool_result"` | Discriminant literal |
| `toolCallId` | `string` | ID linking back to the originating `ToolCallContent` |
| `name` | `string` | Name of the tool that was executed |
| `result` | `string` | String-serialised result of the tool execution |
| `isError?` | `boolean` | Whether the tool returned an error (optional) |

---

### `MessageContent`

Union type of all possible content blocks within a message.

```ts
type MessageContent = TextContent | ToolCallContent | ToolResultContent;
```

---

### `Message`

A single message in the conversation history.

| Field | Type | Description |
|-------|------|-------------|
| `role` | `"system" \| "user" \| "assistant" \| "tool"` | Who sent the message |
| `content` | `string \| MessageContent[]` | Either a plain string or an array of structured content blocks |
| `timestamp?` | `number` | Optional Unix timestamp of when the message was created |

---

## ── Tools ──────────────────────────────────────────────────

### `ToolParamDef`

Describes a single parameter of a tool.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Parameter name |
| `type` | `string` | JSON Schema type string (e.g. `"string"`, `"number"`) |
| `description` | `string` | Human-readable description of the parameter |
| `required?` | `boolean` | Whether the parameter is required |
| `default?` | `unknown` | Default value if not supplied |
| `enum?` | `string[]` | Allowed values (for enum parameters) |
| `items?` | `{ type: string }` | Item schema for array-type parameters |
| `properties?` | `Record<string, ToolParamDef>` | Child properties for object-type parameters |

---

### `ToolDefinition`

The full definition of a registered tool.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique tool name |
| `description` | `string` | Human-readable description of what the tool does |
| `parameters` | `ToolParamDef[]` | Array of parameter definitions |
| `safeForParallel?` | `boolean` | Whether this tool is safe to parallelize with other safe tools |
| `requiresApproval?` | `boolean` | Whether this tool requires human approval before execution |
| `jsonSchema?` | `Record<string, unknown>` | Schema as JSON Schema object (generated at registration time) |

---

### `ToolCall`

Represents an invocation of a tool by the agent.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier for this call |
| `name` | `string` | Name of the tool being called |
| `arguments` | `Record<string, unknown>` | Arguments passed to the tool |

---

### `ToolResult`

The result produced by executing a tool.

| Field | Type | Description |
|-------|------|-------------|
| `toolCallId` | `string` | ID linking back to the originating `ToolCall` |
| `name` | `string` | Name of the tool that was executed |
| `result` | `string` | String-serialised result |
| `isError` | `boolean` | Whether the tool returned an error |
| `duration` | `number` | Execution time in milliseconds |
| `metadata?` | `Record<string, unknown>` | Optional additional metadata about the execution |

---

### `ToolExecutorFn`

Function signature for a tool's implementation.

```ts
(args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `args` | `Record<string, unknown>` | Arguments passed to the tool |
| `context` | `ToolExecutionContext` | Execution context provided by the harness |
| **returns** | `Promise<ToolResult>` | The result of the tool execution |

---

### `ToolExecutionContext`

Context provided to a tool executor at runtime.

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | `string` | The current session identifier |
| `workingDir` | `string` | The working directory for file operations |
| `approvedPaths` | `Set<string>` | Set of file paths the tool is allowed to access |
| `signal?` | `AbortSignal` | Optional abort signal for cancellation support |

---

## ── Agent Loop ─────────────────────────────────────────────

### `AgentConfig`

Configuration for the agent.

| Field | Type | Description |
|-------|------|-------------|
| `model` | `string` | Model identifier (e.g. `"deepseek-chat"`) |
| `provider` | `"deepseek" \| "openai" \| "custom"` | LLM provider |
| `baseUrl?` | `string` | Custom base URL for the API |
| `apiKey?` | `string` | API key for authentication |
| `maxIterations` | `number` | Maximum number of reasoning/action turns |
| `temperature` | `number` | Sampling temperature for the LLM |
| `maxTokens` | `number` | Maximum tokens per LLM response |
| `systemPrompt?` | `string` | Optional custom system prompt |
| `skills?` | `string[]` | List of skill names the agent can use |
| `workingDir?` | `string` | Working directory for the agent |

---

### `AgentTurn`

A single turn in the agent's reasoning loop.

| Field | Type | Description |
|-------|------|-------------|
| `index` | `number` | Turn number (0-based) |
| `messages` | `Message[]` | Messages exchanged during this turn |
| `toolCalls?` | `ToolCall[]` | Tool calls made this turn |
| `toolResults?` | `ToolResult[]` | Results of tool calls this turn |
| `llmResponse?` | `string` | Raw LLM response text |
| `reasoning?` | `string` | Model's reasoning/chain-of-thought |
| `duration` | `number` | Duration of the turn in milliseconds |
| `tokenUsage?` | `TokenUsage` | Token usage for this turn |

---

### `TokenUsage`

Token consumption statistics.

| Field | Type | Description |
|-------|------|-------------|
| `promptTokens` | `number` | Number of tokens in the prompt |
| `completionTokens` | `number` | Number of tokens in the completion |
| `totalTokens` | `number` | Total tokens used |
| `cachedPromptTokens?` | `number` | Number of prompt tokens served from cache |

---

### `AgentStopReason`

Union of reasons why the agent loop stopped.

```ts
type AgentStopReason =
  | "stop_sequence"       // model returned stop
  | "max_iterations"      // hit iteration limit
  | "tool_loop_detected"  // repeated tool calls detected
  | "user_interrupt"      // user cancelled
  | "error"               // unrecoverable error
  | "task_completed";     // explicit completion tool called
```

---

### `AgentResult`

The final result of an agent run.

| Field | Type | Description |
|-------|------|-------------|
| `turns` | `AgentTurn[]` | All turns taken during the run |
| `stopReason` | `AgentStopReason` | Why the agent stopped |
| `finalResponse` | `string` | The agent's final response to the user |
| `totalDuration` | `number` | Total duration in milliseconds |
| `totalTokens` | `TokenUsage` | Aggregated token usage across all turns |
| `toolCallCount` | `number` | Total number of tool calls made |
| `toolSuccessRate` | `number` | Fraction of tool calls that succeeded (0–1) |

---

## ── Session ────────────────────────────────────────────────

### `SessionState`

Persistent state for an agent session.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique session identifier |
| `status` | `"active" \| "completed" \| "failed" \| "compressed"` | Current status of the session |
| `parentSessionId?` | `string` | ID of the parent session (for branching/forking) |
| `messages` | `Message[]` | Full message history for the session |
| `createdAt` | `number` | Unix timestamp of creation |
| `updatedAt` | `number` | Unix timestamp of last update |
| `metadata` | `Record<string, unknown>` | Arbitrary metadata attached to the session |

---

## ── Memory ─────────────────────────────────────────────────

### `MemoryEntry`

A single entry in the agent's long-term memory store.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique memory entry identifier |
| `type` | `"fact" \| "preference" \| "pattern" \| "feedback"` | Classification of the memory |
| `content` | `string` | The stored content |
| `source` | `string` | Origin of the memory (e.g. tool name, user) |
| `confidence` | `number` | Confidence score (0–1) |
| `createdAt` | `number` | Unix timestamp of creation |
| `lastAccessedAt` | `number` | Unix timestamp of last access |
| `accessCount` | `number` | Number of times this entry has been accessed |
| `tags` | `string[]` | Tags for categorization and retrieval |

---

## ── Trajectory (for evaluation / SFT data) ─────────────────

### `TrajectoryStep`

A single step within a trajectory (used for evaluation and supervised fine-tuning data).

| Field | Type | Description |
|-------|------|-------------|
| `stepIndex` | `number` | 0-based step number |
| `observation` | `string` | What the agent observed at this step |
| `reasoning` | `string` | The agent's reasoning at this step |
| `action` | `{ tool: string; args: Record<string, unknown> } \| null` | The action taken (null if no action) |
| `result` | `string` | The result of the action |
| `isError` | `boolean` | Whether the step resulted in an error |
| `duration` | `number` | Duration of the step in milliseconds |

---

### `Trajectory`

A full trajectory of an agent run (used for evaluation and supervised fine-tuning data).

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique trajectory identifier |
| `sessionId` | `string` | ID of the session this trajectory belongs to |
| `task` | `string` | The task description |
| `steps` | `TrajectoryStep[]` | Ordered list of steps |
| `outcome` | `"success" \| "failure" \| "partial"` | Overall outcome of the trajectory |
| `totalSteps` | `number` | Total number of steps |
| `totalDuration` | `number` | Total duration in milliseconds |
| `annotations?` | `TrajectoryAnnotation[]` | Optional human/auto annotations |
| `createdAt` | `number` | Unix timestamp of creation |

---

### `TrajectoryAnnotation`

An annotation attached to a trajectory.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"score" \| "label" \| "correction"` | Kind of annotation |
| `value` | `string \| number` | The annotation value |
| `annotator` | `"human" \| "auto" \| "llm"` | Who or what created the annotation |
| `timestamp` | `number` | Unix timestamp when the annotation was made |

---

## ── Eval Metrics ───────────────────────────────────────────

### `EvalMetrics`

Aggregated evaluation metrics across multiple trajectories.

| Field | Type | Description |
|-------|------|-------------|
| `taskCompletionRate` | `number` | Fraction of tasks completed successfully (0–1) |
| `toolCallSuccessRate` | `number` | Fraction of tool calls that succeeded (0–1) |
| `avgIterationsPerTask` | `number` | Average number of iterations per task |
| `avgTokensPerTask` | `number` | Average token usage per task |
| `avgDurationPerTask` | `number` | Average duration per task in milliseconds |
| `trajectoryCount` | `number` | Total number of trajectories recorded |
| `annotatedTrajectoryCount` | `number` | Number of trajectories that have annotations |

---

### `FeedbackEntry`

A single piece of feedback on a task run.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique feedback identifier |
| `sessionId` | `string` | ID of the session this feedback is for |
| `task` | `string` | The task description |
| `rating` | `number` | Numeric rating |
| `issues` | `string[]` | List of issues identified |
| `suggestions` | `string[]` | List of suggestions for improvement |
| `timestamp` | `number` | Unix timestamp when the feedback was created |

---

## Summary Table

| # | Type | Kind | Section |
|---|------|------|---------|
| 1 | `TextContent` | interface | Messages |
| 2 | `ToolCallContent` | interface | Messages |
| 3 | `ToolResultContent` | interface | Messages |
| 4 | `MessageContent` | type alias (union) | Messages |
| 5 | `Message` | interface | Messages |
| 6 | `ToolParamDef` | interface | Tools |
| 7 | `ToolDefinition` | interface | Tools |
| 8 | `ToolCall` | interface | Tools |
| 9 | `ToolResult` | interface | Tools |
| 10 | `ToolExecutorFn` | interface (callable) | Tools |
| 11 | `ToolExecutionContext` | interface | Tools |
| 12 | `AgentConfig` | interface | Agent Loop |
| 13 | `AgentTurn` | interface | Agent Loop |
| 14 | `TokenUsage` | interface | Agent Loop |
| 15 | `AgentStopReason` | type alias (union) | Agent Loop |
| 16 | `AgentResult` | interface | Agent Loop |
| 17 | `SessionState` | interface | Session |
| 18 | `MemoryEntry` | interface | Memory |
| 19 | `TrajectoryStep` | interface | Trajectory |
| 20 | `Trajectory` | interface | Trajectory |
| 21 | `TrajectoryAnnotation` | interface | Trajectory |
| 22 | `EvalMetrics` | interface | Eval Metrics |
| 23 | `FeedbackEntry` | interface | Eval Metrics |

> **Total: 23 types** (21 interfaces, 2 type aliases)
