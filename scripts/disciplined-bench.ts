/**
 * Disciplined vs Undisciplined Agent Benchmark
 * 证明：强制工具链纪律提升正确性
 */
import "dotenv/config";
import { promises as fs, readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import OpenAI from "openai";

const API = process.env.DEEPSEEK_API_KEY!;
const PRO = "deepseek-v4-pro";
const FLASH = "deepseek-v4-flash";
const TMP = "./test-loop-tmp/disc";

// ═══ Shared Tool Executor ═══
function tool(cwd: string, name: string, args: Record<string, any>): string {
  try {
    switch (name) {
      case "file_read": { const p = cwd + "/" + args.path; return existsSync(p) ? readFileSync(p, "utf-8") : "NOT_FOUND"; }
      case "file_write": { const dir = args.path.split("/").slice(0,-1).join("/"); if (dir) mkdirSync(cwd+"/"+dir,{recursive:true}); writeFileSync(cwd+"/"+args.path, args.content, "utf-8"); return "OK:"+args.content.length+"B"; }
      case "run_tests": {
        try { const o = execSync("npx vitest run 2>&1",{cwd,encoding:"utf-8",timeout:60000,maxBuffer:5*1024*1024,env:{...process.env,CI:"true"}}); const pm=o.match(/(\d+)\s+passed/), fm=o.match(/(\d+)\s+failed/); return "PASS:"+(pm?.[1]||0)+" FAIL:"+(fm?.[1]||0); }
        catch(e:any){ const o=(e.stdout||"")+(e.stderr||""); const pm=o.match(/(\d+)\s+passed/), fm=o.match(/(\d+)\s+failed/); return "PASS:"+(pm?.[1]||0)+" FAIL:"+(fm?.[1]||0); }
      }
      case "task_complete": return "DONE";
      case "grep_files": case "bash": {
        try { return execSync(args.command||args.pattern||"echo ok",{cwd,encoding:"utf-8",timeout:30000,maxBuffer:1024*1024})||"(ok)"; }
        catch(e:any){ return "EXIT:"+(e.status||1); }
      }
      default: return "ERROR:"+name;
    }
  } catch(e: any) { return "ERROR:"+e.message; }
}

const TOOLS_DESC = "file_read(path) | file_write(path,content) | run_tests(command?) | grep_files(pattern) | bash(command) | task_complete(result)\n\nCall: ```json\n{\"tool\":\"<name>\",\"args\":{...}}\n```";

interface RunResult { tools: string[]; filesRead: string[]; filesWritten: string[]; testsPassed: boolean; tokens: number; cost: number; durationMs: number; passed: boolean; disciplineReport?: any; }

async function runAgent(model: string, sys: string, task: string, cwd: string, disciplined = false, maxT = 6): Promise<RunResult> {
  const client = new OpenAI({ apiKey: API, baseURL: "https://api.deepseek.com/v1" });
  const toolsUsed: string[] = [], filesRead: string[] = [], filesWritten: string[] = [];
  let testsPassed = false, totalT = 0, totalC = 0;

  let fullSys = sys + "\n\n## Tools\n" + TOOLS_DESC;

  // Discipline injection
  if (disciplined) {
    fullSys += "\n\n[DISCIPLINED EXECUTION MODE]\nMANDATORY TOOL SEQUENCE: 1. file_read  2. file_write  3. run_tests  4. task_complete\nYou MUST call ALL of these tools in order. DO NOT skip file_write. DO NOT call task_complete until tests pass.\nThe system WILL reject incomplete work.";
  }

  const msgs: any[] = [{ role: "system", content: fullSys }, { role: "user", content: task }];
  const start = Date.now();
  let repairAttempts = 0;

  while (repairAttempts < 4) { // max 4 repair attempts
    for (let i = 0; i < maxT; i++) {
      const isPro = model === PRO;
      const b: any = { model, messages: msgs, temperature: 0.3, max_tokens: 2000 };
      if (isPro) { b.thinking = { type: "enabled" }; b.reasoning_effort = repairAttempts >= 2 ? "max" : "high"; }

      const r = await client.chat.completions.create(b);
      const c = r.choices[0]?.message?.content || "";
      const u = r.usage!;
      totalC += isPro ? (u.prompt_tokens/1e6)*0.14+(u.completion_tokens/1e6)*0.42 : (u.prompt_tokens/1e6)*0.04+(u.completion_tokens/1e6)*0.12;
      totalT += u.total_tokens;

      const ms = c.match(/```json\s*\n?(\{[\s\S]*?\})\s*```/g) || [];
      const il = c.match(/\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[^}]+\}\}/g) || [];
      let hadTool = false;

      for (const m of [...ms.map(b => b.replace(/```json\s*\n?/,"").replace(/\s*```/,"")), ...il]) {
        try {
          const call = JSON.parse(m);
          if (call.tool && call.args) {
            hadTool = true;
            const res = tool(cwd, call.tool, call.args);
            toolsUsed.push(call.tool);
            if (call.tool === "file_read") filesRead.push(call.args.path||"");
            if (call.tool === "file_write") filesWritten.push(call.args.path||"");
            if (call.tool === "run_tests" && !res.includes("FAIL:1") && !res.includes("FAIL:2")) {
              const fm = res.match(/FAIL:(\d+)/);
              testsPassed = !fm || parseInt(fm[1]) === 0;
            }
            msgs.push({ role: "assistant", content: "Called " + call.tool });
            msgs.push({ role: "user", content: "Result:\n" + res });
          }
        } catch {}
      }

      if (c.includes("task_complete")) {
        // Discipline check: if disciplined, verify preconditions
        if (disciplined) {
          const hasWrite = filesWritten.length > 0;
          const hasTest = toolsUsed.includes("run_tests");
          if (!hasWrite || !hasTest || !testsPassed) {
            repairAttempts++;
            const missing = [];
            if (!hasWrite) missing.push("file_write");
            if (!hasTest) missing.push("run_tests");
            if (!testsPassed) missing.push("tests passing (current: FAIL)");

            if (repairAttempts <= 3) {
              msgs.push({ role: "user", content: `[DISCIPLINE CHECK #${repairAttempts}] Your task_complete was REJECTED. Missing: ${missing.join(", ")}. You MUST complete ALL required steps. Retry now.` });
              continue; // Reject task_complete, continue loop
            }
          }
        }

        return { tools: toolsUsed, filesRead, filesWritten, testsPassed, tokens: totalT, cost: Math.round(totalC*1e6)/1e6, durationMs: Date.now()-start, passed: testsPassed || toolsUsed.includes("file_write"), disciplineReport: disciplined ? { repairAttempts, preconditionsMet: filesWritten.length > 0 && testsPassed } : undefined };
      }

      if (!hadTool && i >= 1) {
        if (disciplined && filesWritten.length === 0) {
          repairAttempts++;
          msgs.push({ role: "user", content: `[DISCIPLINE CHECK] No tools called and no file_write executed. You MUST: 1) file_read the source  2) file_write the fix  3) run_tests  4) task_complete. Try again.` });
          continue;
        }
        return { tools: toolsUsed, filesRead, filesWritten, testsPassed, tokens: totalT, cost: Math.round(totalC*1e6)/1e6, durationMs: Date.now()-start, passed: filesWritten.length > 0, disciplineReport: disciplined ? { repairAttempts, preconditionsMet: false } : undefined };
      }

      msgs.push({ role: "assistant", content: c });
    }
  }

  return { tools: toolsUsed, filesRead, filesWritten, testsPassed, tokens: totalT, cost: Math.round(totalC*1e6)/1e6, durationMs: Date.now()-start, passed: filesWritten.length > 0 };
}

async function main() {
  if (!API) { console.log("DEEPSEEK_API_KEY required"); process.exit(1); }
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Disciplined vs Undisciplined Benchmark  ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // ═══ Test 1: UNDISCIPLINED ═══
  console.log("━━━ Test 1: UNDISCIPLINED CodeAgent ━━━\n");
  await fs.mkdir(TMP + "/und/src", { recursive: true });
  await fs.mkdir(TMP + "/und/tests", { recursive: true });
  await fs.writeFile(TMP + "/und/package.json", JSON.stringify({name:"und",type:"module",scripts:{test:"vitest run"}},null,2));
  await fs.writeFile(TMP + "/und/vitest.config.ts", `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { globals: true } });\n`);
  await fs.writeFile(TMP + "/und/src/calc.ts",
`export function divide(a: number, b: number): number {
  if (b === 0) return 0; // BUG: should throw, not return 0
  return a / b;
}
`);
  await fs.writeFile(TMP + "/und/tests/calc.test.ts",
`import { describe, it, expect } from "vitest";
import { divide } from "../src/calc.js";
describe("divide", () => {
  it("divides positive numbers", () => expect(divide(10, 2)).toBe(5));
  it("throws on division by zero", () => expect(() => divide(5, 0)).toThrow());
});
`);

  const undisciplined = await runAgent(PRO,
    "You are a CodeAgent. Read the source and test files. Fix the divide() function. Run tests. Call task_complete when done.",
    "Fix the bug in src/calc.ts. The divide function returns 0 for division by zero but should throw an Error. Read the file, fix it, run tests.",
    TMP + "/und", false, 5);

  console.log(`   Tools: ${undisciplined.tools.join(" → ")}`);
  console.log(`   Files written: ${undisciplined.filesWritten.length}`);
  console.log(`   Tests passed: ${undisciplined.testsPassed}`);
  console.log(`   Fix applied: ${undisciplined.filesWritten.length > 0 ? "✅" : "❌"}`);
  console.log(`   Cost: $${undisciplined.cost.toFixed(4)} | ${undisciplined.durationMs}ms`);
  const undSrc = existsSync(TMP+"/und/src/calc.ts") ? readFileSync(TMP+"/und/src/calc.ts","utf-8") : "";
  console.log(`   File contains 'throw': ${undSrc.includes("throw")}\n`);

  // ═══ Test 2: DISCIPLINED ═══
  console.log("━━━ Test 2: DISCIPLINED CodeAgent ━━━\n");
  await fs.mkdir(TMP + "/disc/src", { recursive: true });
  await fs.mkdir(TMP + "/disc/tests", { recursive: true });
  await fs.writeFile(TMP + "/disc/package.json", JSON.stringify({name:"disc",type:"module",scripts:{test:"vitest run"}},null,2));
  await fs.writeFile(TMP + "/disc/vitest.config.ts", `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { globals: true } });\n`);
  await fs.writeFile(TMP + "/disc/src/calc.ts",
`export function divide(a: number, b: number): number {
  if (b === 0) return 0; // BUG: should throw, not return 0
  return a / b;
}
`);
  await fs.writeFile(TMP + "/disc/tests/calc.test.ts",
`import { describe, it, expect } from "vitest";
import { divide } from "../src/calc.js";
describe("divide", () => {
  it("divides positive numbers", () => expect(divide(10, 2)).toBe(5));
  it("throws on division by zero", () => expect(() => divide(5, 0)).toThrow());
});
`);

  const disciplined = await runAgent(PRO,
    "You are a CodeAgent. Read the source and test files. Fix the divide() function. Run tests. Call task_complete when done.",
    "Fix the bug in src/calc.ts. The divide function returns 0 for division by zero but should throw an Error. Read the file, fix it, run tests.",
    TMP + "/disc", true, 5);

  console.log(`   Tools: ${disciplined.tools.join(" → ")}`);
  console.log(`   Files written: ${disciplined.filesWritten.length}`);
  console.log(`   Tests passed: ${disciplined.testsPassed}`);
  console.log(`   Repair attempts: ${disciplined.disciplineReport?.repairAttempts || 0}`);
  console.log(`   Fix applied: ${disciplined.filesWritten.length > 0 ? "✅" : "❌"}`);
  console.log(`   Cost: $${disciplined.cost.toFixed(4)} | ${disciplined.durationMs}ms`);
  const discSrc = existsSync(TMP+"/disc/src/calc.ts") ? readFileSync(TMP+"/disc/src/calc.ts","utf-8") : "";
  console.log(`   File contains 'throw': ${discSrc.includes("throw")}\n`);

  // ═══ Comparison ═══
  console.log("══════════════════════════════════════════");
  console.log("  Comparison");
  console.log("══════════════════════════════════════════\n");
  console.log(`  Undisciplined: fix=${undisciplined.filesWritten.length > 0}, tests=${undisciplined.testsPassed}, $${undisciplined.cost.toFixed(4)}`);
  console.log(`  Disciplined:   fix=${disciplined.filesWritten.length > 0}, tests=${disciplined.testsPassed}, $${disciplined.cost.toFixed(4)}`);
  console.log(`  Discipline improved fix rate: ${disciplined.filesWritten.length > 0 && undisciplined.filesWritten.length === 0 ? "YES ✅" : "SAME"}`);
  console.log();

  await fs.rm(TMP, { recursive: true, force: true }).catch(()=>{});
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
