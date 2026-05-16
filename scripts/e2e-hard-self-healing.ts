/**
 * HARD Self-Healing Bench — 构造必须触发修复循环的场景
 * 3 个 bug 跨 2 个文件，第一次修复大概率只覆盖 2 个，第 3 个被遗漏
 * Code→Test(FAIL)→Repair→CodeV2→TestV2→Review
 */
import "dotenv/config";
import { promises as fs, readFileSync, existsSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import OpenAI from "openai";

const TMP = "./test-loop-tmp/e2e-hard";
const API_KEY = process.env.DEEPSEEK_API_KEY!;
const PRO = "deepseek-v4-pro";
const FLASH = "deepseek-v4-flash";
const client = new OpenAI({ apiKey: API_KEY, baseURL: "https://api.deepseek.com/v1" });

function exec(cwd: string, name: string, args: Record<string, any>): string {
  try {
    switch (name) {
      case "file_read": {
        const p = `${cwd}/${args.path}`;
        return existsSync(p) ? readFileSync(p, "utf-8") : `NOT_FOUND: ${args.path}`;
      }
      case "file_write": {
        writeFileSync(`${cwd}/${args.path}`, args.content, "utf-8");
        return `OK: wrote ${args.content.length}B`;
      }
      case "bash":
      case "run_command": {
        try {
          return execSync(args.command, { cwd, encoding: "utf-8", timeout: 30000, maxBuffer: 1024*1024 }) || "(ok)";
        } catch(e: any) {
          return `EXIT ${e.status}: ${((e.stdout||"")+(e.stderr||"")).substring(0, 500)}`;
        }
      }
      case "run_tests": {
        try {
          const out = execSync(args.command || "npx vitest run 2>&1", {
            cwd, encoding: "utf-8", timeout: 60000, maxBuffer: 5*1024*1024,
            env: { ...process.env, CI: "true", FORCE_COLOR: "0" }
          });
          const pm = out.match(/(\d+)\s+passed/); const fm = out.match(/(\d+)\s+failed/);
          return `PASS:${pm?.[1]||0} FAIL:${fm?.[1]||0}\n${out.substring(Math.max(0,out.length-400))}`;
        } catch(e: any) {
          const o = (e.stdout||"") + (e.stderr||"");
          const pm = o.match(/(\d+)\s+passed/); const fm = o.match(/(\d+)\s+failed/);
          return `PASS:${pm?.[1]||0} FAIL:${fm?.[1]||0}\n${o.substring(Math.max(0,o.length-400))}`;
        }
      }
      case "grep_files": {
        try {
          return execSync(`grep -rn "${args.pattern}" ${cwd} --include="*.ts" 2>/dev/null || echo "no matches"`, { encoding: "utf-8", timeout: 5000 });
        } catch { return "no matches"; }
      }
      case "task_complete": return `DONE: ${args.result || "done"}`;
      default: return `ERROR: unknown tool ${name}`;
    }
  } catch(e: any) { return `ERROR: ${e.message}`; }
}

const TOOLS_DESC = "file_read(path) | file_write(path,content) | grep_files(pattern) | run_tests(command?) | run_command(command) | task_complete(result)\nCall: ```json\n{\"tool\":\"<name>\",\"args\":{...}}\n```";

async function agentLoop(model: string, system: string, task: string, cwd: string, maxTurns = 6) {
  const msgs: any[] = [
    { role: "system", content: `${system}\n\n## Tools\n${TOOLS_DESC}` },
    { role: "user", content: task },
  ];
  let totalCost = 0, totalTokens = 0, toolCalls = 0;
  const turns: any[] = [];

  for (let i = 0; i < maxTurns; i++) {
    const isPro = model === PRO;
    const body: any = {
      model, messages: msgs, temperature: 0.3, max_tokens: 2000,
      ...(isPro ? { thinking: { type: "enabled" }, reasoning_effort: "high" } : {}),
    };
    const resp = await client.chat.completions.create(body);
    const content = resp.choices[0]?.message?.content || "";
    const usage = resp.usage!;
    const cost = isPro
      ? (usage.prompt_tokens/1e6)*0.14 + (usage.completion_tokens/1e6)*0.42
      : (usage.prompt_tokens/1e6)*0.04 + (usage.completion_tokens/1e6)*0.12;
    totalCost += cost; totalTokens += usage.total_tokens;

    const turnCalls: string[] = [];
    const turnResults: string[] = [];

    const matches = content.match(/```json\s*\n?(\{[\s\S]*?\})\s*```/g) || [];
    const inline = content.match(/\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[^}]+\}\}/g) || [];
    for (const m of [...matches.map(b => b.replace(/```json\s*\n?/,"").replace(/\s*```/,"")), ...inline]) {
      try {
        const call = JSON.parse(m);
        if (call.tool && call.args) {
          toolCalls++;
          const result = exec(cwd, call.tool, call.args);
          turnCalls.push(`${call.tool}(${JSON.stringify(call.args).substring(0, 80)})`);
          turnResults.push(result.substring(0, 200));
          msgs.push({ role: "assistant", content: `Called ${call.tool}` });
          msgs.push({ role: "user", content: `Result:\n${result}` });
        }
      } catch {}
    }

    turns.push({ content: content.substring(0, 200), toolCalls: turnCalls, toolResults: turnResults });

    if (content.includes("task_complete") || (turnCalls.length === 0 && i >= 1)) {
      return { turns, totalCost, totalTokens, toolCalls, passed: content.includes("task_complete") || toolCalls > 0 };
    }
    msgs.push({ role: "assistant", content });
  }
  return { turns, totalCost, totalTokens, toolCalls, passed: toolCalls > 0 };
}

function testPassed(): { passed: boolean; output: string; failCount: number } {
  try {
    const out = execSync("npx vitest run 2>&1", { cwd: TMP, encoding: "utf-8", timeout: 30000, env: {...process.env, CI:"true"} });
    const fm = out.match(/(\d+)\s+failed/); const pm = out.match(/(\d+)\s+passed/);
    return { passed: parseInt(fm?.[1]||"0")===0, output: out, failCount: parseInt(fm?.[1]||"0") };
  } catch(e: any) {
    const o = (e.stdout||"")+(e.stderr||"");
    const fm = o.match(/(\d+)\s+failed/); const pm = o.match(/(\d+)\s+passed/);
    return { passed: parseInt(fm?.[1]||"0")===0 && parseInt(pm?.[1]||"0")>0, output: o, failCount: parseInt(fm?.[1]||"0") };
  }
}

async function main() {
  if (!API_KEY) { console.log("FAIL: DEEPSEEK_API_KEY required"); process.exit(1); }

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  HARD Self-Healing — Must Trigger Repair Loop   ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // Setup: 3 bugs across 2 files
  await fs.mkdir(`${TMP}/src`, { recursive: true });
  await fs.mkdir(`${TMP}/tests`, { recursive: true });
  await fs.writeFile(`${TMP}/package.json`, JSON.stringify({ name:"fixture",type:"module",scripts:{test:"vitest run"}},null,2));
  await fs.writeFile(`${TMP}/vitest.config.ts`, `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { globals: true } });\n`);

  // Bug 1: UserService has off-by-one in getUsers()
  // Bug 2: UserService deleteUser doesn't handle invalid IDs
  // Bug 3: auth.ts verifyToken always returns true (security bug, easy to miss)
  await fs.writeFile(`${TMP}/src/user-service.ts`,
`export interface User { id: number; name: string; }

export class UserService {
  private users: User[] = [{id:1,name:"Alice"},{id:2,name:"Bob"},{id:3,name:"Charlie"}];

  getUsers(page: number, size: number): User[] {
    const start = page * size; // BUG 1: off-by-one, page 1 should start at 0, not 1*size
    return this.users.slice(start, start + size);
  }

  getUser(id: number): User | undefined {
    return this.users.find(u => u.id === id);
  }

  deleteUser(id: number): boolean {
    const idx = this.users.findIndex(u => u.id === id);
    this.users.splice(idx, 1);
    return true; // BUG 2: returns true even when user not found (idx=-1 removes last element)
  }
}
`);
  await fs.writeFile(`${TMP}/src/auth.ts`,
`export function verifyToken(token: string): boolean {
  return true; // BUG 3: always true, even for empty/invalid tokens
}

export function generateToken(userId: number): string {
  return \`tok_\${userId}_\${Date.now()}\`;
}
`);
  await fs.writeFile(`${TMP}/tests/user-service.test.ts`,
`import { describe, it, expect } from "vitest";
import { UserService } from "../src/user-service.js";

describe("UserService", () => {
  const svc = new UserService();

  it("getUser returns existing user", () => expect(svc.getUser(1)?.name).toBe("Alice"));
  it("getUser returns undefined for missing", () => expect(svc.getUser(99)).toBeUndefined());

  it("getUsers page 1 returns first 2 users", () => {
    const users = svc.getUsers(0, 2); // page 0, size 2
    expect(users.length).toBe(2);
    expect(users[0].name).toBe("Alice");
    expect(users[1].name).toBe("Bob");
  });

  it("deleteUser removes user", () => {
    const svc2 = new UserService();
    expect(svc2.deleteUser(1)).toBe(true);
    expect(svc2.getUser(1)).toBeUndefined();
  });

  it("deleteUser returns false for non-existent", () => {
    const svc3 = new UserService();
    expect(svc3.deleteUser(999)).toBe(false);
  });

  it("getUsers handles empty page", () => {
    const svc4 = new UserService();
    const users = svc4.getUsers(10, 2);
    expect(users.length).toBe(0);
  });
});
`);
  await fs.writeFile(`${TMP}/tests/auth.test.ts`,
`import { describe, it, expect } from "vitest";
import { verifyToken, generateToken } from "../src/auth.js";

describe("auth", () => {
  it("verifyToken rejects empty string", () => expect(verifyToken("")).toBe(false));
  it("verifyToken rejects invalid token", () => expect(verifyToken("invalid_token_123")).toBe(false));
  it("verifyToken accepts valid token", () => {
    const token = generateToken(1);
    expect(verifyToken(token)).toBe(true);
  });
  it("generateToken creates a string", () => {
    const token = generateToken(42);
    expect(token.startsWith("tok_42_")).toBe(true);
  });
});
`);

  const initial = testPassed();
  console.log(`Fixture: ${initial.failCount} tests failing (should be 4+)\n`);

  const allCosts: number[] = [];
  const allResults: Record<string, any> = {};
  const startTime = Date.now();

  // ── Step 1: Planner (Pro) ──
  console.log("📋 [Planner] Pro → Read code, identify ALL bugs...");
  const plan = await agentLoop(PRO,
    "You are the PlannerAgent. Read ALL source and test files in src/ and tests/. Identify EVERY bug that causes a test to fail. List each bug with file and line. Be thorough — do NOT miss any bugs.",
    `Read these files and list every bug:\n- src/user-service.ts\n- src/auth.ts\n- tests/user-service.test.ts\n- tests/auth.test.ts\n\nThen call task_complete with a numbered list of ALL bugs found.`,
    TMP, 6);
  allResults.plan = plan; allCosts.push(plan.totalCost);
  console.log(`   ✓ ${plan.toolCalls} tools, ${plan.totalTokens}t, $${plan.totalCost.toFixed(4)}`);
  plan.turns.forEach(t => t.toolCalls.forEach((c: string,i: number) => console.log(`     🔧 ${c}`)));

  // ── Step 2: Code Agent #1 (Pro) ──
  console.log("\n💻 [CodeAgent#1] Pro → Fix ALL bugs in one shot...");
  const code1 = await agentLoop(PRO,
    `You are the CodeAgent. Fix ALL bugs.
Steps: 1) file_read src/user-service.ts 2) file_read src/auth.ts 3) file_write corrected src/user-service.ts 4) file_write corrected src/auth.ts 5) run_tests "npx vitest run" 6) If ANY test fails, examine the failure and file_write a fix 7) call task_complete ONLY when ALL tests pass.`,
    "Fix ALL bugs in src/user-service.ts and src/auth.ts. Run tests to verify. The Planner found these bugs:\n" + plan.turns[plan.turns.length-1]?.content.substring(0, 400),
    TMP, 8);
  allResults.code1 = code1; allCosts.push(code1.totalCost);
  console.log(`   ✓ ${code1.toolCalls} tools, ${code1.totalTokens}t, $${code1.totalCost.toFixed(4)}`);
  code1.turns.forEach((t: any) => t.toolCalls.forEach((c: string,i: number) => console.log(`     🔧 ${c}`)));

  // ── Check tests ──
  let tp = testPassed();
  console.log(`\n🧪 [TestAgent#1] ${tp.passed ? "✅ ALL PASS" : `❌ ${tp.failCount} STILL FAIL`}`);
  if (!tp.passed) console.log(`   Failures:\n${tp.output.split("\n").filter((l: string) => l.includes("FAIL")).slice(0,5).join("\n")}`);

  // ── Self-Healing Loop ──
  let repairCount = 0;
  const MAX_REPAIR = 3;

  while (!tp.passed && repairCount < MAX_REPAIR) {
    repairCount++;
    console.log(`\n🔄 [SELF-HEALING #${repairCount}] Triggered — analyzing remaining failures...`);

    // Repair analysis (Flash)
    const repair = await agentLoop(FLASH,
      "You are a FailureAnalysisAgent. Read the failing test output. Identify exactly which assertion failed and why. What code change is needed?",
      `Tests still failing:\n\`\`\`\n${tp.output.substring(tp.output.length-600)}\n\`\`\`\n\nRead the source files that are still broken. Identify exactly what needs to change. Call task_complete with your analysis.`,
      TMP, 4);
    allResults[`repair_${repairCount}`] = repair; allCosts.push(repair.totalCost);
    console.log(`   Analysis: ${repair.turns[repair.turns.length-1]?.content.substring(0, 150)}`);

    // Code V2 (Pro·max)
    console.log(`\n💻 [CodeAgent#V${repairCount+1}] Pro·max → Fix remaining bugs...`);
    const codeV2 = await agentLoop(PRO,
      `You are the CodeAgent with MAX reasoning. The previous fix was INCOMPLETE — tests are still failing.
Read the source files, identify the REMAINING bugs, fix them, run tests, and call task_complete ONLY when all tests pass.
Check src/user-service.ts AND src/auth.ts — there may be bugs in BOTH files.`,
      `Tests STILL failing:\n${tp.output.substring(tp.output.length-400)}\n\nFix the remaining bugs now. Read the source files that are still broken, fix them, run tests.`,
      TMP, 8);
    allResults[`code_v${repairCount+1}`] = codeV2; allCosts.push(codeV2.totalCost);
    console.log(`   ✓ ${codeV2.toolCalls} tools, ${codeV2.totalTokens}t, $${codeV2.totalCost.toFixed(4)}`);
    codeV2.turns.forEach((t: any) => t.toolCalls.forEach((c: string,i: number) => console.log(`     🔧 ${c}`)));

    tp = testPassed();
    console.log(`\n🧪 [TestAgent#V${repairCount+1}] ${tp.passed ? "✅ ALL PASS" : `❌ ${tp.failCount} STILL FAIL`}`);
  }

  // ── Review (Pro·max) ──
  const finalSrc = readFileSync(`${TMP}/src/user-service.ts`, "utf-8");
  const finalAuth = readFileSync(`${TMP}/src/auth.ts`, "utf-8");
  console.log("\n👁 [ReviewAgent] Pro·max → Security + correctness review...");
  const review = await agentLoop(PRO,
    "You are the ReviewAgent with MAX reasoning. Review the fixed code for security issues, correctness, and edge cases.",
    `Review these fixed files:\n\nsrc/user-service.ts:\n\`\`\`typescript\n${finalSrc}\n\`\`\`\n\nsrc/auth.ts:\n\`\`\`typescript\n${finalAuth}\n\`\`\`\n\nCheck: security issues, logic errors, edge cases, regressions.`,
    TMP, 3);
  allResults.review = review; allCosts.push(review.totalCost);

  // ── Results ──
  const duration = (Date.now() - startTime) / 1000;
  const totalCost = allCosts.reduce((s: number, c: number) => s + c, 0);
  const totalTokens = Object.values(allResults).reduce((s: number, r: any) => s + (r.totalTokens||0), 0);
  const totalTools = Object.values(allResults).reduce((s: number, r: any) => s + (r.toolCalls||0), 0);

  const finalVerify = testPassed();

  console.log("\n══════════════════════════════════════════════════");
  console.log(`  Tests Pass:     ${finalVerify.passed ? "✅ YES" : "❌ NO"}`);
  console.log(`  Self-Healing:   ${repairCount > 0 ? `✅ FIRED (${repairCount} loops)` : "Not triggered"}`);
  console.log(`  Repair Loops:   ${repairCount}`);
  console.log(`  Total Tools:    ${totalTools}`);
  console.log(`  Duration:       ${duration.toFixed(1)}s`);
  console.log(`  Total Cost:     $${totalCost.toFixed(4)}`);
  console.log(`  Total Tokens:   ${totalTokens.toLocaleString()}`);
  console.log(`  Review:         Done (Pro·max)`);
  console.log("══════════════════════════════════════════════════\n");

  if (repairCount > 0) {
    console.log("✅ SELF-HEALING TRIGGERED AND COMPLETED");
  } else {
    console.log("⚠ Agent was too capable — fixed everything on first pass");
  }

  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
  process.exit(finalVerify.passed ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
