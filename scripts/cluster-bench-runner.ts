/**
 * Cluster Agent Benchmark Runner
 * 基于 SWE-bench / Claude eval / AgentBench 方法论设计
 *
 * 5 维度评分：正确性、工具使用、并行度、自愈能力、成本效率
 * Usage: npx tsx scripts/cluster-bench-runner.ts [--scenario all|swe|tool|parallel|self-heal|multi-agent]
 */
import "dotenv/config";
import { promises as fs, readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import OpenAI from "openai";

const API = process.env.DEEPSEEK_API_KEY!;
const PRO = "deepseek-v4-pro";
const FLASH = "deepseek-v4-flash";
const client = new OpenAI({ apiKey: API, baseURL: "https://api.deepseek.com/v1" });

const TMP = "./test-loop-tmp/bench";

// ═══ Tool Executor ═══
function tool(cwd: string, name: string, args: Record<string, any>): string {
  try {
    switch (name) {
      case "file_read": { const p = cwd + "/" + args.path; return existsSync(p) ? readFileSync(p, "utf-8") : "NOT_FOUND:" + args.path; }
      case "file_write": { const dir = cwd + "/" + (args.path || "").split("/").slice(0, -1).join("/"); try { mkdirSync(dir, { recursive: true }); } catch {} writeFileSync(cwd + "/" + args.path, args.content, "utf-8"); return "OK:" + args.content.length + "B"; }
      case "run_tests": {
        try {
          const o = execSync(args.command || "npx vitest run 2>&1", { cwd, encoding: "utf-8", timeout: 60000, maxBuffer: 5*1024*1024, env: {...process.env, CI:"true"} });
          const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/);
          return "PASS:"+(pm?.[1]||0)+" FAIL:"+(fm?.[1]||0);
        } catch(e: any) { const o = (e.stdout||"")+(e.stderr||""); const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/); return "PASS:"+(pm?.[1]||0)+" FAIL:"+(fm?.[1]||0); }
      }
      case "bash": case "run_command": {
        try { return execSync(args.command, { cwd, encoding: "utf-8", timeout: 30000, maxBuffer: 1024*1024 }) || "(ok)"; }
        catch(e: any) { return "EXIT:"+(e.status||1)+":"+ ((e.stderr||"")+(e.stdout||"")).substring(0, 300); }
      }
      case "grep_files": {
        try { return execSync(`grep -rn "${args.pattern}" ${cwd} --include="*.ts" 2>/dev/null || echo "(none)"`, { encoding: "utf-8", timeout: 5000 }); }
        catch { return "(none)"; }
      }
      case "task_complete": return "DONE:" + (args.result || "complete");
      default: return "ERROR:unknown:" + name;
    }
  } catch(e: any) { return "ERROR:" + e.message; }
}

// ═══ Agent Loop with Tool Use ═══
const TOOLS = "file_read(path) | file_write(path,content) | grep_files(pattern) | run_tests(command?) | bash(command) | task_complete(result)\nCall: ```json\n{\"tool\":\"<name>\",\"args\":{...}}\n```";

interface AgentResult { content: string; toolCalls: number; tokens: number; cost: number; durationMs: number; passed: boolean; }

async function runAgent(model: string, sys: string, task: string, cwd: string, maxT = 6): Promise<AgentResult> {
  const msgs: any[] = [{ role: "system", content: sys + "\n\n## Tools\n" + TOOLS }, { role: "user", content: task }];
  let tc = 0, totalT = 0, totalC = 0;
  const start = Date.now();

  for (let i = 0; i < maxT; i++) {
    const isPro = model === PRO;
    const b: any = { model, messages: msgs, temperature: 0.3, max_tokens: 2000 };
    if (isPro) { b.thinking = { type: "enabled" }; b.reasoning_effort = "high"; }
    const r = await client.chat.completions.create(b);
    const c = r.choices[0]?.message?.content || "";
    const u = r.usage!;
    totalC += isPro ? (u.prompt_tokens/1e6)*0.14+(u.completion_tokens/1e6)*0.42 : (u.prompt_tokens/1e6)*0.04+(u.completion_tokens/1e6)*0.12;
    totalT += u.total_tokens;

    const ms = c.match(/```json\s*\n?(\{[\s\S]*?\})\s*```/g) || [];
    const il = c.match(/\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[^}]+\}\}/g) || [];
    for (const m of [...ms.map(b => b.replace(/```json\s*\n?/,"").replace(/\s*```/,"")), ...il]) {
      try { const call = JSON.parse(m); if (call.tool && call.args) { tc++; msgs.push({ role: "assistant", content: "Called "+call.tool }); msgs.push({ role: "user", content: "Result:\n"+tool(cwd, call.tool, call.args) }); } } catch {}
    }
    if (c.includes("task_complete") || (ms.length === 0 && il.length === 0 && i >= 1)) {
      return { content: c, toolCalls: tc, tokens: totalT, cost: Math.round(totalC*1e6)/1e6, durationMs: Date.now()-start, passed: c.includes("task_complete") };
    }
    msgs.push({ role: "assistant", content: c });
  }
  return { content: "", toolCalls: tc, tokens: totalT, cost: Math.round(totalC*1e6)/1e6, durationMs: Date.now()-start, passed: false };
}

// ═══ Benchmark Scenarios ═══
interface Scenario {
  id: string; category: string; name: string; weight: number;
  setup: () => Promise<void>;
  task: string;
  systemPrompt: string;
  verify: () => { passed: boolean; evidence: string[] };
  expectedMinTools: number;
  metrics: string[];
}

async function benchmarkSWE(): Promise<Scenario> {
  return {
    id: "swe-001", category: "correctness", name: "SWE-bench style: Fix bug + pass tests", weight: 4,
    setup: async () => {
      await fs.mkdir(TMP + "/swe/src", { recursive: true });
      await fs.mkdir(TMP + "/swe/tests", { recursive: true });
      await fs.writeFile(TMP + "/swe/package.json", JSON.stringify({ name:"swe",type:"module",scripts:{test:"vitest run"}},null,2));
      await fs.writeFile(TMP + "/swe/vitest.config.ts", `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { globals: true } });\n`);
      await fs.writeFile(TMP + "/swe/src/parser.ts",
`export function parseCSV(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim()); // BUG: should only push if current is not empty or if last char was comma
  return result;
}

export function sumColumn(data: string, colIndex: number): number {
  const lines = data.split("\\n").filter(l => l.trim());
  let sum = 0;
  for (const line of lines) {
    const cols = parseCSV(line);
    if (colIndex < cols.length) {
      sum += parseInt(cols[colIndex]) || 0;
    }
  }
  return sum;
}
`);
      await fs.writeFile(TMP + "/swe/tests/parser.test.ts",
`import { describe, it, expect } from "vitest";
import { parseCSV, sumColumn } from "../src/parser.js";

describe("parseCSV", () => {
  it("parses simple CSV", () => {
    expect(parseCSV("a,b,c")).toEqual(["a","b","c"]);
  });
  it("handles quoted values with commas", () => {
    expect(parseCSV('"hello, world",b,c')).toEqual(["hello, world","b","c"]);
  });
  it("handles empty fields", () => {
    expect(parseCSV("a,,c")).toEqual(["a","","c"]);
  });
  it("handles trailing comma", () => {
    expect(parseCSV("a,b,")).toEqual(["a","b",""]); // BUG: parseCSV adds extra empty string
  });
});

describe("sumColumn", () => {
  it("sums a column of numbers", () => {
    const data = "1,2,3\\n4,5,6\\n7,8,9";
    expect(sumColumn(data, 1)).toBe(15); // 2+5+8
  });
});
`);
    },
    task: "Read src/parser.ts and tests/parser.test.ts. There is a bug in parseCSV that causes 'handles trailing comma' test to fail. The bug is in how the last field is pushed after the loop. Fix it, then run tests to verify ALL pass.",
    systemPrompt: "You are a Software Engineer Agent. Read the source code, understand the bug, fix it precisely, run tests, verify. Call task_complete ONLY when all tests pass.",
    verify: () => {
      const src = readFileSync(TMP + "/swe/src/parser.ts", "utf-8");
      try {
        const o = execSync("npx vitest run 2>&1", { cwd: TMP + "/swe", encoding: "utf-8", timeout: 30000, env: {...process.env, CI:"true"} });
        const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/);
        return { passed: parseInt(fm?.[1]||"0")===0 && parseInt(pm?.[1]||"0")===4,
          evidence: [fm?.[1]||"0" + " failed", pm?.[1]||"0" + " passed", "bug fixed: " + !src.includes("result.push(current.trim()); // BUG")] };
      } catch(e: any) { return { passed: false, evidence: [(e.stdout||"")+(e.stderr||"").substring(0, 200)] }; }
    },
    expectedMinTools: 3, metrics: ["correctness", "tool_use", "cost"],
  };
}

async function benchmarkParallelResearch(): Promise<Scenario> {
  return {
    id: "parallel-001", category: "parallelism", name: "Parallel Research: 3 directories simultaneously", weight: 3,
    setup: async () => {
      for (const dir of ["src", "tests", "config"]) {
        await fs.mkdir(TMP + "/parallel/" + dir, { recursive: true });
        for (let i = 1; i <= 5; i++) {
          await fs.writeFile(TMP + `/parallel/${dir}/file${i}.ts`, `// ${dir}/file${i}.ts\nexport const ${dir}File${i} = "${dir} module ${i}";\n`);
        }
      }
      await fs.writeFile(TMP + "/parallel/package.json", JSON.stringify({ name:"parallel",type:"module" },null,2));
    },
    task: "You are a coordinator. Scan 3 directories (src/, tests/, config/) IN PARALLEL using 3 sub-researchers. Each researcher should read its directory files and report a summary. You must aggregate the summaries into one final report.",
    systemPrompt: "You are a Cluster Coordinator. Delegate parallel research tasks. Each researcher gets one directory. Read files from that directory. Produce a summary. Aggregate all summaries. Call task_complete with the aggregated report.",
    verify: () => {
      const files = ["src", "tests", "config"].map(d => existsSync(TMP + "/parallel/" + d + "/file1.ts"));
      return { passed: files.every(Boolean), evidence: files.map((f, i) => ["src","tests","config"][i] + ": " + (f ? "OK" : "MISSING")) };
    },
    expectedMinTools: 3, metrics: ["parallelism", "tool_use", "cost"],
  };
}

// ═══ Runner ═══
interface BenchResult {
  scenarioId: string; category: string; passed: boolean; score: number;
  toolCalls: number; tokens: number; cost: number; durationMs: number;
  evidence: string[];
}

async function main() {
  if (!API) { console.log("DEEPSEEK_API_KEY required"); process.exit(1); }

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  NAC Cluster Agent Benchmark Suite          ║");
  console.log("║  Based on SWE-bench / Claude Eval / AgentBench  ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  await fs.mkdir(TMP, { recursive: true });
  const results: BenchResult[] = [];

  // ═══ Scenario 1: SWE-bench style ═══
  console.log("━━━ 1. SWE-bench: Fix CSV Parser Bug ━━━\n");
  const swe = await benchmarkSWE();
  await swe.setup();
  console.log("   Task: " + swe.task.substring(0, 80) + "...");

  const sweResult = await runAgent(PRO, swe.systemPrompt, swe.task, TMP + "/swe", 6);
  const sweVerify = swe.verify();
  results.push({
    scenarioId: swe.id, category: swe.category, passed: sweVerify.passed,
    score: sweVerify.passed ? swe.weight : 0,
    toolCalls: sweResult.toolCalls, tokens: sweResult.tokens,
    cost: sweResult.cost, durationMs: sweResult.durationMs,
    evidence: sweVerify.evidence,
  });

  console.log(`   Tools: ${sweResult.toolCalls} | Tokens: ${sweResult.tokens} | Cost: $${sweResult.cost.toFixed(4)} | ${sweResult.durationMs}ms`);
  console.log(`   ${sweVerify.passed ? "✅ PASS" : "❌ FAIL"}: ${sweVerify.evidence.join(" | ")}\n`);

  // ═══ Scenario 2: Parallel Research ═══
  console.log("━━━ 2. Parallel Research: 3 Directories ━━━\n");
  const parallel = await benchmarkParallelResearch();
  await parallel.setup();
  console.log("   Task: " + parallel.task.substring(0, 80) + "...");

  // Run 3 researchers in parallel
  const dirs = ["src", "tests", "config"];
  const startParallel = Date.now();
  const parallelResults = await Promise.all(dirs.map((dir, i) =>
    runAgent(FLASH,
      `You are ResearchAgent#${i+1}. Read all files in the ${dir}/ directory. Produce a structured summary of each file's contents. Call task_complete with the summary.`,
      `Read ALL files in ${dir}/ directory. List each file and its exported constant. Call task_complete with your summary.`,
      TMP + "/parallel", 4)
  ));
  const parallelDuration = Date.now() - startParallel;

  const totalTools = parallelResults.reduce((s, r) => s + r.toolCalls, 0);
  const totalTokens = parallelResults.reduce((s, r) => s + r.tokens, 0);
  const totalCost = parallelResults.reduce((s, r) => s + r.cost, 0);

  const parallelPassed = parallelResults.every(r => r.toolCalls >= 3); // Each must read files
  results.push({
    scenarioId: parallel.id, category: parallel.category, passed: parallelPassed,
    score: parallelPassed ? parallel.weight : 0,
    toolCalls: totalTools, tokens: totalTokens, cost: Math.round(totalCost*1e6)/1e6,
    durationMs: parallelDuration,
    evidence: dirs.map((d, i) => `${d}: ${parallelResults[i].toolCalls} tools, ${parallelResults[i].tokens}t, $${parallelResults[i].cost.toFixed(4)}`),
  });

  console.log(`   Duration: ${parallelDuration}ms (parallel)`);
  console.log(`   ${parallelPassed ? "✅ PARALLEL RESEARCH PASSED" : "❌ FAILED"}`);
  dirs.forEach((d, i) => console.log(`   ${d}: ${parallelResults[i].toolCalls} tools, ${parallelResults[i].tokens}t, $${parallelResults[i].cost.toFixed(4)}`));
  console.log();

  // ═══ Summary ═══
  console.log("══════════════════════════════════════════════");
  console.log("  Benchmark Results");
  console.log("══════════════════════════════════════════════\n");

  const totalScore = results.reduce((s, r) => s + r.score, 0);
  const maxScore = results.reduce((s, r) => s + (r.passed ? 0 : 0), 0) + results.reduce((s, r) => s + (3), 0); // simlified
  const passedCount = results.filter(r => r.passed).length;

  console.log(`  Scenarios: ${passedCount}/${results.length} passed`);
  console.log(`  Total Cost: $${results.reduce((s, r) => s + r.cost, 0).toFixed(4)}`);
  console.log(`  Total Tokens: ${results.reduce((s, r) => s + r.tokens, 0).toLocaleString()}`);
  console.log();

  for (const r of results) {
    console.log(`  [${r.passed ? "✅" : "❌"}] ${r.scenarioId} (${r.category}): ${r.toolCalls} tools, ${r.tokens}t, $${r.cost.toFixed(4)}, ${r.durationMs}ms`);
  }
  console.log();

  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
  process.exit(passedCount === results.length ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
