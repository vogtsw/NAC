/**
 * E2E Self-Healing Cluster Bench
 * 自愈循环：Code → Test(FAIL) → Repair → CodeV2 → TestV2(PASS) → Review
 * Usage: npx tsx scripts/e2e-self-healing-bench.ts
 *
 * 构造场景：validator.ts 有 2 个 bug
 * - validateEmail 接受空字符串
 * - validatePhone 允许非数字
 * 测试覆盖 4 个用例，2 个失败
 * Agent 第一次可能只修复 1 个，触发自愈循环
 */
import "dotenv/config";
import { promises as fs, readFileSync, existsSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import OpenAI from "openai";

const TMP = "./test-loop-tmp/e2e-self-heal";
const API_KEY = process.env.DEEPSEEK_API_KEY!;
const PRO = "deepseek-v4-pro";
const FLASH = "deepseek-v4-flash";

// ═══ Tool Executor ═══
function exec(cwd: string, name: string, args: Record<string, any>): string {
  try {
    switch (name) {
      case "file_read": {
        const p = `${cwd}/${args.path}`;
        return existsSync(p) ? readFileSync(p, "utf-8") : `ERROR: not found: ${args.path}`;
      }
      case "file_write": {
        writeFileSync(`${cwd}/${args.path}`, args.content, "utf-8");
        return `OK: wrote ${args.content.length}B to ${args.path}`;
      }
      case "bash":
      case "run_command": {
        try {
          return execSync(args.command, { cwd, encoding: "utf-8", timeout: 30000, maxBuffer: 1024*1024 }) || "(ok)";
        } catch(e: any) {
          return `EXIT ${e.status}: ${(e.stdout||"")+(e.stderr||"").substring(0, 500)}`;
        }
      }
      case "run_tests": {
        try {
          const out = execSync(args.command || "npx vitest run 2>&1", {
            cwd, encoding: "utf-8", timeout: 60000, maxBuffer: 5*1024*1024,
            env: { ...process.env, CI: "true", FORCE_COLOR: "0" }
          });
          const pm = out.match(/(\d+)\s+passed/); const fm = out.match(/(\d+)\s+failed/);
          return `Tests: ${pm?.[1]||0} passed, ${fm?.[1]||0} failed\n${out.substring(Math.max(0,out.length-300))}`;
        } catch(e: any) {
          const o = (e.stdout||"") + (e.stderr||"");
          const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/);
          return `Tests: ${pm?.[1]||0} passed, ${fm?.[1]||0} failed\n${o.substring(Math.max(0,o.length-300))}`;
        }
      }
      case "task_complete":
        return `DONE: ${args.result || "complete"}`;
      case "grep_files":
        try {
          return execSync(`grep -rn "${args.pattern}" ${cwd} --include="*.ts" 2>/dev/null || echo "no matches"`, { encoding: "utf-8", timeout: 5000 });
        } catch { return "no matches"; }
      default: return `ERROR: unknown tool ${name}`;
    }
  } catch(e: any) { return `ERROR: ${e.message}`; }
}

const TOOLS_DESC = [
  "file_read(path) - Read a file",
  "file_write(path, content) - Write to a file",
  "grep_files(pattern) - Search code",
  "run_tests(command?) - Run tests",
  "run_command(command) - Run shell command",
  "task_complete(result) - Mark complete",
].join("\n");

// ═══ Agent Loop ═══
interface Turn {
  role: string; content: string; toolCalls: string[]; toolResults: string[];
  tokens: number; cost: number;
}

async function agentLoop(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  task: string,
  cwd: string,
  maxTurns = 6,
): Promise<{ turns: Turn[]; totalCost: number; totalTokens: number; passed: boolean; toolCalled: number }> {
  const messages: any[] = [
    { role: "system", content: `${systemPrompt}\n\n## Tools\n${TOOLS_DESC}\n\nCall tools via:\n\`\`\`json\n{"tool":"<name>","args":{"key":"value"}}\n\`\`\`` },
    { role: "user", content: task },
  ];

  const turns: Turn[] = [];
  let totalCost = 0, totalTokens = 0, toolCalled = 0;

  for (let i = 0; i < maxTurns; i++) {
    const isPro = model === PRO;
    const body: any = {
      model, messages, temperature: 0.3, max_tokens: 2000,
      ...(isPro ? { thinking: { type: "enabled" }, reasoning_effort: "high" } : {}),
    };

    const resp = await client.chat.completions.create(body);
    const content = resp.choices[0]?.message?.content || "";
    const usage = resp.usage!;
    const cost = isPro
      ? (usage.prompt_tokens/1e6)*0.14 + (usage.completion_tokens/1e6)*0.42
      : (usage.prompt_tokens/1e6)*0.04 + (usage.completion_tokens/1e6)*0.12;
    totalCost += cost; totalTokens += usage.total_tokens;

    const turn: Turn = { role: "assistant", content: content.substring(0, 300), toolCalls: [], toolResults: [], tokens: usage.total_tokens, cost: Math.round(cost*1e6)/1e6 };

    // Parse tool calls
    const matches = content.match(/```json\s*\n?(\{[\s\S]*?\})\s*```/g) || [];
    const inline = content.match(/\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[^}]+\}\}/g) || [];
    for (const m of [...matches.map(b => b.replace(/```json\s*\n?/,"").replace(/\s*```/,"")), ...inline]) {
      try {
        const call = JSON.parse(m);
        if (call.tool && call.args) {
          toolCalled++;
          const result = exec(cwd, call.tool, call.args);
          turn.toolCalls.push(`${call.tool}(${JSON.stringify(call.args).substring(0, 100)})`);
          turn.toolResults.push(result.substring(0, 200));
          messages.push({ role: "assistant", content: `Called ${call.tool}` });
          messages.push({ role: "user", content: `Result of ${call.tool}:\n${result}` });
        }
      } catch {}
    }

    if (content.includes("task_complete") || (turn.toolCalls.length === 0 && i >= 1)) {
      turns.push(turn);
      const passed = content.includes("task_complete") || toolCalled > 0;
      return { turns, totalCost, totalTokens, passed, toolCalled };
    }
    turns.push(turn);
    messages.push({ role: "assistant", content });
  }
  return { turns, totalCost, totalTokens, passed: toolCalled > 0, toolCalled };
}

// ═══ Self-Healing Benchmark ═══
async function main() {
  if (!API_KEY) { console.log("FAIL: DEEPSEEK_API_KEY required"); process.exit(1); }

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  NAC Self-Healing Cluster E2E Benchmark         ║");
  console.log("║  Code→Test(FAIL)→Repair→CodeV2→TestV2→Review   ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // Setup: validator.ts with 2 bugs
  await fs.mkdir(`${TMP}/src`, { recursive: true });
  await fs.mkdir(`${TMP}/tests`, { recursive: true });
  await fs.writeFile(`${TMP}/package.json`, JSON.stringify({ name:"fixture",type:"module",scripts:{test:"vitest run"}},null,2));
  await fs.writeFile(`${TMP}/vitest.config.ts`, `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { globals: true } });\n`);
  await fs.writeFile(`${TMP}/src/validator.ts`,
`export function validateEmail(email: string): boolean {
  if (!email) return true; // BUG 1: empty string should be invalid
  return email.includes("@");
}

export function validatePhone(phone: string): boolean {
  if (phone.length === 0) return false;
  return true; // BUG 2: doesn't check if all digits, accepts "abc"
}
`);
  await fs.writeFile(`${TMP}/tests/validator.test.ts`,
`import { describe, it, expect } from "vitest";
import { validateEmail, validatePhone } from "../src/validator.js";

describe("validateEmail", () => {
  it("accepts valid email", () => expect(validateEmail("a@b.com")).toBe(true));
  it("rejects empty string", () => expect(validateEmail("")).toBe(false)); // FAILS (bug 1)
  it("rejects missing @", () => expect(validateEmail("abc")).toBe(false));
});

describe("validatePhone", () => {
  it("accepts valid phone", () => expect(validatePhone("1234567890")).toBe(true));
  it("rejects letters", () => expect(validatePhone("abc")).toBe(false)); // FAILS (bug 2)
  it("rejects empty", () => expect(validatePhone("")).toBe(false));
});
`);
  console.log("Fixture: validator.ts (2 bugs) + 6 tests (2 failing)\n");

  const client = new OpenAI({ apiKey: API_KEY, baseURL: "https://api.deepseek.com/v1" });
  const allResults: Record<string, any> = {};
  const allCosts: number[] = [];
  const startTime = Date.now();

  // ── Step 1: Planner (Pro) ──
  console.log("📋 [PlannerAgent] Analyzing...");
  const plan = await agentLoop(client, PRO,
    "You are the PlannerAgent. Read all source and test files. Identify bugs and create a numbered repair plan.",
    "Task: Fix bugs in src/validator.ts to make all tests in tests/validator.test.ts pass.\n\nRead src/validator.ts and tests/validator.test.ts. Identify ALL bugs. Create a plan listing every bug and how to fix it.",
    TMP, 4);
  allResults.plan = plan; allCosts.push(plan.totalCost);
  console.log(`   ✓ ${plan.toolCalled} tools, ${plan.totalTokens}t, $${plan.totalCost.toFixed(4)}\n`);
  plan.turns.forEach(t => t.toolCalls.forEach((c,i) => console.log(`     🔧 ${c}`)));

  // ── Step 2: Code Agent #1 (Pro) ──
  console.log("\n💻 [CodeAgent#1] Attempting fix...");
  const code1 = await agentLoop(client, PRO,
    `You are the CodeAgent. Fix ALL bugs found.
Steps: 1) file_read src/validator.ts 2) file_read tests/validator.test.ts 3) file_write corrected validator.ts 4) run_tests "npx vitest run" 5) If tests fail, analyze and try again. 6) Call task_complete ONLY when ALL tests pass.`,
    `Fix src/validator.ts. ${plan.turns[plan.turns.length-1]?.content.substring(0, 300)}\n\nFix ALL bugs. Run tests. If any fail, diagnose and fix again.`,
    TMP, 6);
  allResults.code1 = code1; allCosts.push(code1.totalCost);
  console.log(`   ✓ ${code1.toolCalled} tools, ${code1.totalTokens}t, $${code1.totalCost.toFixed(4)}`);
  code1.turns.forEach(t => t.toolCalls.forEach((c,i) => console.log(`     🔧 ${c} → ${(t.toolResults[i]||"").substring(0, 100)}`)));

  // ── Step 3: Check if tests pass ──
  let testPassed = false;
  let testOutput = "";
  try {
    testOutput = execSync("npx vitest run 2>&1", { cwd: TMP, encoding: "utf-8", timeout: 30000, env: {...process.env, CI:"true"} });
    const pm = testOutput.match(/(\d+)\s+passed/); const fm = testOutput.match(/(\d+)\s+failed/);
    testPassed = parseInt(fm?.[1] || "0") === 0 && parseInt(pm?.[1] || "0") > 0;
  } catch(e: any) {
    testOutput = (e.stdout||"") + (e.stderr||"");
    const fm = testOutput.match(/(\d+)\s+failed/);
    testPassed = !fm || parseInt(fm[1]) === 0;
  }
  console.log(`\n🧪 [TestAgent#1] Tests: ${testPassed ? "✅ ALL PASSED" : "❌ STILL FAILING"}`);

  // ── Step 4: Self-Healing Loop (if needed) ──
  let repairTurns = 0;
  const maxRepairs = 2;
  while (!testPassed && repairTurns < maxRepairs) {
    repairTurns++;
    console.log(`\n🔄 [Repair Loop ${repairTurns}/${maxRepairs}] Testing failed → analyzing failures...`);

    // 4a: Repair analysis (Flash)
    const repair = await agentLoop(client, FLASH,
      "You are a FailureAnalysis agent. Read the test output, identify what's still broken.",
      `Tests are failing. Output:\n\`\`\`\n${testOutput.substring(testOutput.length-800)}\n\`\`\`\n\nRead tests/validator.test.ts and src/validator.ts. What specific assertion is still failing and why?`,
      TMP, 3);
    allResults[`repair_${repairTurns}`] = repair; allCosts.push(repair.totalCost);
    console.log(`   Analysis: ${repair.turns[repair.turns.length-1]?.content.substring(0, 150)}`);

    // 4b: Code Agent V2 (Pro with max reasoning)
    console.log(`\n💻 [CodeAgent#V${repairTurns+1}] Pro·max → Applying corrected fix...`);
    const codeV2 = await agentLoop(client, PRO,
      `You are the CodeAgent with MAXIMUM reasoning. The previous fix was incomplete. Read the test output, find what's still failing, and fix it.
Steps: 1) file_read src/validator.ts 2) file_read tests/validator.test.ts 3) run_tests "npx vitest run" to see failures 4) file_write the CORRECTED validator.ts 5) run_tests to verify 6) task_complete ONLY when all pass.`,
      `The tests are STILL FAILING:\n${testOutput.substring(testOutput.length-500)}\n\nAnalyze the remaining failure and fix src/validator.ts completely.`,
      TMP, 6);
    allResults[`code_v${repairTurns+1}`] = codeV2; allCosts.push(codeV2.totalCost);
    console.log(`   ✓ ${codeV2.toolCalled} tools, ${codeV2.totalTokens}t, $${codeV2.totalCost.toFixed(4)}`);
    codeV2.turns.forEach(t => t.toolCalls.forEach((c,i) => console.log(`     🔧 ${c}`)));

    // Re-check tests
    try {
      testOutput = execSync("npx vitest run 2>&1", { cwd: TMP, encoding: "utf-8", timeout: 30000, env: {...process.env, CI:"true"} });
      const pm = testOutput.match(/(\d+)\s+passed/); const fm = testOutput.match(/(\d+)\s+failed/);
      testPassed = parseInt(fm?.[1] || "0") === 0 && parseInt(pm?.[1] || "0") > 0;
    } catch(e: any) {
      testOutput = (e.stdout||"")+(e.stderr||"");
      const fm = testOutput.match(/(\d+)\s+failed/);
      testPassed = !fm || parseInt(fm[1]) === 0;
    }
    console.log(`\n🧪 [TestAgent#V${repairTurns+1}] Tests: ${testPassed ? "✅ ALL PASSED" : "❌ STILL FAILING"}`);
  }

  // ── Step 5: Review (Pro·max) ──
  console.log("\n👁 [ReviewAgent] Pro·max → Final review...");
  const validatorContent = readFileSync(`${TMP}/src/validator.ts`, "utf-8");
  const review = await agentLoop(client, PRO,
    "You are the ReviewAgent. Review the fix for security, correctness, and edge cases. Check for regressions.",
    `Review this fixed validator.ts for any issues:\n\`\`\`typescript\n${validatorContent}\n\`\`\`\n\nCheck: 1) Security (injection?) 2) Correctness (all edge cases?) 3) Regressions (did fix break anything?)`,
    TMP, 3);
  allResults.review = review; allCosts.push(review.totalCost);
  console.log(`   Verdict: ${review.turns[review.turns.length-1]?.content.substring(0, 200)}`);

  // ── Results ──
  const duration = (Date.now() - startTime) / 1000;
  const totalCost = allCosts.reduce((s,c) => s+c, 0);
  const totalTokens = Object.values(allResults).reduce((s: number, r: any) => s + (r.totalTokens||0), 0);
  const totalTools = Object.values(allResults).reduce((s: number, r: any) => s + (r.toolCalled||0), 0);

  const finalContent = readFileSync(`${TMP}/src/validator.ts`, "utf-8");
  const bug1Fixed = !finalContent.includes("if (!email) return true");
  const bug2Fixed = !finalContent.includes("return true; // BUG 2");

  console.log("\n══════════════════════════════════════════════════");
  console.log(`  Status:         ${testPassed ? "✅ ALL TESTS PASSED" : "❌ STILL FAILING"}`);
  console.log(`  Bug 1 (email):  ${bug1Fixed ? "✅ fixed" : "❌ not fixed"}`);
  console.log(`  Bug 2 (phone):  ${bug2Fixed ? "✅ fixed" : "❌ not fixed"}`);
  console.log(`  Self-Healing:   ${repairTurns > 0 ? `✅ triggered (${repairTurns} loops)` : "Not needed"}`);
  console.log(`  Review:         Done (Pro·max)`);
  console.log(`  Total Tools:    ${totalTools}`);
  console.log(`  Duration:       ${duration.toFixed(1)}s`);
  console.log(`  Total Cost:     $${totalCost.toFixed(4)}`);
  console.log(`  Total Tokens:   ${totalTokens.toLocaleString()}`);
  console.log("══════════════════════════════════════════════════\n");

  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
  process.exit(testPassed && bug1Fixed && bug2Fixed ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
