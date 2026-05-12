/**
 * Tool System Tests
 * Tests for the tool registry, executor, and built-in tools.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../src/tools/registry.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { Tool, createFunctionTool } from "../src/tools/base.js";
import { FileReadTool } from "../src/tools/builtin/file-read.js";
import { FileWriteTool } from "../src/tools/builtin/file-write.js";
import { FileEditTool } from "../src/tools/builtin/file-edit.js";
import { GlobTool } from "../src/tools/builtin/glob.js";
import { GrepTool } from "../src/tools/builtin/grep.js";
import { BashTool } from "../src/tools/builtin/bash.js";
import { TaskCompleteTool } from "../src/tools/builtin/task-complete.js";
import { getBuiltinTools } from "../src/tools/builtin/index.js";
import type { ToolExecutionContext } from "../src/agent/types.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const testDir = join(process.cwd(), "test-tmp");
const testCtx: ToolExecutionContext = {
  sessionId: "test-session",
  workingDir: testDir,
  approvedPaths: new Set([testDir]),
};

// ── Tool Registry Tests ──────────────────────────────────

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("registers a tool", () => {
    const tool = new FileReadTool();
    registry.register(tool);
    expect(registry.has("file_read")).toBe(true);
    expect(registry.size).toBe(1);
  });

  it("prevents duplicate registration", () => {
    const tool = new FileReadTool();
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow("already registered");
  });

  it("registers all built-in tools", () => {
    registry.registerAll(getBuiltinTools());
    expect(registry.size).toBe(8);
    expect(registry.has("file_read")).toBe(true);
    expect(registry.has("file_write")).toBe(true);
    expect(registry.has("file_edit")).toBe(true);
    expect(registry.has("glob")).toBe(true);
    expect(registry.has("grep")).toBe(true);
    expect(registry.has("bash")).toBe(true);
    expect(registry.has("delegate")).toBe(true);
    expect(registry.has("task_complete")).toBe(true);
  });

  it("generates OpenAI-compatible tool definitions", () => {
    registry.register(new FileReadTool());
    const tools = registry.toOpenAITools();
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe("function");
    expect((tools[0] as any).function.name).toBe("file_read");
  });

  it("classifies parallel-safe tools", () => {
    registry.registerAll(getBuiltinTools());
    const safe = registry.getParallelSafeTools();
    expect(safe).toContain("file_read");
    expect(safe).toContain("glob");
    expect(safe).toContain("grep");
    // file_write and file_edit are NOT safe for parallel
    expect(safe).not.toContain("file_write");
    expect(safe).not.toContain("file_edit");
  });

  it("classifies approval-required tools", () => {
    registry.registerAll(getBuiltinTools());
    const approval = registry.getApprovalRequiredTools();
    expect(approval).toContain("bash");
    expect(approval).toContain("file_write");
    expect(approval).toContain("file_edit");
    expect(approval).not.toContain("file_read");
  });

  it("unregisters a tool", () => {
    registry.register(new FileReadTool());
    expect(registry.has("file_read")).toBe(true);
    registry.unregister("file_read");
    expect(registry.has("file_read")).toBe(false);
    expect(registry.size).toBe(0);
  });

  it("creates function tools from plain functions", () => {
    const tool = createFunctionTool(
      "test_tool",
      "A test tool",
      [{ name: "input", type: "string", description: "The input" }],
      async (args) => `Got: ${args.input}`
    );

    expect(tool.name).toBe("test_tool");
    expect(tool.toJSONSchema()).toHaveProperty("properties.input");
  });

  it("iterates tools", () => {
    registry.register(new FileReadTool());
    registry.register(new GlobTool());
    const names: string[] = [];
    for (const tool of registry) {
      names.push(tool.name);
    }
    expect(names).toContain("file_read");
    expect(names).toContain("glob");
  });
});

// ── Tool Executor Tests ─────────────────────────────────

describe("ToolExecutor", () => {
  let registry: ToolRegistry;
  let executor: ToolExecutor;

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.registerAll(getBuiltinTools());
    executor = new ToolExecutor(registry);
  });

  it("executes a single tool call", async () => {
    const result = await executor.execute(
      [{ id: "1", name: "glob", arguments: { pattern: "*.ts", path: "src" } }],
      testCtx
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("glob");
    // Should not error (tool executed)
    expect(typeof result[0].result).toBe("string");
  });

  it("returns error for unknown tool", async () => {
    const result = await executor.execute(
      [{ id: "1", name: "nonexistent_tool", arguments: {} }],
      testCtx
    );
    expect(result[0].isError).toBe(true);
    expect(result[0].result).toContain("Unknown tool");
  });

  it("returns error for unknown tool", async () => {
    const result = await executor.execute(
      [{ id: "2", name: "unknown_tool", arguments: {} }],
      testCtx
    );
    expect(result[0].isError).toBe(true);
  });
});

// ── Built-in Tool Tests ─────────────────────────────────

describe("Built-in Tools", () => {
  beforeEach(() => {
    // Setup test directory
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "test.txt"), "Hello World\nLine 2\nLine 3\n");
    writeFileSync(join(testDir, "test.ts"), "const x = 1;\nfunction foo() {}\n");
  });

  // FileRead
  it("FileReadTool reads a file", async () => {
    const tool = new FileReadTool();
    const result = await tool.execute(
      { filePath: "test.txt" },
      testCtx
    );
    expect(result.isError).toBe(false);
    expect(result.result).toContain("Hello World");
    // Should include line numbers
    expect(result.result).toContain("1\t");
  });

  it("FileReadTool reads with offset and limit", async () => {
    const tool = new FileReadTool();
    const result = await tool.execute(
      { filePath: "test.txt", offset: 2, limit: 1 },
      testCtx
    );
    expect(result.isError).toBe(false);
    expect(result.result).toContain("Line 2");
    expect(result.result).not.toContain("Hello World");
  });

  it("FileReadTool blocks reads outside working directory", async () => {
    const tool = new FileReadTool();
    const result = await tool.execute(
      { filePath: "../../etc/passwd" },
      testCtx
    );
    expect(result.isError).toBe(true);
    expect(result.result).toContain("Access denied");
  });

  it("FileReadTool errors on directory", async () => {
    const tool = new FileReadTool();
    const result = await tool.execute(
      { filePath: "." },
      testCtx
    );
    expect(result.isError).toBe(true);
    expect(result.result).toContain("directory");
  });

  // FileWrite
  it("FileWriteTool writes a file", async () => {
    const tool = new FileWriteTool();
    const result = await tool.execute(
      { filePath: "output.txt", content: "test output" },
      testCtx
    );
    expect(result.isError).toBe(false);

    // Verify file was written
    const readTool = new FileReadTool();
    const readResult = await readTool.execute(
      { filePath: "output.txt" },
      testCtx
    );
    expect(readResult.result).toContain("test output");
  });

  it("FileWriteTool blocks writes outside working directory", async () => {
    const tool = new FileWriteTool();
    const result = await tool.execute(
      { filePath: "../outside.txt", content: "test" },
      testCtx
    );
    expect(result.isError).toBe(true);
    expect(result.result).toContain("Access denied");
  });

  // FileEdit
  it("FileEditTool replaces exact string", async () => {
    const tool = new FileEditTool();
    const result = await tool.execute(
      { filePath: "test.txt", oldString: "Hello World", newString: "Hi World" },
      testCtx
    );
    expect(result.isError).toBe(false);
    expect(result.result).toContain("1 replacement");

    // Verify
    const readTool = new FileReadTool();
    const readResult = await readTool.execute(
      { filePath: "test.txt" },
      testCtx
    );
    expect(readResult.result).toContain("Hi World");
    expect(readResult.result).not.toContain("Hello World");
  });

  it("FileEditTool errors on non-unique match", async () => {
    writeFileSync(join(testDir, "dup.txt"), "hello\ntest\nhello\n");
    const tool = new FileEditTool();
    const result = await tool.execute(
      { filePath: "dup.txt", oldString: "hello", newString: "hi" },
      testCtx
    );
    expect(result.isError).toBe(true);
    expect(result.result).toContain("Found 2 occurrences");
  });

  it("FileEditTool replaceAll replaces all occurrences", async () => {
    writeFileSync(join(testDir, "dup.txt"), "hello\nworld\nhello\n");
    const tool = new FileEditTool();
    const result = await tool.execute(
      { filePath: "dup.txt", oldString: "hello", newString: "hi", replaceAll: true },
      testCtx
    );
    expect(result.isError).toBe(false);
    expect(result.result).toContain("2 replacements");
  });

  // Glob
  it("GlobTool finds matching files", async () => {
    const tool = new GlobTool();
    const result = await tool.execute(
      { pattern: "*.txt", path: "." },
      { ...testCtx, workingDir: testDir }
    );
    expect(result.isError).toBe(false);
    expect(result.result).toContain("test.txt");
  });

  it("GlobTool returns no matches message when nothing found", async () => {
    const tool = new GlobTool();
    const result = await tool.execute(
      { pattern: "*.xyz", path: "." },
      { ...testCtx, workingDir: testDir }
    );
    expect(result.isError).toBe(false);
    expect(result.result).toContain("No files matched");
  });

  // Grep
  it("GrepTool finds patterns in files", async () => {
    const tool = new GrepTool();
    const result = await tool.execute(
      { pattern: "Hello", path: "." },
      { ...testCtx, workingDir: testDir }
    );
    expect(result.isError).toBe(false);
    expect(result.result).toContain("Hello");
  });

  it("GrepTool finds no matches for missing pattern", async () => {
    const tool = new GrepTool();
    const result = await tool.execute(
      { pattern: "ZZZNOTFOUNDZZZ", path: "." },
      { ...testCtx, workingDir: testDir }
    );
    expect(result.result).toContain("No matches found");
  });

  // Bash
  it("BashTool executes a simple command", async () => {
    const tool = new BashTool();
    const result = await tool.execute(
      { command: "echo HELLO_BASH_TEST", timeout: 5000 },
      testCtx
    );
    expect(result.isError).toBe(false);
    expect(result.result).toContain("HELLO_BASH_TEST");
  });

  it("BashTool blocks dangerous commands", async () => {
    const tool = new BashTool();
    const result = await tool.execute(
      { command: "rm -rf /", timeout: 5000 },
      testCtx
    );
    expect(result.isError).toBe(true);
    expect(result.result).toContain("Blocked dangerous command");
  });

  // TaskComplete
  it("TaskCompleteTool returns summary", async () => {
    const tool = new TaskCompleteTool();
    const result = await tool.execute(
      { summary: "All done!", artifacts: ["file1.ts"] },
      testCtx
    );
    expect(result.isError).toBe(false);
    expect(result.result).toBe("All done!");
    expect(result.metadata?.completed).toBe(true);
  });

  // Cleanup
  it("cleanup test directory", () => {
    rmSync(testDir, { recursive: true, force: true });
  });
});
