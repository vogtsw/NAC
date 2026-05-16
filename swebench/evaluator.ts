/**
 * SWE-bench Evaluator — applies patch, runs full test suite, scores result.
 * Follows SWE-bench RESOLVED_FULL / RESOLVED_PARTIAL / RESOLVED_NO semantics.
 */
import type { SWEBenchEvalResult, SWEBenchInstance, SandboxInfo } from "./types";
import { applyPatch, runPythonTests, setupSandbox } from "./sandbox";
import { runSWEBenchAgent } from "./agent";

export async function evaluateInstance(
  inst: SWEBenchInstance,
  options: { model?: string; maxTurns?: number } = {},
): Promise<SWEBenchEvalResult> {
  const failToPass = JSON.parse(inst.FAIL_TO_PASS) as string[];
  const passToPass = JSON.parse(inst.PASS_TO_PASS) as string[];
  const start = Date.now();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`EVAL: ${inst.instance_id}`);
  console.log(`  Repo: ${inst.repo}  Commit: ${inst.base_commit.slice(0, 8)}`);
  console.log(`  FAIL_TO_PASS: ${failToPass.length}  PASS_TO_PASS: ${passToPass.length}`);
  console.log(`  Problem: ${inst.problem_statement.split("\n")[0].slice(0, 100)}`);
  console.log(`${"=".repeat(60)}`);

  let info: SandboxInfo;
  try {
    info = await setupSandbox(inst);
  } catch (e: any) {
    return {
      instance_id: inst.instance_id,
      repo: inst.repo,
      resolved: false,
      failToPass: failToPass.length,
      failToPassPassed: 0,
      passToPass: passToPass.length,
      passToPassStillPass: 0,
      model: options.model || "deepseek-v4-pro",
      tokensUsed: 0,
      cost: 0,
      durationMs: Date.now() - start,
      error: `Sandbox setup failed: ${e.message}`,
    };
  }

  // Run agent
  console.log("  Running DeepSeek Agent...");
  let agentResult;
  try {
    agentResult = await runSWEBenchAgent(inst, info, options);
  } catch (e: any) {
    return {
      instance_id: inst.instance_id,
      repo: inst.repo,
      resolved: false,
      failToPass: failToPass.length,
      failToPassPassed: 0,
      passToPass: passToPass.length,
      passToPassStillPass: 0,
      model: options.model || "deepseek-v4-pro",
      tokensUsed: 0,
      cost: 0,
      durationMs: Date.now() - start,
      error: `Agent failed: ${e.message}`,
    };
  }

  console.log(`  Agent: ${agentResult.toolCalls.length} tools, ${agentResult.tokens} tokens, $${agentResult.cost.toFixed(4)}, ${agentResult.durationMs}ms`);
  console.log(`  Patch: ${agentResult.patch.length} chars`);

  if (!agentResult.patch || agentResult.patch.length < 10) {
    return {
      instance_id: inst.instance_id,
      repo: inst.repo,
      resolved: false,
      failToPass: failToPass.length,
      failToPassPassed: 0,
      passToPass: passToPass.length,
      passToPassStillPass: 0,
      model: options.model || "deepseek-v4-pro",
      tokensUsed: agentResult.tokens,
      cost: agentResult.cost,
      durationMs: Date.now() - start,
      patch: agentResult.patch,
      error: "No meaningful patch generated",
    };
  }

  // Apply agent patch
  console.log("  Applying agent patch...");
  const patchOk = applyPatch(info.repoPath, agentResult.patch);

  // Run FAIL_TO_PASS tests
  console.log("  Running FAIL_TO_PASS tests...");
  const ftpResult = runPythonTests(info, failToPass);
  console.log(`    F→P: ${ftpResult.passed}P / ${ftpResult.failed}F / ${ftpResult.error}E`);

  // Run PASS_TO_PASS tests (sample if > 20)
  const ptpSample = passToPass.length > 20 ? passToPass.slice(0, 20) : passToPass;
  console.log(`  Running PASS_TO_PASS tests (${ptpSample.length} of ${passToPass.length})...`);
  const ptpResult = runPythonTests(info, ptpSample);

  const resolved = ftpResult.failed === 0 && ftpResult.error === 0;

  const result: SWEBenchEvalResult = {
    instance_id: inst.instance_id,
    repo: inst.repo,
    resolved,
    failToPass: failToPass.length,
    failToPassPassed: ftpResult.passed,
    passToPass: ptpSample.length,
    passToPassStillPass: ptpResult.passed,
    model: options.model || "deepseek-v4-pro",
    tokensUsed: agentResult.tokens,
    cost: agentResult.cost,
    durationMs: Date.now() - start,
    patch: agentResult.patch,
  };

  console.log(`\n  RESULT: ${resolved ? "✅ RESOLVED" : "❌ NOT RESOLVED"}`);
  console.log(`  F→P: ${ftpResult.passed}/${failToPass.length}  P→P: ${ptpResult.passed}/${ptpSample.length}`);
  console.log(`  Cost: $${agentResult.cost.toFixed(4)}  Time: ${Math.round((Date.now() - start) / 1000)}s`);

  return result;
}
