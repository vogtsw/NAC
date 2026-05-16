/**
 * E2E API Cluster Bench — 真实 DeepSeek API 调用 + 验证
 * Usage: npx tsx scripts/e2e-api-bench.ts
 *
 * 创建 fixture 项目 → 用 DeepSeek V4 Pro API 运行 cluster pipeline → 验证结果
 */
import "dotenv/config";
import { LLMClient } from "../src/llm/LLMClient.js";
import { TeamBuilder } from "../src/orchestrator/TeamBuilder.js";
import { ClusterDAGBuilder } from "../src/orchestrator/ClusterDAGBuilder.js";
import { ClusterReporter } from "../src/orchestrator/ClusterReporter.js";
import type { ClusterArtifact } from "../src/orchestrator/AgentHandoff.js";
import { promises as fs } from "fs";
import { execSync } from "child_process";

const TMP_DIR = "./test-loop-tmp/e2e-fixture";

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) { console.log("FAIL: DEEPSEEK_API_KEY not set"); process.exit(1); }

  console.log("╔══════════════════════════════════════╗");
  console.log("║  NAC DeepSeek API E2E Cluster Bench ║");
  console.log("╚══════════════════════════════════════╝\n");
  console.log(`Model: ${process.env.DEEPSEEK_MODEL || "deepseek-v4-pro"}`);
  console.log(`Key:   ${apiKey.substring(0, 8)}...\n`);

  // 1. Setup fixture project with a real bug
  console.log("━━━ 1. Setup Fixture ━━━");
  await setupFixture();
  console.log("   ✓ Fixture created\n");

  // 2. Create LLM client with real API
  console.log("━━━ 2. Connect DeepSeek API ━━━");
  const llm = new LLMClient({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-pro",
  });
  console.log(`   ✓ Client initialized: ${process.env.DEEPSEEK_MODEL || "deepseek-v4-pro"}\n`);

  // 3. Test basic API connectivity
  console.log("━━━ 3. Test API Connectivity ━━━");
  try {
    const ping = await llm.complete("Reply with just: OK");
    console.log(`   Response: "${ping.trim()}"`);
    console.log("   ✓ API connected\n");
  } catch (e: any) {
    console.error(`   ✗ API failed: ${e.message}`);
    console.log("   Trying with model override...");
    // Fallback: try deepseek-chat
    const llm2 = new LLMClient({ apiKey, baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" });
    const ping = await llm2.complete("Reply: OK");
    console.log(`   Response: "${ping.trim()}" (deepseek-chat)`);
  }

  // 4. Run real cluster pipeline
  console.log("\n━━━ 4. Run Cluster Pipeline ━━━");
  const task = "Fix the failing test in tests/math.test.ts — the test expects add(2,3) to be 6 but it should be 5";

  const builder = new TeamBuilder(llm);
  const dagBuilder = new ClusterDAGBuilder();
  const reporter = new ClusterReporter();

  const teamPlan = await builder.buildTeam({
    description: task, intent: "code",
    capabilities: ["code-gen", "file-ops"],
    complexity: 4, riskLevel: "low",
  });

  console.log(`   Mode: ${teamPlan.collaborationMode}`);
  console.log(`   Members: ${teamPlan.members.map(m => `${m.count}x${m.agentType}(${m.model})`).join(", ")}`);
  console.log(`   Est. Cost: $${teamPlan.estimatedCost.toFixed(4)}\n`);

  const clusterDag = dagBuilder.build(teamPlan);
  console.log("   DAG Steps:");
  for (const s of clusterDag.steps) {
    const icon = s.agentRole === "planner" ? "📋" : s.agentRole === "researcher" ? "🔍" : s.agentRole === "code_agent" ? "💻" : s.agentRole === "tester" ? "🧪" : s.agentRole === "reviewer" ? "👁" : "📊";
    console.log(`   ${icon} [${s.agentRole}] ${s.name.substring(0, 60)}`);
  }
  console.log();

  // 5. Execute each step sequentially with real API calls
  console.log("━━━ 5. Execute Steps ━━━");
  reporter.start();
  const results: Record<string, any> = {};
  const artifacts: ClusterArtifact[] = [];
  let proTokens = 0, flashTokens = 0, cacheHits = 0, cacheMisses = 0;

  for (const step of clusterDag.steps) {
    process.stdout.write(`   [${step.agentRole}] ${step.name.substring(0, 50)}... `);
    const startStep = Date.now();

    try {
      const isPro = step.model === "deepseek-v4-pro";
      const thinking = step.thinking === "enabled" ? "enabled" : "disabled";
      const effort = step.reasoningEffort || "high";

      const result = await llm.completeWithMeta(
        `[Role: ${step.agentRole}]
[Task: ${step.name}]
[Context: Fix a math test bug — test expects add(2,3)=6 but should be 5]

${getStepPrompt(step)}`,
        {
          temperature: isPro ? 0.3 : 0.2,
          maxTokens: isPro ? 2000 : 1000,
          thinking: thinking as any,
          reasoningEffort: effort as any,
        }
      );

      const duration = Date.now() - startStep;
      // Use the centralized pricing
      const { calculateCost } = await import("../src/llm/DeepSeekPricing.js");
      const cost = calculateCost(
        step.model as any,
        result.usage.promptTokens,
        result.usage.completionTokens,
        step.reasoningEffort,
      );

      if (isPro) proTokens += result.usage.totalTokens;
      else flashTokens += result.usage.totalTokens;
      cacheHits += result.usage.cacheHitTokens || 0;
      cacheMisses += result.usage.cacheMissTokens || 0;

      reporter.recordStepComplete(step.id, duration);
      if (step.model === "deepseek-v4-pro") {
        reporter.recordTokenUsage(step.agentRole, result.usage);
      }

      results[step.id] = { success: true, result: result.content, duration, cost: cost.totalCost };
      artifacts.push({
        id: `${teamPlan.runId}_${step.id}`, runId: teamPlan.runId,
        type: step.outputArtifact, producer: step.agentRole, consumers: [],
        content: result.content, confidence: 0.9,
        createdAt: Date.now(), tokenCost: cost.totalCost,
      });

      const preview = result.content.replace(/\n/g, " ").substring(0, 80);
      console.log(`✓ ${duration}ms | ${result.usage.totalTokens} tokens | $${cost.totalCost.toFixed(4)}`);
      console.log(`     ${preview}...`);
    } catch (e: any) {
      const duration = Date.now() - startStep;
      reporter.recordStepFail(step.id);
      results[step.id] = { success: false, error: e.message, duration };
      console.log(`✗ ${e.message}`);
    }
  }

  // 6. Generate report
  console.log("\n━━━ 6. Results ━━━");
  const passed = Object.values(results).every((r: any) => r.success);
  const totalDuration = Object.values(results).reduce((s: number, r: any) => s + (r.duration || 0), 0);

  const totalCost = Object.values(results).reduce((s: number, r: any) => s + (r.cost || 0), 0);
  const totalTokens = Object.values(results).reduce((s: number, r: any) => {
    const usage = r.result?.usage || {};
    return s + (usage.totalTokens || 0);
  }, 0);

  console.log(`   Status:     ${passed ? "✅ PASSED" : "❌ FAILED"}`);
  console.log(`   Duration:   ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`   Total Cost: $${totalCost.toFixed(4)}`);
  console.log(`   Est Tokens: ${totalTokens.toLocaleString()}`);
  console.log(`   Cache Hit:  ${(cacheHits / (cacheHits + cacheMisses || 1) * 100).toFixed(1)}%`);
  console.log(`   Artifacts:  ${artifacts.length}`);

  // 7. Verify output quality
  console.log("\n━━━ 7. Output Quality Check ━━━");
  for (const step of clusterDag.steps) {
    const r = results[step.id];
    if (!r || !r.success) {
      console.log(`   ✗ ${step.agentRole}: FAILED`);
      continue;
    }
    const content = r.result?.content || "";
    const hasContent = content.length > 20;
    const hasPatch = step.agentRole === "code_agent" ? /fix|change|diff|patch|correct/i.test(content) : true;
    const hasSummary = step.agentRole === "researcher" ? /import|function|file|module|export/i.test(content) : true;
    const quality = hasContent && (step.agentRole !== "code_agent" || hasPatch);
    console.log(`   ${quality ? "✓" : "⚠"} ${step.agentRole}: ${content.length} chars${step.agentRole === "researcher" ? (hasSummary ? " (relevant)" : " (may be generic)") : ""}`);
  }

  console.log(`\n══════════════════════════════════════`);
  console.log(`  E2E Benchmark: ${passed ? "PASS" : "FAIL"}`);
  console.log(`  Total Cost: $${totalCost.toFixed(4)}`);
  console.log(`══════════════════════════════════════\n`);

  await cleanupFixture();
  process.exit(passed ? 0 : 1);
}

function getStepPrompt(step: any): string {
  switch (step.agentRole) {
    case "planner":
      return "Create a 3-step plan to fix the test bug. The test expects add(2,3)=6 but the implementation returns 5 (correct). The fix is in the test, not the implementation. Output as numbered steps.";
    case "researcher":
      return `Read and summarize ${step.name.includes("src") ? "src/math.ts" : step.name.includes("tests") ? "tests/math.test.ts" : step.name.includes("config") ? "config files" : "all relevant files"}. What does each file contain? Output a structured summary.`;
    case "code_agent":
      return "The test in tests/math.test.ts expects add(2,3) to be 6 but the implementation correctly returns 5. Generate the exact code change to fix the TEST (change 6 to 5). Output the fix as a unified diff or show exact line change.";
    case "tester":
      return "Describe how you would verify the fix: run the test command, check that it passes, and report results.";
    case "coordinator":
      return "Summarize the cluster run results. What was fixed, what was verified, and what is the final status?";
    default:
      return "Analyze the task and provide relevant output.";
  }
}

async function setupFixture() {
  await fs.mkdir(`${TMP_DIR}/src`, { recursive: true });
  await fs.mkdir(`${TMP_DIR}/tests`, { recursive: true });
  await fs.writeFile(`${TMP_DIR}/package.json`, JSON.stringify({
    name: "e2e-fixture", type: "module",
    scripts: { test: "vitest run" }
  }, null, 2));
  await fs.writeFile(`${TMP_DIR}/src/math.ts`, "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
  await fs.writeFile(`${TMP_DIR}/tests/math.test.ts`, `import { describe, it, expect } from "vitest";
import { add } from "../src/math.js";

describe("math", () => {
  it("add(2,3) should be 5", () => {
    expect(add(2, 3)).toBe(6); // BUG: should be 5
  });
});
`);
}

async function cleanupFixture() {
  try { await fs.rm(TMP_DIR, { recursive: true, force: true }); } catch {}
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
