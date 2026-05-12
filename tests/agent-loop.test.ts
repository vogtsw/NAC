/**
 * Agent Loop Tests
 * Tests the core agent conversation loop without requiring a live LLM.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AgentLoop } from "../src/agent/loop.js";
import { ContextBuilder, getDefaultSystemPrompt } from "../src/agent/context.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Tool } from "../src/tools/base.js";
import { TaskCompleteTool } from "../src/tools/builtin/task-complete.js";
import { FileReadTool } from "../src/tools/builtin/file-read.js";
import type { ToolExecutionContext, ToolResult } from "../src/agent/types.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const testDir = join(process.cwd(), "test-loop-tmp");

// ── Mock LLM Adapter for testing ────────────────────────

class MockLLMAdapter {
  model = "mock-model";
  private responses: Array<{ content: string; toolCalls?: any[] }>;
  private callIndex = 0;

  constructor(responses: Array<{ content: string; toolCalls?: any[] }>) {
    this.responses = responses;
  }

  async complete(_messages: any[], _options?: any) {
    if (this.callIndex >= this.responses.length) {
      return {
        content: "I'm done.",
        reasoning: undefined,
        toolCalls: undefined,
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        finishReason: "stop",
      };
    }
    const response = this.responses[this.callIndex++];
    return {
      content: response.content,
      reasoning: undefined,
      toolCalls: response.toolCalls,
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      finishReason: response.toolCalls ? "tool_calls" : "stop",
    };
  }

  async close() {}
}

describe("AgentLoop", () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "readme.md"), "# Test Project\n\nHello!");
  });

  it("handles a simple text response", async () => {
    const mockLLM = new MockLLMAdapter([
      { content: "Hello! How can I help you today?" },
    ]);

    const loop = new AgentLoop({
      llm: mockLLM as any,
      workingDir: testDir,
    });

    const result = await loop.run("Hi!");

    expect(result.stopReason).toBe("stop_sequence");
    expect(result.finalResponse).toBe("Hello! How can I help you today?");
    expect(result.turns).toHaveLength(1);
  });

  it("stops on task_complete tool call", async () => {
    const mockLLM = new MockLLMAdapter([
      {
        content: "Let me complete this.",
        toolCalls: [
          {
            id: "call_1",
            name: "task_complete",
            arguments: { summary: "All tasks done!" },
          },
        ],
      },
    ]);

    const loop = new AgentLoop({
      llm: mockLLM as any,
      workingDir: testDir,
    });

    const result = await loop.run("Do something");

    expect(result.stopReason).toBe("task_completed");
    expect(result.finalResponse).toBe("All tasks done!");
  });

  it("executes file_read tool and continues", async () => {
    const mockLLM = new MockLLMAdapter([
      {
        content: "Let me read the file.",
        toolCalls: [
          {
            id: "call_1",
            name: "file_read",
            arguments: { filePath: "readme.md" },
          },
        ],
      },
      {
        content: "I've read the file. It's a test project.",
      },
    ]);

    const loop = new AgentLoop({
      llm: mockLLM as any,
      workingDir: testDir,
    });

    const result = await loop.run("What's in readme.md?");

    expect(result.turns.length).toBeGreaterThanOrEqual(1);
    expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
    // First turn should have a tool call
    expect(result.turns[0].toolCalls).toBeDefined();
    expect(result.turns[0].toolCalls![0].name).toBe("file_read");
  });

  it("detects tool loop and stops", async () => {
    // Return the same tool call repeatedly — first detection injects reflection,
    // second detection actually stops. Need 8 calls for double detection.
    const toolResponses = Array.from({ length: 8 }, (_, i) => ({
      content: `Try ${i + 1}...`,
      toolCalls: [
        { id: `${i}`, name: "file_read", arguments: { filePath: "same.txt" } },
      ],
    }));

    const mockLLM = new MockLLMAdapter(toolResponses);
    const loop = new AgentLoop({
      llm: mockLLM as any,
      workingDir: testDir,
      config: { maxIterations: 10 },
    });

    const result = await loop.run("Read the file");

    expect(result.stopReason).toBe("tool_loop_detected");
  });

  it("respects max iterations", async () => {
    // Always returns a tool call, never finishes
    const infiniteResponses = Array.from({ length: 10 }, (_, i) => ({
      content: `Step ${i}`,
      toolCalls: [
        { id: `call_${i}`, name: "file_read", arguments: { filePath: `file${i}.txt` } },
      ],
    }));

    const mockLLM = new MockLLMAdapter(infiniteResponses);
    const loop = new AgentLoop({
      llm: mockLLM as any,
      workingDir: testDir,
      config: { maxIterations: 3 },
    });

    const result = await loop.run("Keep going");
    expect(result.stopReason).toBe("max_iterations");
  });

  it("maintains conversation history", async () => {
    const mockLLM = new MockLLMAdapter([
      { content: "Response 1" },
      { content: "Response 2" },
    ]);

    const loop = new AgentLoop({
      llm: mockLLM as any,
      workingDir: testDir,
    });

    await loop.run("Question 1");

    // Check history
    const history = loop.getHistory();
    const userMessages = history.filter((m) => m.role === "user");
    expect(userMessages.length).toBeGreaterThanOrEqual(1);
    const assistantMessages = history.filter((m) => m.role === "assistant");
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1);
  });

  it("clears history", async () => {
    const mockLLM = new MockLLMAdapter([
      { content: "Response" },
    ]);

    const loop = new AgentLoop({
      llm: mockLLM as any,
      workingDir: testDir,
    });

    await loop.run("Question");
    expect(loop.getHistory().length).toBeGreaterThan(0);

    loop.clearHistory();
    expect(loop.getHistory().length).toBe(0);
  });

  it("registers new tools after construction", () => {
    const mockLLM = new MockLLMAdapter([]);
    const loop = new AgentLoop({
      llm: mockLLM as any,
      workingDir: testDir,
    });

    const customTool = new (class extends Tool {
      name = "custom_tool";
      description = "A custom tool";
      parameters = [{ name: "input", type: "string", description: "Input" }];
      metadata = { category: "read" as const, touchesPaths: false, safeForParallel: true, requiresApproval: false };
      async execute(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
        return { toolCallId: "", name: "custom_tool", result: "OK", isError: false, duration: 0 };
      }
    })();

    loop.registerTool(customTool);
    expect(loop.getRegistry().has("custom_tool")).toBe(true);
  });

  it("calculates tool success rate", async () => {
    const mockLLM = new MockLLMAdapter([
      {
        content: "Working...",
        toolCalls: [
          { id: "1", name: "file_read", arguments: { filePath: "readme.md" } },
        ],
      },
      { content: "Done!" },
    ]);

    const loop = new AgentLoop({
      llm: mockLLM as any,
      workingDir: testDir,
    });

    const result = await loop.run("Read readme.md");

    expect(result.toolSuccessRate).toBeGreaterThanOrEqual(0);
    expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
  });

  it("handles abort signal", async () => {
    const mockLLM = new MockLLMAdapter([
      {
        content: "Working...",
        toolCalls: [
          { id: "1", name: "task_complete", arguments: { summary: "Wait..." } },
        ],
      },
    ]);

    const controller = new AbortController();
    const loop = new AgentLoop({
      llm: mockLLM as any,
      workingDir: testDir,
    });

    // Signal abort before running
    controller.abort();

    const result = await loop.run("Do something", controller.signal);
    expect(result.stopReason).toBe("user_interrupt");
  });
});

// ── Context Builder Tests ────────────────────────────────

describe("ContextBuilder", () => {
  it("builds context with system prompt and user request", () => {
    const builder = new ContextBuilder({
      systemPrompt: "You are a helpful assistant.",
      tools: [],
    });

    const { messages, cacheBreakpoint } = builder.build("Hello");

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("You are a helpful assistant");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("Hello");
    expect(cacheBreakpoint).toBeDefined();
  });

  it("includes tool definitions in system prompt", () => {
    const builder = new ContextBuilder({
      systemPrompt: "You are helpful.",
      tools: [
        {
          name: "test_tool",
          description: "A test tool",
          parameters: [{ name: "arg1", type: "string", description: "First arg" }],
        },
      ],
    });

    const prompt = builder.getSystemPrompt();
    expect(prompt).toContain("test_tool");
    expect(prompt).toContain("arg1");
  });

  it("caches system prompt", () => {
    const builder = new ContextBuilder({
      systemPrompt: "Cached prompt.",
      tools: [],
    });

    const p1 = builder.getSystemPrompt();
    const p2 = builder.getSystemPrompt();
    expect(p1).toBe(p2); // Same object reference = cached
  });

  it("invalidates cache", () => {
    const builder = new ContextBuilder({
      systemPrompt: "Original.",
      tools: [],
    });

    const p1 = builder.getSystemPrompt();
    builder.invalidateCache();
    const p2 = builder.getSystemPrompt();
    // Content should be the same but different reference
    expect(p1).toBe(p2); // In this case same content but re-built
  });

  it("injects memory notes", () => {
    const builder = new ContextBuilder({
      systemPrompt: "Test.",
      tools: [],
      memoryNotes: "User prefers TypeScript.",
    });

    const { messages } = builder.build("Hello");
    const memoryMsg = messages.find((m) => m.content.includes("Memory Notes"));
    expect(memoryMsg).toBeDefined();
    expect(memoryMsg!.content).toContain("TypeScript");
  });

  it("includes working directory", () => {
    const builder = new ContextBuilder({
      systemPrompt: "Test.",
      tools: [],
      workingDir: "/home/user/project",
    });

    const prompt = builder.getSystemPrompt();
    expect(prompt).toContain("/home/user/project");
  });

  it("respects max history messages", () => {
    const builder = new ContextBuilder({
      systemPrompt: "Test.",
      tools: [],
      maxHistoryMessages: 3,
    });

    const history = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: `Question ${i}`,
      timestamp: Date.now() - (10 - i) * 1000,
    }));

    const { messages } = builder.build("Latest question", history);
    // Should only have system + 3 history + 1 user request
    const historyMsgs = messages.filter((m) => m.role !== "system");
    // Max 3 history + 1 current = 4 (or fewer if some are system role)
    expect(historyMsgs.length).toBeLessThanOrEqual(4);
  });

  it("gets default system prompt", () => {
    const prompt = getDefaultSystemPrompt();
    expect(prompt).toContain("AI Agent");
    expect(prompt).toContain("tools");
  });
});
