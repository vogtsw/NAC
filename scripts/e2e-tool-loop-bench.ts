/**
 * E2E Tool-Loop Cluster Bench
 * 真实 Agent Loop + 工具调用 + 并行执行 + 文件读写 + apply_patch + run_tests
 * Usage: npx tsx scripts/e2e-tool-loop-bench.ts
 */
import "dotenv/config";
import { promises as fs, readFileSync, existsSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import OpenAI from "openai";

const TMP = "./test-loop-tmp/e2e-fixture-tool";
const API_KEY = process.env.DEEPSEEK_API_KEY!;
const MODEL_PRO = "deepseek-v4-pro";
const MODEL_FLASH = "deepseek-v4-flash";

// ═══════════════════════════════════════════
// 1. Simple Tool Executor
// ═══════════════════════════════════════════

function executeTool(name: string, args: Record<string, any>): string {
  const cwd = `${TMP}`;
  switch (name) {
    case "file_read":
    case "read_file": {
      const p = args.path || args.file;
      if (!existsSync(`${cwd}/${p}`)) return `ERROR: File not found: ${p}`;
      return readFileSync(`${cwd}/${p}`, "utf-8");
    }
    case "grep":
    case "grep_files": {
      try {
        const pattern = args.pattern || args.query || "";
        return execSync(`grep -rn "${pattern}" ${cwd}/${args.path || "."} 2>/dev/null || echo "no matches"`, { encoding: "utf-8", timeout: 5000 });
      } catch { return "no matches"; }
    }
    case "glob":
    case "list_dir": {
      const p = args.path || args.directory || ".";
      try { return execSync(`ls -la ${cwd}/${p} 2>/dev/null || echo "empty"`, { encoding: "utf-8" }); } catch { return "empty"; }
    }
    case "file_write":
    case "write_file": {
      const content = args.content || "";
      const p = args.path || args.file;
      try { writeFileSync(`${cwd}/${p}`, content, "utf-8"); return `Wrote ${content.length} bytes to ${p}`; }
      catch(e: any) { return `ERROR: ${e.message}`; }
    }
    case "file_edit":
    case "apply_patch": {
      const patch = args.patch || args.diff || args.content || "";
      try {
        writeFileSync(`${cwd}/.nac_patch.diff`, patch, "utf-8");
        execSync(`git apply ${cwd}/.nac_patch.diff 2>&1 || patch -p1 < ${cwd}/.nac_patch.diff 2>&1`, { cwd, encoding: "utf-8", timeout: 5000 });
        return "Patch applied successfully";
      } catch(e: any) { return `ERROR applying patch: ${e.message}`; }
    }
    case "bash":
    case "run_command": {
      const cmd = args.command || args.cmd || "";
      try {
        const stdout = execSync(cmd, { cwd, encoding: "utf-8", timeout: 30000, maxBuffer: 1024*1024 });
        return stdout || "(empty output, exit 0)";
      } catch(e: any) { return `ERROR: exit ${e.status || 1}: ${e.stderr || e.message}`; }
    }
    case "run_tests": {
      const cmd = args.command || "npx vitest run 2>&1";
      try {
        const stdout = execSync(cmd, { cwd, encoding: "utf-8", timeout: 60000, maxBuffer: 5*1024*1024, env: {...process.env, CI: "true"} });
        const passMatch = stdout.match(/(\d+)\s+passed/);
        const failMatch = stdout.match(/(\d+)\s+failed/);
        return `Tests: ${passMatch?.[1]||0} passed, ${failMatch?.[1]||0} failed\n${stdout.substring(stdout.length-500)}`;
      } catch(e: any) {
        const out = (e.stdout || "") + (e.stderr || "");
        const pm = out.match(/(\d+)\s+passed/); const fm = out.match(/(\d+)\s+failed/);
        return `Tests: ${pm?.[1]||0} passed, ${fm?.[1]||0} failed\n${out.substring(out.length-500)}`;
      }
    }
    case "task_complete": return `{"completed": true, "result": "${args.result || "done"}"}`;
    default: return `ERROR: Unknown tool: ${name}`;
  }
}

// ═══════════════════════════════════════════
// 2. Agent Loop — calls LLM, executes tools, repeats
// ═══════════════════════════════════════════

const TOOLS = [
  { name: "file_read", description: "Read a file", parameters: [{ name: "path", type: "string", required: true, description: "File path relative to project root" }] },
  { name: "grep_files", description: "Search code for pattern", parameters: [{ name: "pattern", type: "string", required: true, description: "Regex or text to search" }, { name: "path", type: "string", required: false, description: "Directory to search" }] },
  { name: "list_dir", description: "List directory contents", parameters: [{ name: "path", type: "string", required: false, description: "Directory path" }] },
  { name: "file_write", description: "Create or overwrite a file", parameters: [{ name: "path", type: "string", required: true, description: "File path" }, { name: "content", type: "string", required: true, description: "File content" }] },
  { name: "apply_patch", description: "Apply a unified diff patch to files", parameters: [{ name: "diff", type: "string", required: true, description: "Unified diff content" }] },
  { name: "bash", description: "Run a shell command", parameters: [{ name: "command", type: "string", required: true, description: "Command to run" }] },
  { name: "run_tests", description: "Run project tests and report results", parameters: [{ name: "command", type: "string", required: false, description: "Test command" }] },
  { name: "task_complete", description: "Mark task as complete", parameters: [{ name: "result", type: "string", required: true, description: "What was accomplished" }] },
];

const TOOL_DEFS = TOOLS.map(t =>
  `- ${t.name}: ${t.description}\n  Parameters: ${t.parameters.map(p => `${p.name}(${p.type}${p.required ? ", required" : ""}): ${p.description}`).join(", ")}`
).join("\n");

interface TurnResult { role: string; content: string; toolCalls: string[]; toolResults: string[]; tokens: number; cost: number; }

async function agentLoop(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userTask: string,
  maxTurns = 8,
): Promise<{ turns: TurnResult[]; finalOutput: string; totalCost: number; totalTokens: number; passed: boolean }> {
  const messages: any[] = [
    { role: "system", content: systemPrompt + "\n\n## Available Tools\n" + TOOL_DEFS + "\n\nWhen you need information, call a tool by responding with a JSON block:\n```json\n{\"tool\": \"<tool_name>\", \"args\": {<parameters>}}\n```\nAfter receiving tool output, continue reasoning. Call task_complete when done." },
    { role: "user", content: userTask },
  ];

  const turns: TurnResult[] = [];
  let totalCost = 0;
  let totalTokens = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    const isPro = model === MODEL_PRO;
    const body: any = {
      model, messages,
      temperature: 0.3, max_tokens: 2000,
      thinking: { type: "enabled" },
      ...(isPro ? { reasoning_effort: "high" } : {}),
    };

    const resp = await client.chat.completions.create(body);
    const choice = resp.choices[0];
    const content = choice.message?.content || "";
    const usage = resp.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    const cost = isPro
      ? (usage.prompt_tokens/1e6)*0.14 + (usage.completion_tokens/1e6)*0.42
      : (usage.prompt_tokens/1e6)*0.04 + (usage.completion_tokens/1e6)*0.12;
    totalCost += cost;
    totalTokens += usage.total_tokens;

    const turnResult: TurnResult = {
      role: "assistant",
      content: content.substring(0, 300),
      toolCalls: [], toolResults: [],
      tokens: usage.total_tokens, cost: Math.round(cost*1e6)/1e6,
    };

    // Parse tool calls from response
    const jsonBlocks = content.match(/```json\s*\n?(\{[\s\S]*?\})\s*```/g) || [];
    const inlineJsons = content.match(/\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[^}]+\}\}/g) || [];
    const allMatches = [...jsonBlocks.map(b => b.replace(/```json\s*\n?/, "").replace(/\s*```/, "")), ...inlineJsons];

    for (const jsonStr of allMatches) {
      try {
        const call = JSON.parse(jsonStr);
        if (call.tool && call.args) {
          turnResult.toolCalls.push(`${call.tool}(${JSON.stringify(call.args).substring(0, 80)})`);
          const result = executeTool(call.tool, call.args);
          turnResult.toolResults.push(result.substring(0, 200));
          messages.push({ role: "assistant", content: `Called ${call.tool}: ${JSON.stringify(call.args)}` });
          messages.push({ role: "user", content: `Tool result (${call.tool}):\n${result}` });
        }
      } catch { /* skip malformed JSON */ }
    }

    // Check for task_complete or final answer
    if (content.includes("task_complete") || (turnResult.toolCalls.length === 0 && turn >= 1)) {
      turns.push(turnResult);
      const passed = content.includes("task_complete") || content.length > 50;
      return { turns, finalOutput: content, totalCost, totalTokens, passed };
    }

    turns.push(turnResult);
    messages.push({ role: "assistant", content });
  }

  return { turns, finalOutput: turns[turns.length-1]?.content || "no output", totalCost, totalTokens, passed: true };
}

// ═══════════════════════════════════════════
// 3. Main — Cluster Bench with Tool Loops
// ═══════════════════════════════════════════

async function main() {
  if (!API_KEY) { console.log("FAIL: DEEPSEEK_API_KEY required"); process.exit(1); }

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  NAC DeepSeek Tool-Loop E2E Cluster Bench   ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // Setup fixture
  await fs.mkdir(`${TMP}/src`, { recursive: true });
  await fs.mkdir(`${TMP}/tests`, { recursive: true });
  await fs.writeFile(`${TMP}/package.json`, JSON.stringify({ name: "fixture", type: "module", scripts: { test: "vitest run" } }, null, 2));
  await fs.writeFile(`${TMP}/vitest.config.ts`, `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { globals: true } });\n`);
  await fs.writeFile(`${TMP}/src/math.ts`, "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
  await fs.writeFile(`${TMP}/tests/math.test.ts`, `import { describe, it, expect } from "vitest";
import { add } from "../src/math.js";
describe("math", () => {
  it("add(2,3) should be 5", () => {
    expect(add(2, 3)).toBe(6); // BUG: should be 5
  });
});
`);
  console.log("Fixture ready:\n  src/math.ts — correct add()\n  tests/math.test.ts — expects 6, should be 5\n");

  const client = new OpenAI({ apiKey: API_KEY, baseURL: "https://api.deepseek.com/v1" });

  const clusterResults: Record<string, any> = {};
  const startTime = Date.now();

  // ── Step 1: Planner (Pro, thinking high) ──
  console.log("📋 [PlannerAgent] Pro·thinking·high → Creating execution plan...");
  const planResult = await agentLoop(client, MODEL_PRO,
    "You are the PlannerAgent. Analyze the task and create a numbered execution plan. Then call task_complete.",
    "Task: Fix the failing test in tests/math.test.ts. The add() function in src/math.ts correctly returns a+b. The test expects add(2,3)=6 but it should be 5. The BUG IS IN THE TEST, not the implementation.\n\nFirst read tests/math.test.ts and src/math.ts to understand the code. Then create a plan.",
    4,
  );
  clusterResults.planner = planResult;
  const planPreview = planResult.finalOutput.replace(/\n/g, " ").substring(0, 120);
  console.log(`   ✓ ${planResult.turns.length} turns, ${planResult.totalTokens}t, $${planResult.totalCost.toFixed(4)}`);
  planResult.turns.forEach(t => {
    t.toolCalls.forEach((c,i) => console.log(`     🔧 ${c} → ${(t.toolResults[i]||"").substring(0, 80)}`));
  });

  // ── Steps 2a-2b: Researchers (Flash, parallel!) ──
  console.log("\n🔍 [ResearchAgent×2] Flash·parallel → Scanning src/ and tests/...");
  const [srcResult, testResult] = await Promise.all([
    agentLoop(client, MODEL_FLASH,
      "You are a ResearchAgent. Read and analyze the source code. Use file_read to read files. Then call task_complete with a summary.",
      "Read and analyze src/math.ts. What does this file contain? What functions are exported? Call task_complete when done.",
      3,
    ),
    agentLoop(client, MODEL_FLASH,
      "You are a ResearchAgent. Read and analyze the test file. Use file_read to read files. Then call task_complete with a summary.",
      "Read and analyze tests/math.test.ts. What does this file test? What assertion is wrong? Call task_complete when done.",
      3,
    ),
  ]);
  clusterResults.researcher_src = srcResult;
  clusterResults.researcher_test = testResult;
  console.log(`   src/  → ${srcResult.turns.length}t, ${srcResult.totalTokens}t, $${srcResult.totalCost.toFixed(4)}`);
  srcResult.turns.forEach(t => {
    t.toolCalls.forEach((c,i) => console.log(`     🔧 ${c} → ${(t.toolResults[i]||"").substring(0, 80)}`));
  });
  console.log(`   tests/ → ${testResult.turns.length}t, ${testResult.totalTokens}t, $${testResult.totalCost.toFixed(4)}`);
  testResult.turns.forEach(t => {
    t.toolCalls.forEach((c,i) => console.log(`     🔧 ${c} → ${(t.toolResults[i]||"").substring(0, 80)}`));
  });

  // ── Step 3: Code Agent (Pro, thinking high) ──
  console.log("\n💻 [CodeAgent] Pro·thinking·high → Generating and applying patch...");
  const codeResult = await agentLoop(client, MODEL_PRO,
    `You are the CodeAgent. Fix the bug by editing the test file.
Steps:
1. Read the test file with file_read: tests/math.test.ts
2. The add() function returns a+b correctly (5 for 2+3). The test EXPECTS 6 which is WRONG.
3. Use file_write to write the CORRECTED test file (change toBe(6) to toBe(5))
4. Use run_tests to verify the fix passes
5. Call task_complete`,
    `Fix the test bug: tests/math.test.ts expects add(2,3) to be 6 but the correct answer is 5.
Researcher found: ${srcResult.finalOutput.substring(0, 200)}
Test analysis: ${testResult.finalOutput.substring(0, 200)}

Fix the test, apply the patch, and run tests to verify.`,
    5,
  );
  clusterResults.code = codeResult;
  console.log(`   ✓ ${codeResult.turns.length}t, ${codeResult.totalTokens}t, $${codeResult.totalCost.toFixed(4)}`);
  codeResult.turns.forEach(t => {
    t.toolCalls.forEach((c,i) => console.log(`     🔧 ${c} → ${(t.toolResults[i]||"").substring(0, 80)}`));
  });

  // ── Step 4: Verify actual file change ──
  console.log("\n🧪 [Verification] Checking actual file...");
  const finalTestContent = readFileSync(`${TMP}/tests/math.test.ts`, "utf-8");
  const fixed = !finalTestContent.includes("toBe(6)") && finalTestContent.includes("toBe(5)");
  console.log(`   File fixed: ${fixed ? "✅ YES (toBe(6) → toBe(5))" : "❌ NO"}`);

  // ── Results ──
  const duration = (Date.now() - startTime) / 1000;
  const totalCost = Object.values(clusterResults).reduce((s: number, r: any) => s + (r.totalCost || 0), 0);
  const totalTokens = Object.values(clusterResults).reduce((s: number, r: any) => s + (r.totalTokens || 0), 0);
  const allToolsUsed = Object.values(clusterResults).every((r: any) =>
    r.turns.some((t: any) => t.toolCalls.length > 0)
  );

  console.log("\n══════════════════════════════════════════════");
  console.log(`  Status:      ${fixed ? "✅ PASSED" : "❌ FAILED"}`);
  console.log(`  File Fixed:  ${fixed ? "YES" : "NO"}`);
  console.log(`  Tools Used:  ${allToolsUsed ? "YES (every agent called real tools)" : "PARTIAL"}`);
  console.log(`  Parallel:    YES (2 researchers ran concurrently)`);
  console.log(`  Duration:    ${duration.toFixed(1)}s`);
  console.log(`  Total Cost:  $${totalCost.toFixed(4)}`);
  console.log(`  Est Tokens:  ${totalTokens.toLocaleString()}`);
  console.log(`  File state:  ${finalTestContent.includes("toBe(5)") ? "toBe(5) ✓" : "STILL toBe(6) ✗"}`);
  console.log("══════════════════════════════════════════════\n");

  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
  process.exit(fixed ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
