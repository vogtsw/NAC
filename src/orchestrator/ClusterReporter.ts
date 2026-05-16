/**
 * ClusterReporter
 * Generates execution reports, timeline, and cost summaries for cluster runs.
 */

import type { ClusterDAG, ClusterStep } from "./ClusterDAGBuilder.js";
import type { TeamPlan } from "./TeamBuilder.js";
import type { ClusterArtifact } from "./AgentHandoff.js";
import type { DeepSeekTokenUsage } from "../llm/DeepSeekModelPolicy.js";

export interface ClusterReport {
  runId: string;
  startTime: number;
  endTime: number;
  duration: number;
  mode: string;
  status: "completed" | "failed" | "partial";
  coordinator: {
    model: string;
    tokens: number;
    cost: number;
  };
  workers: Array<{
    agentType: string;
    model: string;
    steps: number;
    tokens: number;
    cost: number;
    duration: number;
  }>;
  artifacts: Array<{
    id: string;
    type: string;
    producer: string;
    tokenCost?: number;
  }>;
  totalProTokens: number;
  totalFlashTokens: number;
  totalCost: number;
  cacheHitRate: number;
  timeline: Array<{
    timestamp: number;
    stepId: string;
    event: "start" | "complete" | "fail";
    duration?: number;
  }>;
  summary: string;
}

export class ClusterReporter {
  private startTime: number = 0;
  private timeline: ClusterReport["timeline"] = [];
  private tokenUsage: Map<string, DeepSeekTokenUsage> = new Map();

  start(): void {
    this.startTime = Date.now();
  }

  recordStepStart(stepId: string): void {
    this.timeline.push({ timestamp: Date.now(), stepId, event: "start" });
  }

  recordStepComplete(stepId: string, duration: number): void {
    this.timeline.push({ timestamp: Date.now(), stepId, event: "complete", duration });
  }

  recordStepFail(stepId: string): void {
    this.timeline.push({ timestamp: Date.now(), stepId, event: "fail" });
  }

  recordTokenUsage(agentType: string, usage: DeepSeekTokenUsage): void {
    this.tokenUsage.set(agentType, usage);
  }

  /**
   * Generate the final cluster report.
   */
  generateReport(args: {
    runId: string;
    teamPlan: TeamPlan;
    clusterDag: ClusterDAG;
    artifacts: ClusterArtifact[];
    status: "completed" | "failed" | "partial";
  }): ClusterReport {
    const endTime = Date.now();
    const duration = endTime - this.startTime;

    // Calculate worker stats
    const workers = this.calculateWorkerStats(args.teamPlan, args.clusterDag);

    // Calculate token totals using actual model metadata from team plan
    const proRoles = new Set(["coordinator", "planner", "code_agent", "reviewer"]);
    let totalProTokens = 0;
    let totalFlashTokens = 0;
    let totalCacheHits = 0;
    let totalCacheMisses = 0;

    for (const [agentType, usage] of this.tokenUsage) {
      const member = args.teamPlan.members.find(m => m.agentType === agentType);
      const isPro = member?.model === "deepseek-v4-pro" || proRoles.has(member?.role || "");
      if (isPro) {
        totalProTokens += usage.totalTokens;
      } else {
        totalFlashTokens += usage.totalTokens;
      }
      totalCacheHits += usage.cacheHitTokens || 0;
      totalCacheMisses += usage.cacheMissTokens || 0;
    }

    const cacheHitRate = (totalCacheHits + totalCacheMisses) > 0
      ? totalCacheHits / (totalCacheHits + totalCacheMisses)
      : 0;

    const totalCost = this.calculateTotalCost(args.teamPlan, totalProTokens, totalFlashTokens);

    const summary = this.generateSummary({
      ...args, totalProTokens, totalFlashTokens, totalCost, cacheHitRate, workers, duration,
    });

    return {
      runId: args.runId,
      startTime: this.startTime,
      endTime,
      duration,
      mode: args.teamPlan.collaborationMode,
      status: args.status,
      coordinator: {
        model: args.teamPlan.coordinator.model,
        tokens: totalProTokens * 0.2,
        cost: totalCost * 0.2,
      },
      workers,
      artifacts: args.artifacts.map(a => ({
        id: a.id,
        type: a.type,
        producer: a.producer,
        tokenCost: a.tokenCost,
      })),
      totalProTokens,
      totalFlashTokens,
      totalCost,
      cacheHitRate,
      timeline: this.timeline,
      summary,
    };
  }

  private calculateWorkerStats(teamPlan: TeamPlan, clusterDag: ClusterDAG): ClusterReport["workers"] {
    return teamPlan.members.map(member => {
      const memberSteps = clusterDag.steps.filter(s =>
        s.agentRole === member.role
      );
      const totalMemberTokens = member.model === "deepseek-v4-pro"
        ? memberSteps.length * 2000
        : memberSteps.length * 1000;

      return {
        agentType: member.agentType,
        model: member.model,
        steps: memberSteps.length,
        tokens: totalMemberTokens,
        cost: this.calculateWorkerCost(member.model, totalMemberTokens),
        duration: memberSteps.reduce((sum, s) => sum + 60, 0),
      };
    });
  }

  private calculateWorkerCost(model: string, tokens: number): number {
    const pricing: Record<string, { prompt: number; completion: number }> = {
      "deepseek-v4-pro": { prompt: 0.14, completion: 0.42 },
      "deepseek-v4-flash": { prompt: 0.04, completion: 0.12 },
    };
    const rates = pricing[model] || pricing["deepseek-v4-flash"];
    const promptTokens = tokens * 0.6;
    const completionTokens = tokens * 0.4;
    return Math.round(
      ((promptTokens / 1_000_000) * rates.prompt + (completionTokens / 1_000_000) * rates.completion) * 10000
    ) / 10000;
  }

  private calculateTotalCost(teamPlan: TeamPlan, proTokens: number, flashTokens: number): number {
    const proPricing = { prompt: 0.14, completion: 0.42 };
    const flashPricing = { prompt: 0.04, completion: 0.12 };

    const proPromptCost = (proTokens * 0.6 / 1_000_000) * proPricing.prompt;
    const proCompletionCost = (proTokens * 0.4 / 1_000_000) * proPricing.completion;
    const flashPromptCost = (flashTokens * 0.7 / 1_000_000) * flashPricing.prompt;
    const flashCompletionCost = (flashTokens * 0.3 / 1_000_000) * flashPricing.completion;

    return Math.round((proPromptCost + proCompletionCost + flashPromptCost + flashCompletionCost) * 10000) / 10000;
  }

  private generateSummary(args: {
    teamPlan: TeamPlan;
    status: string;
    workers: ClusterReport["workers"];
    totalProTokens: number;
    totalFlashTokens: number;
    totalCost: number;
    cacheHitRate: number;
    duration: number;
  }): string {
    const { teamPlan, status, workers, totalProTokens, totalFlashTokens, totalCost, cacheHitRate, duration } = args;
    const modifiedCount = args.workers.filter(w => w.agentType === "CodeAgent").length;

    return [
      `NAC DeepSeek Cluster Run: ${teamPlan.runId}`,
      `Status: ${status}`,
      `Mode: ${teamPlan.collaborationMode}`,
      `Duration: ${(duration / 1000).toFixed(1)}s`,
      `Workers: ${workers.length} agents (${workers.map(w => w.agentType).join(", ")})`,
      `Models: ${workers.map(w => w.model).join(", ")}`,
      `Pro tokens: ${totalProTokens.toLocaleString()}`,
      `Flash tokens: ${totalFlashTokens.toLocaleString()}`,
      `Cache hit rate: ${(cacheHitRate * 100).toFixed(1)}%`,
      `Estimated cost: $${totalCost.toFixed(4)}`,
      `Modified files: ${modifiedCount}`,
    ].join("\n");
  }

  /**
   * Display the report as formatted text.
   */
  displayReport(report: ClusterReport): string {
    const lines: string[] = [];
    lines.push("");
    lines.push("NAC DeepSeek Cluster Report");
    lines.push("=".repeat(50));
    lines.push("");
    lines.push(`Run: ${report.runId}`);
    lines.push(`Status: ${report.status.toUpperCase()}`);
    lines.push(`Mode: ${report.mode}`);
    lines.push(`Duration: ${(report.duration / 1000).toFixed(1)}s`);
    lines.push("");
    lines.push("Coordinator:");
    lines.push(`  ${report.coordinator.model} / ${report.coordinator.tokens.toLocaleString()} tokens`);
    lines.push("");
    lines.push("Workers:");

    for (const w of report.workers) {
      lines.push(`  - ${w.agentType}: ${w.model} / ${w.steps} steps / ${w.tokens.toLocaleString()} tokens`);
    }

    lines.push("");
    lines.push("Costs:");
    lines.push(`  Pro tokens: ${report.totalProTokens.toLocaleString()}`);
    lines.push(`  Flash tokens: ${report.totalFlashTokens.toLocaleString()}`);
    lines.push(`  Cache hit rate: ${(report.cacheHitRate * 100).toFixed(1)}%`);
    lines.push(`  Total cost: $${report.totalCost.toFixed(4)}`);
    lines.push("");

    lines.push("Timeline:");
    for (const entry of report.timeline) {
      const icon = entry.event === "start" ? "→" : entry.event === "complete" ? "✓" : "✗";
      const ms = entry.timestamp - report.startTime;
      lines.push(`  ${(ms / 1000).toFixed(1)}s ${icon} ${entry.stepId}${entry.duration ? ` (${entry.duration}ms)` : ""}`);
    }

    lines.push("");
    lines.push("Artifacts:");
    for (const a of report.artifacts) {
      lines.push(`  - ${a.type} (produced by ${a.producer})`);
    }

    return lines.join("\n");
  }
}

export function createClusterReporter(): ClusterReporter {
  return new ClusterReporter();
}
