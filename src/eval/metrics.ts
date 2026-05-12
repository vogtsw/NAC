/**
 * Evaluation & Trajectory System
 *
 * This module embodies the agentjd.md core capabilities:
 * - Data-driven model optimization (SFT/RL data pipeline)
 * - Task success rate measurement and analysis
 * - Tool call success/failure analytics
 * - Full trajectory recording for training data
 * - User feedback collection and integration
 *
 * The system tracks every agent execution and produces structured data
 * that can be used for:
 * 1. Model evaluation (offline eval, A/B testing)
 * 2. Training data construction (SFT trajectories, RL reward signals)
 * 3. Failure analysis (why do tools fail? why does planning drift?)
 */

import { getSessionDB } from "../memory/session-db.js";
import type {
  AgentResult,
  AgentTurn,
  Trajectory,
  TrajectoryStep,
  TrajectoryAnnotation,
  EvalMetrics,
  FeedbackEntry,
  ToolResult,
} from "../agent/types.js";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

export class TrajectoryRecorder {
  private outputDir: string;
  private trajectories: Map<string, Trajectory> = new Map();

  constructor(outputDir?: string) {
    this.outputDir = outputDir || join(process.cwd(), "trajectories");
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Record a complete agent run as a trajectory.
   * This is the primary SFT/RL data generation pipeline.
   */
  record(
    sessionId: string,
    task: string,
    result: AgentResult
  ): Trajectory {
    const steps: TrajectoryStep[] = [];

    for (const turn of result.turns) {
      if (!turn.toolCalls) continue;

      for (let i = 0; i < turn.toolCalls.length; i++) {
        const tc = turn.toolCalls[i];
        const tr = turn.toolResults?.[i];

        steps.push({
          stepIndex: steps.length,
          observation: tr
            ? tr.result
            : "No observation available",
          reasoning: turn.reasoning || turn.llmResponse || "",
          action: {
            tool: tc.name,
            args: tc.arguments,
          },
          result: tr ? tr.result : "",
          isError: tr ? tr.isError : false,
          duration: turn.duration,
        });
      }
    }

    const trajectory: Trajectory = {
      id: `traj_${sessionId}_${Date.now()}`,
      sessionId,
      task,
      steps,
      outcome: result.stopReason === "task_completed" ? "success"
        : result.stopReason === "error" ? "failure"
        : "partial",
      totalSteps: steps.length,
      totalDuration: result.totalDuration,
      annotations: [],
      createdAt: Date.now(),
    };

    this.trajectories.set(trajectory.id, trajectory);
    this.saveToDisk(trajectory);

    return trajectory;
  }

  /**
   * Annotate a trajectory (human or automated feedback).
   */
  annotate(
    trajectoryId: string,
    annotation: TrajectoryAnnotation
  ): boolean {
    const traj = this.trajectories.get(trajectoryId);
    if (!traj) return false;

    traj.annotations = traj.annotations || [];
    traj.annotations.push(annotation);
    this.saveToDisk(traj);
    return true;
  }

  /**
   * Get a trajectory by ID.
   */
  get(trajectoryId: string): Trajectory | null {
    return this.trajectories.get(trajectoryId) || null;
  }

  /**
   * List all recorded trajectories.
   */
  list(limit: number = 100): Trajectory[] {
    return Array.from(this.trajectories.values()).slice(-limit);
  }

  /**
   * Export trajectories in a format suitable for SFT training data.
   */
  exportForSFT(): Array<{ messages: Array<{ role: string; content: string }> }> {
    const data: Array<{ messages: Array<{ role: string; content: string }> }> = [];

    for (const traj of this.trajectories.values()) {
      if (traj.annotations?.some((a) => a.type === "score" && Number(a.value) >= 3)) {
        const messages: Array<{ role: string; content: string }> = [];
        messages.push({ role: "user", content: traj.task });

        for (const step of traj.steps) {
          messages.push({
            role: "assistant",
            content: `[Tool: ${step.action?.tool}]\nArgs: ${JSON.stringify(step.action?.args)}\nReasoning: ${step.reasoning}`,
          });
          messages.push({
            role: "tool",
            content: step.result,
          });
        }

        messages.push({
          role: "assistant",
          content: traj.outcome === "success"
            ? "Task completed successfully."
            : "Task could not be completed.",
        });

        data.push({ messages });
      }
    }

    return data;
  }

  private saveToDisk(trajectory: Trajectory): void {
    const filePath = join(this.outputDir, `${trajectory.id}.json`);
    writeFileSync(filePath, JSON.stringify(trajectory, null, 2), "utf-8");
  }
}

// ── Eval Metrics Calculator ─────────────────────────────

export class EvalMetricsCalculator {
  private recorder: TrajectoryRecorder;
  private feedback: FeedbackEntry[] = [];
  private sessionDB = getSessionDB();

  constructor(recorder: TrajectoryRecorder) {
    this.recorder = recorder;
  }

  /**
   * Calculate comprehensive evaluation metrics.
   */
  calculate(): EvalMetrics {
    const trajectories = this.recorder.list(1000);
    const completedTasks = trajectories.filter(
      (t) => t.outcome === "success"
    );
    const failedTasks = trajectories.filter(
      (t) => t.outcome === "failure"
    );

    let totalToolCalls = 0;
    let failedToolCalls = 0;
    let totalIterations = 0;
    let totalDuration = 0;
    let annotatedCount = 0;

    for (const traj of trajectories) {
      totalToolCalls += traj.totalSteps;
      failedToolCalls += traj.steps.filter((s) => s.isError).length;
      totalIterations += traj.totalSteps;
      totalDuration += traj.totalDuration;
      if (traj.annotations && traj.annotations.length > 0) {
        annotatedCount++;
      }
    }

    const taskCompletionRate =
      trajectories.length > 0 ? completedTasks.length / trajectories.length : 0;

    const toolCallSuccessRate =
      totalToolCalls > 0
        ? (totalToolCalls - failedToolCalls) / totalToolCalls
        : 1;

    const avgIterationsPerTask =
      trajectories.length > 0 ? totalIterations / trajectories.length : 0;

    const avgDurationPerTask =
      trajectories.length > 0 ? totalDuration / trajectories.length : 0;

    return {
      taskCompletionRate: Math.round(taskCompletionRate * 100) / 100,
      toolCallSuccessRate: Math.round(toolCallSuccessRate * 100) / 100,
      avgIterationsPerTask: Math.round(avgIterationsPerTask * 10) / 10,
      avgTokensPerTask: 0, // Requires per-turn token tracking from LLM
      avgDurationPerTask: Math.round(avgDurationPerTask),
      trajectoryCount: trajectories.length,
      annotatedTrajectoryCount: annotatedCount,
    };
  }

  /**
   * Get tool-level success/failure breakdown.
   * This answers: "Why does the agent fail?" — agentjd.md core competency #2
   */
  getToolBreakdown(): Map<
    string,
    { calls: number; successes: number; failures: number; avgDuration: number }
  > {
    const breakdown = new Map<
      string,
      { calls: number; successes: number; failures: number; totalDuration: number }
    >();

    for (const traj of this.recorder.list(1000)) {
      for (const step of traj.steps) {
        if (!step.action) continue;
        const toolName = step.action.tool;
        const entry = breakdown.get(toolName) || {
          calls: 0,
          successes: 0,
          failures: 0,
          totalDuration: 0,
        };
        entry.calls++;
        if (step.isError) entry.failures++;
        else entry.successes++;
        entry.totalDuration += step.duration;
        breakdown.set(toolName, entry);
      }
    }

    // Add avgDuration
    const result = new Map<
      string,
      { calls: number; successes: number; failures: number; avgDuration: number }
    >();
    for (const [name, data] of breakdown) {
      result.set(name, {
        calls: data.calls,
        successes: data.successes,
        failures: data.failures,
        avgDuration: data.calls > 0 ? Math.round(data.totalDuration / data.calls) : 0,
      });
    }
    return result;
  }

  /**
   * Get failure mode analysis.
   * Categorizes failures to identify patterns: tool errors, planning issues, etc.
   * This is agentjd.md core competency #4: problem decomposition.
   */
  getFailureModes(): Array<{ mode: string; count: number; examples: string[] }> {
    const modes: Map<string, { count: number; examples: string[] }> = new Map();
    const failures = this.recorder.list(1000).filter((t) => t.outcome === "failure");

    for (const traj of failures) {
      for (const step of traj.steps) {
        if (!step.isError) continue;

        // Categorize the error
        let mode = "unknown_error";
        const result = step.result.toLowerCase();

        if (result.includes("not found") || result.includes("enoent")) {
          mode = "file_not_found";
        } else if (result.includes("permission") || result.includes("access denied")) {
          mode = "permission_error";
        } else if (result.includes("timeout")) {
          mode = "timeout";
        } else if (result.includes("syntax") || result.includes("invalid")) {
          mode = "invalid_input";
        } else if (result.includes("unknown tool")) {
          mode = "unknown_tool";
        } else if (result.includes("command not found")) {
          mode = "command_not_found";
        }

        const entry = modes.get(mode) || { count: 0, examples: [] };
        entry.count++;
        if (entry.examples.length < 3) {
          entry.examples.push(step.result.substring(0, 200));
        }
        modes.set(mode, entry);
      }
    }

    return Array.from(modes.entries())
      .map(([mode, data]) => ({ mode, ...data }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Record user feedback for a session.
   */
  recordFeedback(entry: FeedbackEntry): void {
    this.feedback.push(entry);

    // Also store in SessionDB for persistence
    this.sessionDB.addMemory({
      id: `feedback_${entry.id}`,
      type: "feedback",
      content: `Rating: ${entry.rating}/5. Task: ${entry.task}. Issues: ${entry.issues.join(", ")}. Suggestions: ${entry.suggestions.join(", ")}`,
      source: entry.sessionId,
      confidence: entry.rating / 5,
      createdAt: entry.timestamp,
      tags: ["feedback", ...entry.issues.map((i) => `issue:${i}`)],
    });
  }

  /**
   * Get feedback statistics.
   */
  getFeedbackStats(): {
    avgRating: number;
    totalFeedback: number;
    commonIssues: string[];
    recentFeedback: FeedbackEntry[];
  } {
    const ratings = this.feedback.map((f) => f.rating);
    const avgRating =
      ratings.length > 0
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : 0;

    const issueCount = new Map<string, number>();
    for (const fb of this.feedback) {
      for (const issue of fb.issues) {
        issueCount.set(issue, (issueCount.get(issue) || 0) + 1);
      }
    }

    const commonIssues = Array.from(issueCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([issue]) => issue);

    return {
      avgRating: Math.round(avgRating * 10) / 10,
      totalFeedback: this.feedback.length,
      commonIssues,
      recentFeedback: this.feedback.slice(-10),
    };
  }

  /**
   * Generate a full evaluation report.
   */
  generateReport(): string {
    const metrics = this.calculate();
    const toolBreakdown = this.getToolBreakdown();
    const failureModes = this.getFailureModes();
    const feedbackStats = this.getFeedbackStats();

    let report = "# Agent Evaluation Report\n\n";
    report += `Generated: ${new Date().toISOString()}\n\n`;

    report += "## Overall Metrics\n\n";
    report += `| Metric | Value |\n|--------|-------|\n`;
    report += `| Task Completion Rate | ${(metrics.taskCompletionRate * 100).toFixed(1)}% |\n`;
    report += `| Tool Call Success Rate | ${(metrics.toolCallSuccessRate * 100).toFixed(1)}% |\n`;
    report += `| Avg Iterations / Task | ${metrics.avgIterationsPerTask} |\n`;
    report += `| Avg Duration / Task | ${metrics.avgDurationPerTask}ms |\n`;
    report += `| Total Trajectories | ${metrics.trajectoryCount} |\n`;
    report += `| Annotated Trajectories | ${metrics.annotatedTrajectoryCount} |\n`;
    report += `| Avg User Rating | ${feedbackStats.avgRating}/5 |\n\n`;

    report += "## Tool Performance\n\n";
    report += `| Tool | Calls | Successes | Failures | Success Rate | Avg Duration |\n`;
    report += `|------|-------|-----------|----------|-------------|-------------|\n`;
    for (const [name, data] of toolBreakdown) {
      const rate = data.calls > 0 ? ((data.successes / data.calls) * 100).toFixed(1) : "N/A";
      report += `| ${name} | ${data.calls} | ${data.successes} | ${data.failures} | ${rate}% | ${data.avgDuration}ms |\n`;
    }

    report += "\n## Failure Mode Analysis\n\n";
    if (failureModes.length === 0) {
      report += "No failures recorded.\n";
    } else {
      for (const mode of failureModes) {
        report += `### ${mode.mode} (${mode.count} occurrences)\n`;
        for (const example of mode.examples) {
          report += `- ${example}\n`;
        }
        report += "\n";
      }
    }

    if (feedbackStats.commonIssues.length > 0) {
      report += "## Common User-Reported Issues\n\n";
      for (const issue of feedbackStats.commonIssues) {
        report += `- ${issue}\n`;
      }
    }

    return report;
  }
}

// ── Singleton ──────────────────────────────────────────────

let defaultRecorder: TrajectoryRecorder | null = null;
let defaultCalculator: EvalMetricsCalculator | null = null;

export function getTrajectoryRecorder(): TrajectoryRecorder {
  if (!defaultRecorder) {
    defaultRecorder = new TrajectoryRecorder();
  }
  return defaultRecorder;
}

export function getEvalCalculator(): EvalMetricsCalculator {
  if (!defaultCalculator) {
    defaultCalculator = new EvalMetricsCalculator(getTrajectoryRecorder());
  }
  return defaultCalculator;
}
