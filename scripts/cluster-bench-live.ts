/**
 * Live Cluster Bench — Run a real DeepSeek API pipeline cluster benchmark.
 * Usage: npx tsx scripts/cluster-bench-live.ts [--mode pipeline|self-healing]
 */
import "dotenv/config";
import { LLMClient, type CompleteResult } from "../src/llm/LLMClient.js";
import { TeamBuilder, type TaskProfile } from "../src/orchestrator/TeamBuilder.js";
import { ClusterDAGBuilder } from "../src/orchestrator/ClusterDAGBuilder.js";
import { ClusterReporter } from "../src/orchestrator/ClusterReporter.js";
import type { ClusterArtifact } from "../src/orchestrator/AgentHandoff.js";
import { DAG } from "../src/orchestrator/DAGBuilder.js";
import { Scheduler } from "../src/orchestrator/Scheduler.js";
import { AgentFactory } from "../src/agents/AgentFactory.js";

interface BenchResult {
  scenario: string;
  mode: string;
  passed: boolean;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  proTokens: number;
  flashTokens: number;
  cacheHitRate: number;
  estimatedCost: number;
  durationMs: number;
  artifacts: string[];
  errors: string[];
}

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === "your_deepseek_api_key_here") {
    console.log("SKIP: No DeepSeek API key configured. Set DEEPSEEK_API_KEY in .env");
    console.log("Dry-run mode: testing framework without live API calls.");
    return await runDryRun();
  }

  console.log("=== NAC DeepSeek Cluster Live Bench ===\n");
  console.log(`Model: ${process.env.DEEPSEEK_MODEL || "deepseek-v4-pro"}`);
  console.log(`API: ${process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1"}\n`);

  const llm = new LLMClient({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-pro",
  });

  const builder = new TeamBuilder(llm);
  const dagBuilder = new ClusterDAGBuilder();
  const reporter = new ClusterReporter();
  const scheduler = new Scheduler(5);
  const factory = new AgentFactory(llm);

  const task: TaskProfile = {
    description: "Fix the failing auth test in tests/auth.test.ts — the validateToken function returns true for empty tokens",
    intent: "code",
    capabilities: ["code-gen", "file-ops", "test"],
    complexity: 6,
    riskLevel: "medium",
  };

  console.log("Task:", task.description, "\n");

  // 1. Build team
  console.log("1. Building team...");
  const teamPlan = await builder.buildTeam(task);
  console.log(`   Mode: ${teamPlan.collaborationMode}`);
  console.log(`   Coordinator: ${teamPlan.coordinator.model}`);
  console.log(`   Members: ${teamPlan.members.map(m => `${m.count}x ${m.agentType}`).join(", ")}`);
  console.log(`   Est. Cost: $${teamPlan.estimatedCost.toFixed(4)}\n`);

  // 2. Build DAG
  console.log("2. Building cluster DAG...");
  const clusterDag = dagBuilder.build(teamPlan);
  const execDag = dagBuilder.toExecutableDAG(clusterDag);
  console.log(`   Steps: ${clusterDag.steps.length}`);
  console.log(`   Max Parallelism: ${clusterDag.maxParallelism}\n`);

  // 3. Display DAG structure
  console.log("3. DAG Structure:");
  for (const step of clusterDag.steps) {
    console.log(`   [${step.agentRole}] ${step.name} (${step.model})`);
  }
  console.log();

  // 4. Execute
  console.log("4. Executing...");
  reporter.start();
  const startTime = Date.now();

  const taskResults: Record<string, any> = {};
  const artifacts: ClusterArtifact[] = [];

  try {
    const results = await scheduler.schedule(`bench_${Date.now()}`, execDag, {
      agentFactory: factory,
      sessionId: `bench_session`,
    });

    for (const [taskId, rawResult] of Object.entries(results)) {
      const result = rawResult as any;
      taskResults[taskId] = result;

      const step = clusterDag.steps.find(s => s.id === taskId);
      if (step) {
        reporter.recordStepStart(taskId);
        if (result.error) {
          reporter.recordStepFail(taskId);
        } else {
          reporter.recordStepComplete(taskId, result.duration || 0);
        }

        artifacts.push({
          id: `${teamPlan.runId}_${taskId}`,
          runId: teamPlan.runId,
          type: step.outputArtifact,
          producer: step.agentRole,
          consumers: clusterDag.steps.filter(s => s.dependencies.includes(taskId)).map(s => s.agentRole),
          content: result,
          confidence: result.error ? 0.3 : 0.9,
          createdAt: Date.now(),
        });
      }
    }
  } catch (error: any) {
    console.error(`   Execution error: ${error.message}`);
  }

  const duration = Date.now() - startTime;

  // 5. Generate report
  const results = Object.values(taskResults);
  const failedTasks = results.filter((r: any) => r.error);
  const passed = failedTasks.length === 0;

  const report = reporter.generateReport({
    runId: teamPlan.runId,
    teamPlan,
    clusterDag,
    artifacts,
    status: passed ? "completed" : "partial",
  });

  // 6. Output
  console.log("5. Results:\n");
  console.log(reporter.displayReport(report));

  const benchResult: BenchResult = {
    scenario: "cluster-001-pipeline",
    mode: teamPlan.collaborationMode,
    passed,
    totalTasks: clusterDag.steps.length,
    completedTasks: results.length - failedTasks.length,
    failedTasks: failedTasks.length,
    proTokens: report.totalProTokens,
    flashTokens: report.totalFlashTokens,
    cacheHitRate: report.cacheHitRate,
    estimatedCost: report.totalCost,
    durationMs: duration,
    artifacts: artifacts.map(a => `${a.type}(${a.producer})`),
    errors: failedTasks.map((t: any) => t.error).filter(Boolean),
  };

  console.log("\n=== Bench Result ===");
  console.log(JSON.stringify(benchResult, null, 2));

  console.log(`\nPassed: ${passed ? "YES" : "NO"}`);
  console.log(`Cost: $${report.totalCost.toFixed(4)}`);
  console.log(`Cache Hit: ${(report.cacheHitRate * 100).toFixed(1)}%`);

  process.exit(passed ? 0 : 1);
}

async function runDryRun() {
  console.log("=== NAC DeepSeek Cluster Dry-Run Bench ===\n");

  const mockLLM = { complete: async () => "mock", completeJSON: async () => ({ steps: [] }) } as any;
  const builder = new TeamBuilder(mockLLM);
  const dagBuilder = new ClusterDAGBuilder();

  const task: TaskProfile = {
    description: "Fix failing auth test", intent: "code",
    capabilities: ["code-gen"], complexity: 6,
  };

  const plan = await builder.buildTeam(task);
  const clusterDag = dagBuilder.build(plan);
  const execDag = dagBuilder.toExecutableDAG(clusterDag);

  console.log(`Mode: ${plan.collaborationMode}`);
  console.log(`Steps: ${clusterDag.steps.length}`);
  console.log(`Max Parallel: ${clusterDag.maxParallelism}`);
  console.log(`Executable: ${execDag.isComplete() ? "pending" : "ready"}`);
  console.log(`Est. Pro tokens: ${plan.estimatedProTokens.toLocaleString()}`);
  console.log(`Est. Flash tokens: ${plan.estimatedFlashTokens.toLocaleString()}`);
  console.log(`Est. Cost: $${plan.estimatedCost.toFixed(4)}`);

  console.log("\nAdd DEEPSEEK_API_KEY to .env for live API bench.");
  process.exit(0);
}

main().catch(console.error);
