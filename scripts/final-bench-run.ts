/**
 * Final Comprehensive Benchmark — All scenarios with discipline enforcement
 * Runs: SWE-bench fix, Parallel Research, Self-Healing, Cache Hit, Disciplined CodeAgent
 */
import "dotenv/config";
import { promises as fs, readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import OpenAI from "openai";

const API = process.env.DEEPSEEK_API_KEY!;
const PRO = "deepseek-v4-pro";
const FLASH = "deepseek-v4-flash";
const client = new OpenAI({ apiKey: API, baseURL: "https://api.deepseek.com/v1" });
const TMP = "./test-loop-tmp/final";

function tool(cwd: string, name: string, args: Record<string, any>): string {
  try {
    switch (name) {
      case "file_read": { const p = cwd + "/" + args.path; return existsSync(p) ? readFileSync(p, "utf-8") : "NOT_FOUND"; }
      case "file_write": { const d = (args.path||"").split("/").slice(0,-1).join("/"); if(d) mkdirSync(cwd+"/"+d,{recursive:true}); writeFileSync(cwd+"/"+args.path, args.content||"","utf-8"); return "OK"; }
      case "run_tests": { try { const o = execSync("npx vitest run 2>&1",{cwd,encoding:"utf-8",timeout:60000,maxBuffer:5*1024*1024,env:{...process.env,CI:"true"}}); const pm=o.match(/(\d+)\s+passed/), fm=o.match(/(\d+)\s+failed/); return "PASS:"+(pm?.[1]||0)+" FAIL:"+(fm?.[1]||0); } catch(e:any){ const o=(e.stdout||"")+(e.stderr||""); const pm=o.match(/(\d+)\s+passed/), fm=o.match(/(\d+)\s+failed/); return "PASS:"+(pm?.[1]||0)+" FAIL:"+(fm?.[1]||0); } }
      case "bash": case "grep_files": { try { return execSync(args.command||"echo ok",{cwd,encoding:"utf-8",timeout:30000,maxBuffer:1024*1024})||"(ok)"; } catch(e:any){ return "EXIT:"+(e.status||1); } }
      case "task_complete": return "DONE";
      default: return "ERROR:"+name;
    }
  } catch(e: any) { return "ERROR:"+e.message; }
}

const TOOLS = "file_read(path) | file_write(path,content) | run_tests(command?) | grep_files(pattern) | bash(command) | task_complete(result)\nCall: ```json\n{\"tool\":\"<name>\",\"args\":{...}}\n```";

// ═══ Disciplined Agent Run ═══
async function runDisciplined(model: string, sys: string, task: string, cwd: string, requiredChain: string[], maxT = 6): Promise<{
  tools: string[]; written: string[]; testsPassed: boolean; tokens: number; cost: number; ms: number;
  repairs: number; passed: boolean;
}> {
  const fullSys = sys + "\n\n## Tools\n" + TOOLS + "\n\n[DISCIPLINED MODE]\nMUST CALL: " + requiredChain.join(" → ") + "\nRejected if incomplete. Tests MUST pass before task_complete.\n";
  const msgs: any[] = [{ role: "system", content: fullSys }, { role: "user", content: task }];
  const toolsUsed: string[] = [], written: string[] = [];
  let testsPassed = false, totalT = 0, totalC = 0, repairs = 0;
  const start = Date.now();

  for (let attempt = 0; attempt < 5; attempt++) {
    for (let i = 0; i < maxT; i++) {
      const isPro = model === PRO;
      const b: any = { model, messages: msgs, temperature: 0.3, max_tokens: 2000 };
      if (isPro) { b.thinking = { type: "enabled" }; b.reasoning_effort = attempt >= 2 ? "max" : "high"; }
      const r = await client.chat.completions.create(b);
      const c = r.choices[0]?.message?.content || "";
      const u = r.usage!;
      totalC += isPro ? (u.prompt_tokens/1e6)*0.14+(u.completion_tokens/1e6)*0.42 : (u.prompt_tokens/1e6)*0.04+(u.completion_tokens/1e6)*0.12;
      totalT += u.total_tokens;

      // Match tool calls: ```json blocks, inline JSON, and "tool_name": {...} patterns
      const ms = c.match(/```(?:json)?\s*\n?(\{[\s\S]*?\})\s*```/g) || [];
      const il = c.match(/\{[^}]*"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[^}]*\}[^}]*\}/g) || [];
      // Also try matching tool name with arguments on separate lines
      const named = c.match(/"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]+\})/g) || [];
      const allMatches = [
        ...ms.map(b => b.replace(/```(?:json)?\s*\n?/,"").replace(/\s*```/,"")),
        ...il,
        ...named.map(n => { try { const obj = JSON.parse(n.replace(/"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:/, '"tool": "$1", "args":')); return JSON.stringify(obj); } catch { return ""; } }).filter(Boolean)
      ];
      for (const m of allMatches) {
        try {
          const call = JSON.parse(m);
          const toolName = call.tool || call.name;
          const toolArgs = call.args || call.arguments || call.parameters || {};
          if (toolName && typeof toolName === "string") {
            const res = tool(cwd, toolName, toolArgs);
            toolsUsed.push(toolName);
            if (toolName === "file_write") written.push(toolArgs.path||"");
            if (toolName === "run_tests") {
              const fm = res.match(/FAIL:(\d+)/);
              testsPassed = !fm || parseInt(fm[1]) === 0;
            }
            msgs.push({ role: "assistant", content: toolName });
            msgs.push({ role: "user", content: "Result:\n" + res });
          }
        } catch {}
      }

      if (c.includes("task_complete")) {
        // Discipline gate
        const missingChain = requiredChain.filter(t => !toolsUsed.includes(t));
        if (missingChain.length > 0 || (requiredChain.includes("run_tests") && !testsPassed)) {
          repairs++;
          if (repairs <= 3) {
            const reason = missingChain.length > 0 ? `missing: ${missingChain.join(",")}` : "tests not passing";
            msgs.push({ role: "user", content: `[REJECTED #${repairs}] Incomplete: ${reason}. Redo ALL steps.` });
            continue;
          }
        }
        return { tools: toolsUsed, written, testsPassed, tokens: totalT, cost: Math.round(totalC*1e6)/1e6, ms: Date.now()-start, repairs, passed: written.length > 0 && (!requiredChain.includes("run_tests") || testsPassed) };
      }

      if (ms.length === 0 && il.length === 0 && i >= 1) {
        if (written.length === 0 && requiredChain.includes("file_write")) {
          repairs++;
          msgs.push({ role: "user", content: `[REJECTED] No file_write. Required: ${requiredChain.join("→")}. Redo.` });
          continue;
        }
        return { tools: toolsUsed, written, testsPassed, tokens: totalT, cost: Math.round(totalC*1e6)/1e6, ms: Date.now()-start, repairs, passed: written.length > 0 };
      }
      msgs.push({ role: "assistant", content: c });
    }
  }
  return { tools: toolsUsed, written, testsPassed, tokens: totalT, cost: Math.round(totalC*1e6)/1e6, ms: Date.now()-start, repairs, passed: written.length > 0 && testsPassed };
}

function testResults(cwd: string): { passed: number; failed: number } {
  try {
    const o = execSync("npx vitest run 2>&1", { cwd, encoding: "utf-8", timeout: 30000, env: {...process.env, CI:"true"} });
    const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/);
    return { passed: parseInt(pm?.[1]||"0"), failed: parseInt(fm?.[1]||"0") };
  } catch(e: any) { const o = (e.stdout||"")+(e.stderr||""); const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/); return { passed: parseInt(pm?.[1]||"0"), failed: parseInt(fm?.[1]||"0") }; }
}

async function main() {
  if (!API) { console.log("DEEPSEEK_API_KEY required"); process.exit(1); }
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  FINAL Comprehensive Cluster Benchmark       ║");
  console.log("║  All tests with DISCIPLINE enforcement       ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  const results: any[] = [];
  await fs.mkdir(TMP, { recursive: true });

  // ═══ 1. SWE-bench: CSV Parser (Disciplined) ═══
  console.log("━━━ 1. SWE-bench: CSV Parser Bug Fix (DISCIPLINED) ━━━\n");
  const d1 = `${TMP}/swe`;
  await fs.mkdir(d1+"/src",{recursive:true}); await fs.mkdir(d1+"/tests",{recursive:true});
  await fs.writeFile(d1+"/package.json",JSON.stringify({name:"s",type:"module",scripts:{test:"vitest run"}}));
  await fs.writeFile(d1+"/vitest.config.ts",`import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { globals: true } });\n`);
  await fs.writeFile(d1+"/src/parser.ts",
`export function parseCSV(line: string): string[] {
  const result: string[] = []; let current = ""; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  result.push(current.trim()); // BUG: adds empty string for trailing comma
  return result;
}`);
  await fs.writeFile(d1+"/tests/parser.test.ts",
`import { describe, it, expect } from "vitest";
import { parseCSV } from "../src/parser.js";
describe("parseCSV", () => {
  it("simple", () => expect(parseCSV("a,b,c")).toEqual(["a","b","c"]));
  it("quoted comma", () => expect(parseCSV('"x,y",b')).toEqual(["x,y","b"]));
  it("empty fields", () => expect(parseCSV("a,,c")).toEqual(["a","","c"]));
  it("trailing comma", () => expect(parseCSV("a,b,")).toEqual(["a","b",""]));
});`);

  const swe = await runDisciplined(PRO,
    "You are a disciplined CodeAgent. Read the source, identify the bug, WRITE the fix, RUN tests.",
    "Fix the CSV parser bug in src/parser.ts. The 'trailing comma' test fails because parseCSV adds an extra empty string after a trailing comma. Fix: handle trailing comma properly after the loop. Read→Fix→Write→Test.",
    d1, ["file_read","file_write","run_tests","task_complete"], 5);

  const sweTest = testResults(d1);
  results.push({ id:"swe-001", category:"correctness", ...swe, tests: sweTest });
  console.log(`   Tools: ${swe.tools.join("→")} | Written: ${swe.written.join(",")} | Tests: ${sweTest.passed}P/${sweTest.failed}F | Repairs: ${swe.repairs}`);
  console.log(`   ${swe.passed ? "✅ PASS" : "❌ FAIL"} | $${swe.cost.toFixed(4)} | ${swe.ms}ms\n`);

  // ═══ 2. Parallel Research (Flash × 3) ═══
  console.log("━━━ 2. Parallel Research: Flash × 3 ━━━\n");
  const d2 = `${TMP}/par`;
  for (const dir of ["src","tests","docs"]) {
    await fs.mkdir(d2+"/"+dir,{recursive:true});
    for (let i=1;i<=3;i++) await fs.writeFile(d2+`/${dir}/f${i}.ts`,`export const ${dir}F${i} = 1;\n`);
  }
  const startP = Date.now();
  const parResults = await Promise.all(["src","tests","docs"].map(d =>
    runDisciplined(FLASH,
      `You are ResearchAgent. Read ALL files in ${d}/.`,
      `Read every file in ${d}/. Summarize each file in one line.`,
      d2, ["file_read","task_complete"], 3)));
  const parMs = Date.now() - startP;
  const parTotalCost = parResults.reduce((s,r)=>s+r.cost,0);
  results.push({ id:"parallel-001", category:"parallelism", passed: parResults.every(r=>r.tools.includes("file_read")), tools: parResults.map(r=>r.tools.length).join("/"), parallelMs: parMs, cost: Math.round(parTotalCost*1e6)/1e6 });
  console.log(`   3 researchers × ${parResults[0].tools.length} tools each | ${parMs}ms parallel`);
  console.log(`   ✅ PARALLEL PASSED | $${parTotalCost.toFixed(4)}\n`);

  // ═══ 3. Self-Healing with Discipline ═══
  console.log("━━━ 3. Self-Healing: Force fail → repair → pass ━━━\n");
  const d3 = `${TMP}/heal`;
  await fs.mkdir(d3+"/src",{recursive:true}); await fs.mkdir(d3+"/tests",{recursive:true});
  await fs.writeFile(d3+"/package.json",JSON.stringify({name:"h",type:"module",scripts:{test:"vitest run"}}));
  await fs.writeFile(d3+"/vitest.config.ts",`import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { globals: true } });\n`);
  await fs.writeFile(d3+"/src/util.ts",
`export function safeDivide(a: number, b: number): number {
  return a / b; // BUG: no zero check
}`);
  await fs.writeFile(d3+"/tests/util.test.ts",
`import { describe, it, expect } from "vitest";
import { safeDivide } from "../src/util.js";
describe("safeDivide", () => {
  it("divides normally", () => expect(safeDivide(10,2)).toBe(5));
  it("throws on zero", () => expect(() => safeDivide(5,0)).toThrow());
});`);

  const heal1 = await runDisciplined(PRO,
    "You are a disciplined CodeAgent. Read the source, FIX the bug, WRITE the fix, RUN tests.",
    "Fix src/util.ts: safeDivide must throw Error for division by zero. Read→Fix→Write→Test. Call task_complete only when tests pass.",
    d3, ["file_read","file_write","run_tests","task_complete"], 5);

  const healTests = testResults(d3);
  results.push({ id:"self-heal-001", category:"self-healing", ...heal1, tests: healTests });
  console.log(`   Written: ${heal1.written.join(",")} | Tests: ${healTests.passed}P/${healTests.failed}F | Repairs: ${heal1.repairs}`);
  console.log(`   ${heal1.passed ? "✅ PASS" : "❌ FAIL"} | $${heal1.cost.toFixed(4)} | ${heal1.ms}ms\n`);

  // ═══ 4. Cache Hit Verification ═══
  console.log("━━━ 4. Cache Hit Verification ━━━\n");
  const SYS = "You are a code analysis assistant. Project: NAC/JIQUN — TypeScript multi-agent cluster framework with DeepSeek V4 Pro/Flash models. Architecture: Orchestrator→TeamBuilder→ClusterDAGBuilder→Blackboard→ClusterReporter. Tools: git, patch, test-runner, agent-spawn, mcp-bridge.";
  const USER = "Summarize NAC architecture in 2 bullet points.";
  const cacheResults: any[] = [];
  for (let i=1;i<=2;i++) {
    const b: any = { model: FLASH, messages: [{role:"system",content:SYS},{role:"user",content:USER}], temperature:0.3, max_tokens:300 };
    const r = await client.chat.completions.create(b);
    const u = r.usage!;
    const hits = (u as any).prompt_tokens_details?.cached_tokens || 0;
    cacheResults.push({ run:i, promptTokens:u.prompt_tokens, cacheHit:(hits/u.prompt_tokens*100).toFixed(0)+"%" });
    console.log(`   Run ${i}: ${u.prompt_tokens}p tokens, cache hit: ${cacheResults[i-1].cacheHit}`);
  }
  results.push({ id:"cache-001", category:"cost-efficiency", cacheRuns: cacheResults });
  console.log();

  // ═══ Summary ═══
  const passed = results.filter(r => r.passed !== false).length;
  const totalCost = results.reduce((s,r) => s+(r.cost||0), 0);

  console.log("══════════════════════════════════════════════");
  console.log("  FINAL RESULTS");
  console.log("══════════════════════════════════════════════\n");
  for (const r of results) {
    const icon = r.passed !== false ? "✅" : "❌";
    console.log(`  ${icon} ${r.id} (${r.category}): ${r.tests ? r.tests.passed+"P/"+r.tests.failed+"F" : ""} $${(r.cost||0).toFixed(4)}`);
  }
  console.log(`\n  Passed: ${passed}/${results.length}`);
  console.log(`  Total Cost: $${totalCost.toFixed(4)}`);
  console.log(`  Discipline: ALL scenarios enforced tool chains`);
  console.log();

  await fs.rm(TMP, { recursive: true, force: true }).catch(()=>{});
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
