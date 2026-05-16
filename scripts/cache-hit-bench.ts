/**
 * Cache Hit Benchmark
 * Run the same task 2 times to measure DeepSeek KV cache hit improvement.
 * Expect: Run 2 should have higher cache hit rate than Run 1
 */
import "dotenv/config";
import OpenAI from "openai";

const API = process.env.DEEPSEEK_API_KEY!;
const client = new OpenAI({ apiKey: API, baseURL: "https://api.deepseek.com/v1" });

interface RunMetrics {
  run: number;
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  cacheHitRate: number;
  cost: number;
  durationMs: number;
}

async function runTask(label: string, model: string, sysPrompt: string, userMsg: string): Promise<RunMetrics> {
  const start = Date.now();
  const body: any = {
    model,
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: userMsg },
    ],
    temperature: 0.3,
    max_tokens: 500,
    ...(model === "deepseek-v4-pro" ? { thinking: { type: "enabled" }, reasoning_effort: "high" } : {}),
  };

  const resp = await client.chat.completions.create(body);
  const usage = resp.usage!;
  const hitTokens = (usage as any).prompt_tokens_details?.cached_tokens || 0;
  const missTokens = usage.prompt_tokens - hitTokens;
  const cost = model === "deepseek-v4-pro"
    ? (usage.prompt_tokens / 1e6) * 0.14 + (usage.completion_tokens / 1e6) * 0.42
    : (usage.prompt_tokens / 1e6) * 0.04 + (usage.completion_tokens / 1e6) * 0.12;

  return {
    run: 0,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    cacheHitTokens: hitTokens,
    cacheMissTokens: missTokens,
    cacheHitRate: usage.prompt_tokens > 0 ? hitTokens / usage.prompt_tokens : 0,
    cost: Math.round(cost * 1e6) / 1e6,
    durationMs: Date.now() - start,
  };
}

async function main() {
  if (!API) { console.log("DEEPSEEK_API_KEY required"); process.exit(1); }

  console.log("╔══════════════════════════════════════╗");
  console.log("║  DeepSeek KV Cache Hit Benchmark    ║");
  console.log("╚══════════════════════════════════════╝\n");

  const SYS = `You are a code analysis assistant. Analyze the following code and provide a summary.
The project is a TypeScript agent framework called NAC/JIQUN.
It implements multi-agent orchestration with DAG-based scheduling.
Key modules: Orchestrator, TeamBuilder, ClusterDAGBuilder, AgentHandoff, ClusterReporter.
Tools: git, patch, test-runner, diagnostics, agent-spawn, mcp-bridge.
DeepSeek V4 models: deepseek-v4-pro (1.6T/49B) and deepseek-v4-flash (284B/13B).`;

  const USER = "Summarize the key architecture decisions in the NAC agent framework in 3 bullet points.";

  const results: RunMetrics[] = [];

  // Test Flash (cheap, good for cache)
  console.log("📊 Flash Model — Cache Test\n");
  for (let i = 1; i <= 3; i++) {
    process.stdout.write(`  Run ${i}... `);
    const m = await runTask(`flash-${i}`, "deepseek-v4-flash", SYS, USER);
    m.run = i;
    results.push(m);
    console.log(`${m.promptTokens}p/${m.completionTokens}c | cache: ${(m.cacheHitRate*100).toFixed(0)}% | ${m.durationMs}ms | $${m.cost.toFixed(4)}`);
  }

  // Test Pro (high reasoning, larger)
  console.log("\n📊 Pro Model — Cache Test\n");
  for (let i = 1; i <= 2; i++) {
    process.stdout.write(`  Run ${i}... `);
    const m = await runTask(`pro-${i}`, "deepseek-v4-pro", SYS, USER);
    m.run = i;
    results.push(m);
    console.log(`${m.promptTokens}p/${m.completionTokens}c | cache: ${(m.cacheHitRate*100).toFixed(0)}% | ${m.durationMs}ms | $${m.cost.toFixed(4)}`);
  }

  // Analysis
  console.log("\n═══ Cache Hit Analysis ═══\n");

  const flashRuns = results.filter(r => r.run <= 3);
  const proRuns = results.filter(r => r.run > 3);

  for (const group of [["Flash", flashRuns], ["Pro", proRuns]]) {
    const [name, runs] = group as [string, RunMetrics[]];
    if (runs.length < 2) continue;

    const firstHit = runs[0].cacheHitRate;
    const avgLater = runs.slice(1).reduce((s, r) => s + r.cacheHitRate, 0) / (runs.length - 1);
    const firstCost = runs[0].cost;
    const avgLaterCost = runs.slice(1).reduce((s, r) => s + r.cost, 0) / (runs.length - 1);

    console.log(`  ${name}:`);
    console.log(`    Run 1 cache hit:  ${(firstHit * 100).toFixed(1)}%`);
    console.log(`    Avg later hit:    ${(avgLater * 100).toFixed(1)}%`);
    console.log(`    Improvement:      ${((avgLater - firstHit) * 100).toFixed(1)}pp`);
    console.log(`    Run 1 cost:       $${firstCost.toFixed(4)}`);
    console.log(`    Avg later cost:   $${avgLaterCost.toFixed(4)}`);
    console.log(`    Cost reduction:   ${((1 - avgLaterCost / firstCost) * 100).toFixed(1)}%`);
    console.log();
  }

  const totalCost = results.reduce((s, r) => s + r.cost, 0);
  console.log(`  Total cost: $${totalCost.toFixed(4)}`);
  console.log(`  Cache friendly prompt design: ${results[1]?.cacheHitRate > 0 ? "✅ Working" : "⚠ May need stable prefix optimization"}`);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
