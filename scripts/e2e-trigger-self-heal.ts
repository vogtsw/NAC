/**
 * TRICKY Self-Healing — 构造"修复导致新bug"场景触发自愈循环
 * discount() has 2 issues: no clamping + naive fix breaks other tests
 */
import "dotenv/config";
import { promises as fs, readFileSync, existsSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import OpenAI from "openai";

const TMP = "./test-loop-tmp/e2e-trigger";
const API_KEY = process.env.DEEPSEEK_API_KEY!;
const PRO = "deepseek-v4-pro";
const FLASH = "deepseek-v4-flash";
const client = new OpenAI({ apiKey: API_KEY, baseURL: "https://api.deepseek.com/v1" });

function exec(cwd: string, name: string, args: Record<string, any>): string {
  try {
    switch (name) {
      case "file_read": { const p = cwd + "/" + args.path; return existsSync(p) ? readFileSync(p, "utf-8") : "NOT_FOUND"; }
      case "file_write": { writeFileSync(cwd + "/" + args.path, args.content, "utf-8"); return "OK"; }
      case "run_tests": {
        try {
          const o = execSync("npx vitest run 2>&1", { cwd, encoding: "utf-8", timeout: 60000, maxBuffer: 5*1024*1024, env: {...process.env, CI:"true"} });
          const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/);
          return "PASS:"+(pm?.[1]||0)+" FAIL:"+(fm?.[1]||0)+"\n"+o.substring(Math.max(0,o.length-300));
        } catch(e: any) { const o = (e.stdout||"")+(e.stderr||""); const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/); return "PASS:"+(pm?.[1]||0)+" FAIL:"+(fm?.[1]||0)+"\n"+o.substring(Math.max(0,o.length-300)); }
      }
      case "task_complete": return "DONE";
      default: return "ERROR";
    }
  } catch(e: any) { return "ERROR: "+e.message; }
}

const TOOLS = "file_read(path) | file_write(path,content) | run_tests(command?) | task_complete(result)\nCall: ```json\n{\"tool\":\"<name>\",\"args\":{...}}\n```";

async function loop(model: string, sys: string, task: string, cwd: string, maxT: number) {
  const msgs: any[] = [{ role: "system", content: sys + "\n\n## Tools\n" + TOOLS }, { role: "user", content: task }];
  let tc = 0, totalC = 0, totalT = 0;
  const turns: any[] = [];
  for (let i = 0; i < maxT; i++) {
    const b: any = { model, messages: msgs, temperature: 0.3, max_tokens: 2000 };
    if (model === PRO) { b.thinking = { type: "enabled" }; b.reasoning_effort = "high"; }
    const r = await client.chat.completions.create(b);
    const c = r.choices[0]?.message?.content || "";
    const u = r.usage!;
    const cost = model === PRO ? (u.prompt_tokens/1e6)*0.14+(u.completion_tokens/1e6)*0.42 : (u.prompt_tokens/1e6)*0.04+(u.completion_tokens/1e6)*0.12;
    totalC += cost; totalT += u.total_tokens;
    const calls: string[] = [], results: string[] = [];
    const ms = c.match(/```json\s*\n?(\{[\s\S]*?\})\s*```/g) || [];
    const il = c.match(/\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[^}]+\}\}/g) || [];
    for (const m of [...ms.map(b => b.replace(/```json\s*\n?/,"").replace(/\s*```/,"")), ...il]) {
      try {
        const call = JSON.parse(m);
        if (call.tool && call.args) { tc++; const res = exec(cwd, call.tool, call.args); calls.push(call.tool+"("+JSON.stringify(call.args).substring(0,60)+")"); results.push(res.substring(0,150)); msgs.push({ role: "assistant", content: "Called "+call.tool }); msgs.push({ role: "user", content: "Result:\n"+res }); }
      } catch {}
    }
    turns.push({ content: c.substring(0,200), calls, results });
    if (c.includes("task_complete") || (calls.length === 0 && i >= 1)) return { turns, totalCost: totalC, totalTokens: totalT, toolCalls: tc, passed: c.includes("task_complete") };
    msgs.push({ role: "assistant", content: c });
  }
  return { turns, totalCost: totalC, totalTokens: totalT, toolCalls: tc, passed: false };
}

function checkTests(): { passed: boolean; output: string; fail: number } {
  try {
    const o = execSync("npx vitest run 2>&1", { cwd: TMP, encoding: "utf-8", timeout: 30000, env: {...process.env, CI:"true"} });
    const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/);
    return { passed: parseInt(fm?.[1]||"0")===0, output: o, fail: parseInt(fm?.[1]||"0") };
  } catch(e: any) { const o = (e.stdout||"")+(e.stderr||""); const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/); return { passed: parseInt(fm?.[1]||"0")===0, output: o, fail: parseInt(fm?.[1]||"0") }; }
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  TRICKY Self-Healing Benchmark          ║");
  console.log("║  Naive fix breaks another test          ║");
  console.log("╚══════════════════════════════════════════╝\n");

  await fs.mkdir(TMP + "/src", { recursive: true });
  await fs.mkdir(TMP + "/tests", { recursive: true });
  await fs.writeFile(TMP + "/package.json", JSON.stringify({ name:"fixture",type:"module",scripts:{test:"vitest run"}},null,2));
  await fs.writeFile(TMP + "/vitest.config.ts", `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { globals: true } });\n`);
  await fs.writeFile(TMP + "/src/pricing.ts",
`export function discount(price: number, percent: number): number {
  const result = price * (1 - percent / 100);
  return result; // BUG: can return negative for percent > 100
}

export function isFreeShipping(total: number): boolean {
  return discount(total, 0) >= 50;
}
`);
  await fs.writeFile(TMP + "/tests/pricing.test.ts",
`import { describe, it, expect } from "vitest";
import { discount, isFreeShipping } from "../src/pricing.js";
describe("discount", () => {
  it("applies 10% discount", () => expect(discount(100, 10)).toBe(90));
  it("applies 50% discount", () => expect(discount(200, 50)).toBe(100));
  it("clamps negative result to 0", () => expect(discount(100, 150)).toBe(0));
});
describe("isFreeShipping", () => {
  it("free shipping over 50", () => expect(isFreeShipping(60)).toBe(true));
  it("no free shipping under 50", () => expect(isFreeShipping(30)).toBe(false));
});
`);

  const init = checkTests();
  console.log("Initial: " + init.fail + " tests failing\n");

  const costs: number[] = [];
  const startTime = Date.now();

  console.log("💻 [CodeAgent#1] Pro → Fix discount()...");
  const c1 = await loop(PRO,
    "You are the CodeAgent. Read the source and test files. Fix the discount() bug. Run tests with run_tests. Call task_complete when ALL pass. IMPORTANT: Do NOT change the behavior for valid inputs (0-100% discount).",
    "Read src/pricing.ts and tests/pricing.test.ts. The discount() function has a bug — it can return negative values for high percentages. Fix it, run tests, and call task_complete when ALL tests pass.",
    TMP, 5);
  costs.push(c1.totalCost);
  console.log("   " + c1.toolCalls + " tools, " + c1.totalTokens + "t, $" + c1.totalCost.toFixed(4));
  c1.turns.forEach((t: any) => t.calls.forEach((c: string,i: number) => console.log("     🔧 " + c)));

  let tp = checkTests();
  console.log("\n🧪 [TestAgent#1] " + (tp.passed ? "✅ ALL PASS" : "❌ " + tp.fail + " FAIL"));
  if (!tp.passed) console.log("   " + tp.output.split("\n").filter((l: string) => l.includes("FAIL ")).slice(0, 3).join("\n"));

  let rc = 0;
  while (!tp.passed && rc < 2) {
    rc++;
    console.log("\n🔄 [SELF-HEALING #" + rc + "] Triggered! Analyzing failures...");

    const repair = await loop(FLASH,
      "You are a FailureAnalysisAgent. Read the test output. Identify exactly which assertion failed and why the fix broke it.",
      "Tests still failing:\n" + tp.output.substring(tp.output.length - 500) + "\n\nRead src/pricing.ts. Why is the test still failing? What did the naive fix break?",
      TMP, 3);
    costs.push(repair.totalCost);
    console.log("   Analysis: " + repair.turns[repair.turns.length - 1]?.content.substring(0, 150));

    console.log("\n💻 [CodeAgent#V" + (rc + 1) + "] Pro·max → Fix correctly...");
    const cv = await loop(PRO,
      "You are the CodeAgent with MAX reasoning. The previous fix BROKE another test. Read the test output carefully, understand why the fix failed, and apply the CORRECT fix. Run tests. Call task_complete ONLY when all pass.",
      "Tests still failing after previous fix:\n" + tp.output.substring(tp.output.length - 400) + "\n\nRead src/pricing.ts. Understand why the fix broke things. Fix it correctly. Run tests.",
      TMP, 5);
    costs.push(cv.totalCost);
    console.log("   " + cv.toolCalls + " tools, " + cv.totalTokens + "t, $" + cv.totalCost.toFixed(4));
    cv.turns.forEach((t: any) => t.calls.forEach((c: string,i: number) => console.log("     🔧 " + c)));

    tp = checkTests();
    console.log("\n🧪 [TestAgent#V" + (rc + 1) + "] " + (tp.passed ? "✅ ALL PASS" : "❌ " + tp.fail + " FAIL"));
  }

  const dur = (Date.now() - startTime) / 1000;
  const totalC = costs.reduce((s: number, c: number) => s + c, 0);

  console.log("\n══════════════════════════════════════════");
  console.log("  Tests:         " + (tp.passed ? "✅ PASS" : "❌ FAIL"));
  console.log("  Self-Healing:  " + (rc > 0 ? "✅ FIRED (" + rc + " loops)" : "Not triggered"));
  console.log("  Duration:      " + dur.toFixed(1) + "s");
  console.log("  Total Cost:    $" + totalC.toFixed(4));
  console.log("══════════════════════════════════════════\n");

  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
  process.exit(tp.passed ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
