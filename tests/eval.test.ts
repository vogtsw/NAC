/**
 * Evaluation & Trajectory System Tests
 * Tests the evaluation metrics, trajectory recording, and feedback systems.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  TrajectoryRecorder,
  EvalMetricsCalculator,
} from "../src/eval/metrics.js";
import type { AgentResult, AgentTurn, FeedbackEntry } from "../src/agent/types.js";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

const testTrajDir = join(process.cwd(), "test-trajectories");

function createMockResult(
  turns: AgentTurn[],
  stopReason: AgentResult["stopReason"] = "task_completed",
  toolCallCount: number = 0,
  toolSuccessRate: number = 1
): AgentResult {
  return {
    turns,
    stopReason,
    finalResponse: "Done!",
    totalDuration: 5000,
    totalTokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    toolCallCount,
    toolSuccessRate,
  };
}

function createMockTurn(
  toolName: string,
  args: Record<string, unknown>,
  result: string,
  isError: boolean = false,
  reasoning: string = ""
): AgentTurn {
  return {
    index: 0,
    messages: [],
    toolCalls: [{ id: "1", name: toolName, arguments: args }],
    toolResults: [
      {
        toolCallId: "1",
        name: toolName,
        result,
        isError,
        duration: 100,
      },
    ],
    llmResponse: reasoning || "Processing...",
    reasoning,
    duration: 200,
    tokenUsage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
  };
}

describe("TrajectoryRecorder", () => {
  let recorder: TrajectoryRecorder;

  beforeEach(() => {
    rmSync(testTrajDir, { recursive: true, force: true });
    mkdirSync(testTrajDir, { recursive: true });
    recorder = new TrajectoryRecorder(testTrajDir);
  });

  it("records a successful trajectory", () => {
    const turns = [
      createMockTurn("file_read", { filePath: "test.ts" }, "file contents"),
      createMockTurn("file_edit", { filePath: "test.ts", oldString: "a", newString: "b" }, "File edited"),
    ];
    const result = createMockResult(turns, "task_completed", 2, 1);

    const traj = recorder.record("s1", "Fix the bug in test.ts", result);

    expect(traj.sessionId).toBe("s1");
    expect(traj.task).toBe("Fix the bug in test.ts");
    expect(traj.outcome).toBe("success");
    expect(traj.steps).toHaveLength(2);
    expect(traj.totalSteps).toBe(2);
    expect(traj.totalDuration).toBe(5000);
  });

  it("records a failed trajectory", () => {
    const turns = [
      createMockTurn("bash", { command: "bad" }, "command failed", true),
    ];
    const result = createMockResult(turns, "error", 1, 0);

    const traj = recorder.record("s2", "Run a command", result);

    expect(traj.outcome).toBe("failure");
    expect(traj.steps[0].isError).toBe(true);
  });

  it("records a partial trajectory for max_iterations", () => {
    const result = createMockResult([], "max_iterations");
    const traj = recorder.record("s3", "Incomplete task", result);

    expect(traj.outcome).toBe("partial");
  });

  it("annotates a trajectory", () => {
    const result = createMockResult([], "task_completed");
    recorder.record("s4", "test", result);

    const annotated = recorder.annotate(
      recorder.list()[0].id,
      {
        type: "score",
        value: 4,
        annotator: "human",
        timestamp: Date.now(),
      }
    );

    expect(annotated).toBe(true);
    const traj = recorder.list()[0];
    expect(traj.annotations).toHaveLength(1);
    expect(traj.annotations![0].value).toBe(4);
  });

  it("exports trajectories for SFT training data", () => {
    const turns = [
      createMockTurn(
        "file_read",
        { filePath: "src/app.ts" },
        "const app = express();",
        false,
        "Reading the main app file to understand the structure"
      ),
      createMockTurn(
        "file_edit",
        { filePath: "src/app.ts", oldString: "express()", newString: "express().use(cors())" },
        "File edited",
        false,
        "Adding CORS middleware"
      ),
    ];
    const result = createMockResult(turns, "task_completed", 2, 1);
    const traj = recorder.record("s5", "Add CORS to the app", result);

    // Annotate with good score so it passes the quality filter
    recorder.annotate(traj.id, {
      type: "score",
      value: 5,
      annotator: "human",
      timestamp: Date.now(),
    });

    const sftData = recorder.exportForSFT();
    expect(sftData.length).toBeGreaterThanOrEqual(1);
    expect(sftData[0].messages[0].role).toBe("user");
    expect(sftData[0].messages[0].content).toBe("Add CORS to the app");
  });

  it("returns null for unknown trajectory", () => {
    expect(recorder.get("nonexistent")).toBeNull();
  });

  it("lists trajectories", () => {
    recorder.record("s1", "task1", createMockResult([], "task_completed"));
    recorder.record("s2", "task2", createMockResult([], "task_completed"));

    expect(recorder.list()).toHaveLength(2);
  });
});

describe("EvalMetricsCalculator", () => {
  let recorder: TrajectoryRecorder;
  let calculator: EvalMetricsCalculator;

  beforeEach(() => {
    rmSync(testTrajDir, { recursive: true, force: true });
    mkdirSync(testTrajDir, { recursive: true });
    recorder = new TrajectoryRecorder(testTrajDir);
    calculator = new EvalMetricsCalculator(recorder);
  });

  it("calculates metrics from trajectories", () => {
    // Record a mix of successful and failed trajectories
    const successTurn = createMockTurn("file_read", { filePath: "a.ts" }, "content");
    recorder.record("s1", "task1", createMockResult([successTurn], "task_completed", 1, 1));
    recorder.record("s2", "task2", createMockResult([successTurn], "task_completed", 1, 1));
    recorder.record("s3", "task3", createMockResult(
      [createMockTurn("bash", { command: "x" }, "error", true)],
      "error", 1, 0
    ));

    const metrics = calculator.calculate();

    expect(metrics.taskCompletionRate).toBeGreaterThan(0.5); // 2/3
    expect(metrics.toolCallSuccessRate).toBeGreaterThan(0.5);
    expect(metrics.trajectoryCount).toBe(3);
    expect(metrics.avgIterationsPerTask).toBeGreaterThan(0);
    expect(metrics.avgDurationPerTask).toBeGreaterThan(0);
  });

  it("handles empty trajectory list", () => {
    const metrics = calculator.calculate();
    expect(metrics.trajectoryCount).toBe(0);
    expect(metrics.taskCompletionRate).toBe(0);
    expect(metrics.toolCallSuccessRate).toBe(1); // no tools = perfect
  });

  it("gets tool-level breakdown", () => {
    recorder.record(
      "s1",
      "task",
      createMockResult(
        [
          createMockTurn("file_read", { filePath: "a.ts" }, "ok"),
          createMockTurn("file_edit", { filePath: "a.ts", oldString: "a", newString: "b" }, "ok"),
          createMockTurn("bash", { command: "cmd" }, "error", true),
        ],
        "task_completed", 3, 2/3
      )
    );

    const breakdown = calculator.getToolBreakdown();

    const fileRead = breakdown.get("file_read");
    expect(fileRead).toBeDefined();
    expect(fileRead!.calls).toBe(1);
    expect(fileRead!.failures).toBe(0);

    const bash = breakdown.get("bash");
    expect(bash).toBeDefined();
    expect(bash!.failures).toBe(1);
  });

  it("analyzes failure modes", () => {
    recorder.record(
      "s1",
      "read a missing file",
      createMockResult(
        [createMockTurn("file_read", { filePath: "gone.ts" }, "ENOENT: no such file", true)],
        "error", 1, 0
      )
    );

    recorder.record(
      "s2",
      "access denied path",
      createMockResult(
        [createMockTurn("file_read", { filePath: "../secret" }, "Access denied", true)],
        "error", 1, 0
      )
    );

    const failureModes = calculator.getFailureModes();

    expect(failureModes.length).toBeGreaterThan(0);
    const fileNotFound = failureModes.find((m) => m.mode === "file_not_found");
    const permissionErr = failureModes.find((m) => m.mode === "permission_error");
    expect(fileNotFound || permissionErr).toBeTruthy();
  });

  it("records and analyzes feedback", () => {
    const feedback: FeedbackEntry = {
      id: "fb1",
      sessionId: "s1",
      task: "Fix the login bug",
      rating: 3,
      issues: ["tool_error", "wrong_solution"],
      suggestions: ["Add better error messages"],
      timestamp: Date.now(),
    };

    calculator.recordFeedback(feedback);

    const stats = calculator.getFeedbackStats();
    expect(stats.totalFeedback).toBe(1);
    expect(stats.avgRating).toBe(3);
    expect(stats.commonIssues).toContain("tool_error");
    expect(stats.commonIssues).toContain("wrong_solution");
  });

  it("generates a report", () => {
    const turn = createMockTurn("file_read", { filePath: "a.ts" }, "success");
    recorder.record("s1", "task", createMockResult([turn], "task_completed", 1, 1));

    const report = calculator.generateReport();
    expect(report).toContain("Agent Evaluation Report");
    expect(report).toContain("Task Completion Rate");
    expect(report).toContain("Tool Performance");
    expect(report).toContain("Failure Mode Analysis");
  });

  it("handles annotated trajectory counting", () => {
    const result = createMockResult([], "task_completed");
    const traj = recorder.record("s1", "task", result);
    recorder.annotate(traj.id, {
      type: "score",
      value: 5,
      annotator: "auto",
      timestamp: Date.now(),
    });

    const metrics = calculator.calculate();
    expect(metrics.annotatedTrajectoryCount).toBe(1);
  });
});
