/**
 * NAC Gap Analysis — automated recurring health check.
 * Runs: test suite, type-check, counts eval scenarios, checks source claims.
 * Outputs structured Deployed/Missing/Quality/Priorities report.
 *
 * Usage: npx tsx scripts/gap-analysis.ts
 */
import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const ROOT = "D:\\test\\mygithub\\jiqun";

function sh(cmd: string, cwd = ROOT): string {
  try { return execSync(cmd, { cwd, encoding: "utf-8", timeout: 120000, maxBuffer: 10*1024*1024 }) || ""; }
  catch (e: any) { return (e.stdout || "") + (e.stderr || ""); }
}

function countFiles(dir: string, ext = ".ts"): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const f of readdirSync(dir, { recursive: true })) {
    if (typeof f === "string" && f.endsWith(ext)) n++;
  }
  return n;
}

function fileLines(path: string): number {
  try { return readFileSync(path, "utf-8").split("\n").length; } catch { return 0; }
}

// ═══ 1. VCS ═══
const commits = sh("git log --oneline -5").trim();
const unpushed = sh("git log --oneline origin/master..HEAD 2>/dev/null").trim();
const changed = sh("git diff --stat HEAD 2>/dev/null").trim();

// ═══ 2. Tests ═══
const testOut = sh("pnpm test 2>&1");
const testMatch = testOut.match(/Tests\s+(\d+)\s+passed/);
const testPassed = testMatch?.[1] || "?";
const testFailedMatch = testOut.match(/Tests\s+.*?(\d+)\s+failed/);
const testFailed = testFailedMatch?.[1] || "0";
const testFilesMatch = testOut.match(/(\d+)\s+passed.*?\n/);
const testFileCount_vi = (testFilesMatch?.[1]) || "?";

// ═══ 3. Type-check ═══
const tcOut = sh("pnpm type-check 2>&1");
const typeOk = !tcOut.includes("error TS");

// ═══ 4. Source structure ═══
const srcFiles = countFiles(join(ROOT, "src"));
const testFileCount = countFiles(join(ROOT, "tests"));
const orchestratorFiles = readdirSync(join(ROOT, "src", "orchestrator")).filter(f => f.endsWith(".ts"));
const clusterAgents = existsSync(join(ROOT, "src", "agents", "cluster"));
const clusterAgentFiles = clusterAgents ? readdirSync(join(ROOT, "src", "agents", "cluster")).filter(f => f.endsWith(".ts")) : [];
const llmFiles = readdirSync(join(ROOT, "src", "llm")).filter(f => f.endsWith(".ts"));
const toolRepairFiles = existsSync(join(ROOT, "src", "llm", "tool-repair")) ? readdirSync(join(ROOT, "src", "llm", "tool-repair")).filter(f => f.endsWith(".ts")) : [];
const securityFiles = existsSync(join(ROOT, "src", "security")) ? readdirSync(join(ROOT, "src", "security")).filter(f => f.endsWith(".ts")) : [];

// ═══ 5. Eval scenarios ═══
const evalDir = join(ROOT, "eval", "scenarios");
const layerDirs = existsSync(evalDir) ? readdirSync(evalDir).filter(f => statSync(join(evalDir, f)).isDirectory()) : [];
const scenarioCounts: Record<string, number> = {};
for (const d of layerDirs) {
  scenarioCounts[d] = countFiles(join(evalDir, d), ".md");
}

// ═══ 6. Claim verification ═══
const claims: Record<string, boolean> = {};

function fileContains(filePath: string, ...patterns: string[]): boolean {
  try {
    const content = readFileSync(join(ROOT, filePath), "utf-8");
    return patterns.some(p => content.includes(p));
  } catch { return false; }
}

function anySourceContains(...patterns: string[]): boolean {
  function scanDir(dir: string): boolean {
    if (!existsSync(dir)) return false;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules" && scanDir(p)) return true;
      } else if (entry.name.endsWith(".ts")) {
        try {
          const c = readFileSync(p, "utf-8");
          if (patterns.some(pat => c.includes(pat))) return true;
        } catch {}
      }
    }
    return false;
  }
  return scanDir(join(ROOT, "src"));
}

claims["agent_open/eval/close"] = anySourceContains("agent_open", "agent_eval", "agent_close");
claims["handle_read"] = anySourceContains("handle_read", "var_handle");
claims["lsp_diagnostics"] = anySourceContains("lsp_diagnostics", "LSPDiagnostics");
claims["useClusterPath"] = fileContains("src/orchestrator/Orchestrator.ts", "useClusterPath");
claims["finalResponse_redaction"] = fileContains("src/agent/loop.ts", "redactSecrets");

// DeepSeekPricing
claims["unified_pricing"] = existsSync(join(ROOT, "src", "llm", "DeepSeekPricing.ts"));

// Disciplined loop
claims["disciplined_loop"] = existsSync(join(ROOT, "src", "agent", "disciplined-loop.ts"));

// MCP Skill
claims["mcp_skill"] = existsSync(join(ROOT, "src", "skills", "builtin", "MCPSkill.ts"));

// PR Generator
claims["pr_generator"] = existsSync(join(ROOT, "src", "orchestrator", "PRGenerator.ts"));

// Blackboard
claims["blackboard_api"] = fileLines(join(ROOT, "src", "state", "Blackboard.ts")) > 80;

// ═══ 7. Report ═══
console.log("══════════════════════════════════════════════");
console.log("  NAC DeepSeek Cluster — Gap Analysis");
console.log(`  ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`);
console.log("══════════════════════════════════════════════\n");

console.log("## VCS");
console.log(`  Last commits:\n${commits.split("\n").map(l => "    " + l).join("\n")}`);
console.log(`  Unpushed: ${unpushed ? unpushed.split("\n").length + " commits" : "none"}`);
console.log(`  Uncommitted: ${changed ? "YES" : "none"}\n`);

console.log("## Health");
console.log(`  Tests:       ${testPassed} passed / ${testFailed} failed  (${testFileCount} test files)`);
console.log(`  Type-check:  ${typeOk ? "✅ PASS" : "❌ FAIL"}`);

// Estimate eval score from cached result
const evalResultPath = join(ROOT, "eval", "reports", "benchmark-result.md");
if (existsSync(evalResultPath)) {
  const evalMd = readFileSync(evalResultPath, "utf-8");
  const scoreMatch = evalMd.match(/Score\s*\|\s*([\d.]+)%/);
  if (scoreMatch) console.log(`  Eval Score:  ${scoreMatch[1]}%`);
}
console.log();

console.log("## Source Inventory");
console.log(`  src/ files:      ${srcFiles}`);
console.log(`  test/ files:     ${testFileCount}`);
console.log(`  orchestrator:    ${orchestratorFiles.join(", ")}`);
console.log(`  cluster agents:  ${clusterAgentFiles.join(", ")}`);
console.log(`  llm modules:     ${llmFiles.join(", ")}`);
console.log(`  tool-repair:     ${toolRepairFiles.join(", ")}`);
console.log(`  security:        ${securityFiles.join(", ")}`);
console.log(`  eval scenarios:  ${Object.values(scenarioCounts).reduce((a,b)=>a+b, 0)} in ${Object.keys(scenarioCounts).length} layers`);
for (const [layer, count] of Object.entries(scenarioCounts)) {
  console.log(`    ${layer}: ${count}`);
}
console.log();

console.log("## Claim Verification (goal.md / todo.md)");
for (const [claim, ok] of Object.entries(claims)) {
  console.log(`  ${ok ? "✅" : "❌"} ${claim}`);
}
console.log();

console.log("## Deployed Features");
const deployed = Object.entries(claims).filter(([,ok]) => ok).map(([c]) => c);
for (const d of deployed) console.log(`  ✅ ${d}`);
console.log();

console.log("## Missing Features");
const missing = Object.entries(claims).filter(([,ok]) => !ok).map(([c]) => c);
for (const m of missing) console.log(`  ❌ ${m}`);
console.log();

console.log("## Quality Issues");
if (!claims["agent_open/eval/close"]) console.log("  🔴 agent_open/eval/close — persistent sub-agent sessions not implemented (only one-shot delegate)");
if (!claims["handle_read"]) console.log("  🔴 handle_read — tool output overflow not handled");
if (!claims["lsp_diagnostics"]) console.log("  🟡 lsp_diagnostics — not implemented");
if (!claims["finalResponse_redaction"]) console.log("  🔴 finalResponse redaction — API keys can leak in agent output");
console.log();

console.log("## Next Priorities");
const priorities: string[] = [];
if (!claims["finalResponse_redaction"]) priorities.push("1. Fix secret redaction on agent final output (P0)");
if (!claims["agent_open/eval/close"]) priorities.push("2. Implement agent_open / agent_eval / agent_close (P0 — MVP blocker)");
if (!claims["handle_read"]) priorities.push("3. Implement handle_read for tool output overflow (P1)");
if (!claims["lsp_diagnostics"]) priorities.push("4. Add lsp_diagnostics tool (P2)");
if (unpushed) priorities.push("5. Push unpushed commits to GitHub");
for (const p of priorities) console.log(`  ${p}`);
console.log();

// Exit code: fail if any P0 item is broken
const p0Ok = claims["finalResponse_redaction"] && claims["agent_open/eval/close"] && claims["handle_read"];
process.exit(p0Ok ? 0 : 1);
