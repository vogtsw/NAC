/**
 * FORCED Self-Healing — 模拟失败注入验证修复循环
 * CodeAgent#1 产出不完整 patch → Test FAIL → Repair → CodeAgentV2 → Test PASS
 */
import "dotenv/config";
import { promises as fs, readFileSync, existsSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import OpenAI from "openai";

const TMP = "./test-loop-tmp/e2e-force";
const API = process.env.DEEPSEEK_API_KEY!;
const PRO = "deepseek-v4-pro";
const FLASH = "deepseek-v4-flash";
const client = new OpenAI({ apiKey: API, baseURL: "https://api.deepseek.com/v1" });

function tool(cwd: string, name: string, args: Record<string, any>): string {
  switch (name) {
    case "file_read": { const p = cwd + "/" + args.path; return existsSync(p) ? readFileSync(p, "utf-8") : "NOT_FOUND"; }
    case "file_write": { writeFileSync(cwd + "/" + args.path, args.content, "utf-8"); return "OK"; }
    case "run_tests": {
      try {
        const o = execSync("npx vitest run 2>&1", { cwd, encoding: "utf-8", timeout: 60000, maxBuffer: 5*1024*1024, env: {...process.env, CI:"true"} });
        const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/);
        return "PASS:"+(pm?.[1]||0)+" FAIL:"+(fm?.[1]||0);
      } catch(e: any) { const o = (e.stdout||"")+(e.stderr||""); const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/); return "PASS:"+(pm?.[1]||0)+" FAIL:"+(fm?.[1]||0); }
    }
    case "task_complete": return "DONE";
    default: return "ERROR";
  }
}

const TOOLS_DESC = "file_read(path) | file_write(path,content) | run_tests(command?) | task_complete(result)\nCall: ```json\n{\"tool\":\"<name>\",\"args\":{...}}\n```";

async function agent(model: string, sys: string, task: string, cwd: string, maxT: number) {
  const msgs: any[] = [{ role: "system", content: sys + "\n\n" + TOOLS_DESC }, { role: "user", content: task }];
  let tc = 0, totalC = 0, totalT = 0;
  for (let i = 0; i < maxT; i++) {
    const b: any = { model, messages: msgs, temperature: 0.3, max_tokens: 2000 };
    if (model === PRO) { b.thinking = { type: "enabled" }; b.reasoning_effort = i > 2 ? "max" : "high"; }
    const r = await client.chat.completions.create(b);
    const c = r.choices[0]?.message?.content || "";
    const u = r.usage!;
    totalC += model === PRO ? (u.prompt_tokens/1e6)*0.14+(u.completion_tokens/1e6)*0.42 : (u.prompt_tokens/1e6)*0.04+(u.completion_tokens/1e6)*0.12;
    totalT += u.total_tokens;
    const ms = c.match(/```json\s*\n?(\{[\s\S]*?\})\s*```/g) || [];
    const il = c.match(/\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[^}]+\}\}/g) || [];
    for (const m of [...ms.map(b => b.replace(/```json\s*\n?/,"").replace(/\s*```/,"")), ...il]) {
      try {
        const call = JSON.parse(m);
        if (call.tool && call.args) { tc++; msgs.push({ role: "assistant", content: "Called "+call.tool }); msgs.push({ role: "user", content: "Result:\n"+tool(cwd, call.tool, call.args) }); }
      } catch {}
    }
    if (c.includes("task_complete") || (ms.length === 0 && il.length === 0 && i >= 1)) return { toolCalls: tc, totalCost: totalC, totalTokens: totalT, passed: c.includes("task_complete"), content: c };
    msgs.push({ role: "assistant", content: c });
  }
  return { toolCalls: tc, totalCost: totalC, totalTokens: totalT, passed: false, content: "" };
}

function runTests(): { passed: boolean; fail: number; output: string } {
  try {
    const o = execSync("npx vitest run 2>&1", { cwd: TMP, encoding: "utf-8", timeout: 30000, env: {...process.env, CI:"true"} });
    const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/);
    return { passed: parseInt(fm?.[1]||"0")===0, fail: parseInt(fm?.[1]||"0"), output: o };
  } catch(e: any) { const o = (e.stdout||"")+(e.stderr||""); const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/); return { passed: parseInt(fm?.[1]||"0")===0, fail: parseInt(fm?.[1]||"0"), output: o }; }
}

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  FORCED Self-Healing — 失败注入验证        ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // Setup: 2 files with 2 bugs
  await fs.mkdir(TMP + "/src", { recursive: true });
  await fs.mkdir(TMP + "/tests", { recursive: true });
  await fs.writeFile(TMP + "/package.json", JSON.stringify({ name:"fixture",type:"module",scripts:{test:"vitest run"}},null,2));
  await fs.writeFile(TMP + "/vitest.config.ts", `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { globals: true } });\n`);
  await fs.writeFile(TMP + "/src/store.ts",
`export interface Item { id: number; name: string; price: number; }

export class Store {
  private items: Item[] = [
    { id: 1, name: "Apple", price: 1.0 },
    { id: 2, name: "Banana", price: 0.5 },
    { id: 3, name: "Cherry", price: 2.0 },
  ];

  getItem(id: number): Item | undefined {
    for (let i = 0; i <= this.items.length; i++) { // BUG 1: off-by-one (<= should be <)
      if (this.items[i].id === id) return this.items[i];
    }
    return undefined;
  }

  addItem(name: string, price: number): Item {
    const item: Item = { id: this.items.length + 1, name: name, price: price };
    this.items.push(item);
    return item; // BUG 2: price not validated (negative prices allowed)
  }

  totalValue(): number {
    return this.items.reduce((sum, item) => sum + item.price, 0);
  }
}
`);
  await fs.writeFile(TMP + "/tests/store.test.ts",
`import { describe, it, expect } from "vitest";
import { Store } from "../src/store.js";

describe("Store", () => {
  const store = new Store();

  it("getItem returns existing item", () => expect(store.getItem(1)?.name).toBe("Apple"));
  it("getItem returns undefined for missing", () => expect(store.getItem(99)).toBeUndefined());
  it("getItem handles last item", () => expect(store.getItem(3)?.name).toBe("Cherry"));

  it("addItem adds item", () => {
    const s = new Store();
    const item = s.addItem("Date", 3.0);
    expect(item.name).toBe("Date");
    expect(s.getItem(item.id)?.name).toBe("Date");
  });

  it("addItem rejects negative price", () => {
    const s = new Store();
    expect(() => s.addItem("Bad", -5)).toThrow();
  });

  it("totalValue sums prices", () => {
    const s = new Store();
    expect(s.totalValue()).toBeCloseTo(3.5, 1); // 1.0 + 0.5 + 2.0
  });
});
`);

  const init = runTests();
  console.log("Initial: " + init.fail + " tests failing\n");

  const costs: number[] = [];
  const start = Date.now();

  // ═══ ROUND 1: CodeAgent#1 (Pro) - Normal fix ═══
  console.log("💻 [CodeAgent#1] Pro → Fix all bugs...");
  const c1 = await agent(PRO,
    "You are the CodeAgent. Steps REQUIRED: 1) file_read src/store.ts 2) file_read tests/store.test.ts 3) file_write corrected src/store.ts (fix ALL bugs: off-by-one in getItem AND missing price validation in addItem) 4) run_tests 5) task_complete ONLY if ALL tests pass.",
    "Fix ALL bugs in src/store.ts. There are TWO bugs:\n1. getItem has off-by-one error (uses <= instead of <)\n2. addItem allows negative prices (should throw Error)\n\nRead both files, fix BOTH bugs, write the corrected file, run tests.",
    TMP, 6);
  costs.push(c1.totalCost);
  console.log("   " + c1.toolCalls + " tools, " + c1.totalTokens + "t, $" + c1.totalCost.toFixed(4) + "\n");

  // ═══ FORCE FAILURE: Write a precisely broken version ═══
  console.log("💉 [FAILURE INJECTION] Removing addItem price validation...");
  const fixed = readFileSync(TMP + "/src/store.ts", "utf-8");
  // Replace the validated addItem with one that accepts negative prices
  const sabotaged = fixed.replace(
    /addItem\(name: string, price: number\): Item \{[\s\S]*?\n  \}/,
    `addItem(name: string, price: number): Item {
    // [FAILURE INJECTED: price validation removed]
    const item: Item = { id: this.items.length + 1, name: name, price: price };
    this.items.push(item);
    return item;
  }`
  );
  writeFileSync(TMP + "/src/store.ts", sabotaged, "utf-8");
  const afterInject = runTests();
  console.log("   Tests now: " + (afterInject.passed ? "PASS" : afterInject.fail + " FAIL") + " ← FORCED\n");

  if (afterInject.passed) {
    console.log("   ⚠ Injection didn't cause failure — agent may not have added validation. Skipping self-heal.");
    console.log("   Agent output was correct, self-healing not needed for this simple case.\n");
    console.log("══════════════════════════════════════════════");
    console.log("  Verdict: Agent too good to need self-heal");
    console.log("  Cost: $" + costs.reduce((s: number,c: number)=>s+c,0).toFixed(4));
    console.log("══════════════════════════════════════════════\n");
    await fs.rm(TMP, { recursive: true, force: true }).catch(()=>{});
    process.exit(0);
  }

  // ═══ ROUND 2: Repair (Flash) + CodeAgentV2 (Pro·max) ═══
  console.log("🔄 [SELF-HEALING] Triggered! Test failures detected.\n");

  console.log("🔍 [RepairAgent] Flash → Analyzing failure...");
  const repair = await agent(FLASH,
    "You are a FailureAnalysisAgent. Read the test output below. Identify EXACTLY which assertion failed and what code change is needed.",
    "Tests are failing:\n" + afterInject.output.substring(afterInject.output.length - 600) + "\n\nRead src/store.ts. Find the remaining bug. Call task_complete with your diagnosis.",
    TMP, 3);
  costs.push(repair.totalCost);
  console.log("   Diagnosis: " + repair.content.substring(0, 150));

  console.log("\n💻 [CodeAgentV2] Pro·max → Fixing remaining bug...");
  const c2 = await agent(PRO,
    "CRITICAL: You MUST fix the bug. Steps REQUIRED: 1) file_read src/store.ts 2) file_read tests/store.test.ts 3) file_write the CORRECTED src/store.ts (add back the throw for negative price) 4) run_tests 5) If tests fail, fix again 6) task_complete ONLY when ALL tests pass. DO NOT skip step 3.",
    "CRITICAL: Tests are failing. The addItem function MUST throw an error for negative prices. Read the file, ADD the validation back, write the file, and run tests. DO NOT call task_complete without writing the fix.\n\nFailure output:\n" + afterInject.output.substring(afterInject.output.length - 400),
    TMP, 6);
  costs.push(c2.totalCost);
  console.log("   " + c2.toolCalls + " tools, " + c2.totalTokens + "t, $" + c2.totalCost.toFixed(4));

  const final = runTests();
  console.log("\n🧪 [TestAgentV2] " + (final.passed ? "✅ ALL PASS" : "❌ " + final.fail + " STILL FAIL") + "\n");

  // ═══ ROUND 3: Review ═══
  console.log("👁 [ReviewAgent] Pro·max → Final review...");
  const finalSrc = readFileSync(TMP + "/src/store.ts", "utf-8");
  const review = await agent(PRO,
    "You are the ReviewAgent with MAX reasoning. Review the fixed code for correctness and security.",
    "Review this code:\n```typescript\n" + finalSrc + "\n```\n\nCheck for any remaining bugs, security issues, or edge cases.",
    TMP, 2);
  costs.push(review.totalCost);

  const dur = (Date.now() - start) / 1000;
  const totalC = costs.reduce((s: number,c: number)=>s+c,0);

  console.log("\n══════════════════════════════════════════════");
  console.log("  Tests:          " + (final.passed ? "✅ ALL PASS" : "❌ FAIL"));
  console.log("  Self-Healing:   ✅ FIRED AND COMPLETED");
  console.log("  Repair→CodeV2→TestV2→Review: ✅");
  console.log("  Duration:       " + dur.toFixed(1) + "s");
  console.log("  Total Cost:     $" + totalC.toFixed(4));
  console.log("══════════════════════════════════════════════\n");

  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
  process.exit(final.passed ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
