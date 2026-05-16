/**
 * SWE-bench Runner — evaluates NAC DeepSeek Agent on real SWE-bench instances.
 *
 * Usage:
 *   npx tsx scripts/swebench-run.ts --instance pallets__flask-4045
 *   npx tsx scripts/swebench-run.ts --repo pallets/flask --limit 2
 *   npx tsx scripts/swebench-run.ts --all --limit 5
 */
import "dotenv/config";
import { downloadDataset, getInstances, instanceSummary } from "../swebench/dataset";
import { evaluateInstance } from "../swebench/evaluator";
import type { SWEBenchEvalResult } from "../swebench/types";

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error("DEEPSEEK_API_KEY required in .env");
    process.exit(1);
  }

  // Parse args
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      flags[args[i]] = args[i + 1] || "true";
      if (args[i + 1] && !args[i + 1].startsWith("--")) i++;
    }
  }

  const instanceId = flags["--instance"] || "";
  const repoFilter = flags["--repo"] || "";
  const limit = parseInt(flags["--limit"] || "1");
  const model = flags["--model"] || "deepseek-v4-pro";

  // Load dataset
  console.log("Loading SWE-bench dataset...");
  const dataset = downloadDataset();
  console.log(`  ${dataset.length} instances available\n`);

  // Filter
  let instances = getInstances(dataset, {
    repo: repoFilter || undefined,
    limit: instanceId ? undefined : limit,
    instanceIds: instanceId ? [instanceId] : undefined,
  });

  if (instances.length === 0) {
    console.error("No matching instances found.");
    console.log("Available repos:", [...new Set(dataset.map(d => d.repo))].join(", "));
    process.exit(1);
  }

  console.log(`Evaluating ${instances.length} instance(s):`);
  for (const inst of instances) {
    console.log(`  ${instanceSummary(inst)}`);
  }

  // Evaluate
  const results: SWEBenchEvalResult[] = [];
  for (const inst of instances) {
    const result = await evaluateInstance(inst, { model, maxTurns: 8 });
    results.push(result);
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("SWE-BENCH RESULTS");
  console.log(`${"=".repeat(60)}`);
  const resolved = results.filter(r => r.resolved).length;
  const totalCost = results.reduce((s, r) => s + r.cost, 0);
  const totalTokens = results.reduce((s, r) => s + r.tokensUsed, 0);

  for (const r of results) {
    const icon = r.resolved ? "✅" : "❌";
    console.log(`  ${icon} ${r.instance_id}: F→P=${r.failToPassPassed}/${r.failToPass} P→P=${r.passToPassStillPass}/${r.passToPass} $${r.cost.toFixed(4)} ${Math.round(r.durationMs / 1000)}s`);
  }

  console.log(`\n  Resolved: ${resolved}/${results.length}`);
  console.log(`  Total Cost: $${totalCost.toFixed(4)}`);
  console.log(`  Total Tokens: ${totalTokens.toLocaleString()}`);
  console.log(`  Score: ${(resolved / results.length * 100).toFixed(1)}%`);
}

main().catch(e => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
