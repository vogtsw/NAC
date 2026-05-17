/**
 * SWE-bench Patch Agent — provides source in context, model outputs unified diff.
 * This is the standard approach used by most SWE-bench agents (SWE-Agent, etc).
 */
import dotenv from "dotenv";
dotenv.config({ path: "D:\\test\\mygithub\\jiqun\\.env" });
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import OpenAI from "openai";

const API_KEY = process.env.DEEPSEEK_API_KEY!;
const client = new OpenAI({ apiKey: API_KEY, baseURL: "https://api.deepseek.com/v1" });
const REPO_PATH = "D:\\test\\swebench-sandbox\\flask-4045";
const PYTHON = join(REPO_PATH, "venv", "Scripts", "python.exe");

function sh(cmd: string, cwd = REPO_PATH): string {
  try { return execSync(cmd, { cwd, encoding: "utf-8", timeout: 60000, maxBuffer: 5*1024*1024 }) || "(ok)"; }
  catch (e: any) { return (e.stdout||"")+"\n"+(e.stderr||""); }
}

async function evaluate(
  instanceId: string,
  problemStatement: string,
  repoFiles: Record<string, string>,
  failToPass: string[],
): Promise<{ resolved: boolean; patch: string; cost: number; tokens: number; ms: number }> {
  // Build context with file contents
  const fileContext = Object.entries(repoFiles)
    .map(([path, content]) => `<file path="${path}">\n${content}\n</file>`)
    .join("\n\n");

  const sysPrompt = `You are an expert Python developer fixing a bug in the Flask web framework.

${fileContext}

## Bug Report
${problemStatement}

## Tests That Must Pass After Fix
${failToPass.map(t => `- ${t}`).join("\n")}

## Instructions
1. Analyze the code to understand the root cause
2. Produce a minimal unified diff patch that fixes the bug
3. Output ONLY the diff in the following format:

\`\`\`diff
--- a/path/to/file
+++ b/path/to/file
@@ -line,num +line,num @@
 context line
-removed line
+added line
 context line
\`\`\`

IMPORTANT:
- Make the minimal change necessary
- Use ValueError, not assert, for input validation
- Keep existing code style and patterns
- Output ONLY the diff, no explanations`;

  const start = Date.now();
  const resp = await client.chat.completions.create({
    model: "deepseek-v4-pro",
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: "Fix the bug described above. Output only the diff patch." },
    ],
    temperature: 0.1,
    max_tokens: 4096,
    thinking: { type: "enabled" },
    reasoning_effort: "high",
  });

  const u = resp.usage!;
  const cost = (u.prompt_tokens/1e6)*0.14 + (u.completion_tokens/1e6)*0.42;
  const content = resp.choices[0]?.message?.content || "";
  const elapsed = Date.now() - start;

  console.log(`  Model: ${u.total_tokens} tokens, $${cost.toFixed(6)}, ${elapsed}ms`);

  // Extract diff from response
  let patch = "";
  const diffBlock = content.match(/```(?:diff)?\s*\n([\s\S]*?)\n```/);
  if (diffBlock) {
    patch = diffBlock[1];
  } else {
    // Try to find diff directly
    const diffMatch = content.match(/^diff --git[\s\S]*?(?=\n\n[^d]|\n\Z|$)/m);
    if (diffMatch) patch = diffMatch[0];
    else patch = content; // Use raw content as patch
  }

  if (!patch.trim()) {
    return { resolved: false, patch: "", cost, tokens: u.total_tokens, ms: elapsed };
  }

  // Apply patch
  const patchFile = join(REPO_PATH, "agent_patch.diff");
  writeFileSync(patchFile, patch, "utf-8");
  console.log(`  Patch: ${patch.split("\n").length} lines`);

  // Try to apply
  const applyResult = sh(`git apply --verbose "${patchFile}"`);
  if (applyResult.includes("error:")) {
    console.log(`  Apply failed: ${applyResult.slice(0, 300)}`);
    // Try patch command as fallback
    const patchResult = sh(`patch -p1 < "${patchFile}"`);
    console.log(`  patch fallback: ${patchResult.slice(0, 200)}`);
  }

  // Run tests
  const testIds = failToPass.join(" ");
  const testResult = sh(`"${PYTHON}" -m pytest ${testIds} -v --no-header --tb=short --rootdir="${REPO_PATH}"`);
  const allPass = failToPass.every(t => testResult.includes(t) && testResult.split(t)[1]?.includes("PASSED"));

  console.log(`  Tests: ${allPass ? "ALL PASS" : "SOME FAIL"}`);

  return { resolved: allPass, patch, cost, tokens: u.total_tokens, ms: elapsed };
}

async function main() {
  // Reset to pre-fix state
  sh("git checkout -- src/flask/blueprints.py");
  console.log("=== PRE-FIX ===");
  const preflight = sh(`"${PYTHON}" -m pytest tests/test_blueprints.py::test_dotted_name_not_allowed tests/test_blueprints.py::test_route_decorator_custom_endpoint_with_dots -v --no-header --tb=line --rootdir="${REPO_PATH}"`);
  console.log(preflight.split("\n").filter(l => l.includes("FAILED") || l.includes("PASSED") || l.includes("===")).join("\n"));

  // Read only the relevant source file
  const blueprintsPy = readFileSync(join(REPO_PATH, "src/flask/blueprints.py"), "utf-8");

  const instance = {
    instanceId: "pallets__flask-4045",
    problemStatement: `Blueprint names containing dots (.) should raise a ValueError.
Currently, when a Blueprint is created with a dotted name like "myapp.frontend",
no error is raised. This is problematic because dots are now significant for
nested blueprints. Additionally, the existing dot checks in add_url_rule use
assert statements (which raise AssertionError), but should use proper ValueError
exceptions to match Flask's validation style.

The fix needs to:
1. Add a ValueError check in Blueprint.__init__ for dotted names
2. Change add_url_rule's assert statements to raise ValueError`,
    files: { "src/flask/blueprints.py": blueprintsPy },
    failToPass: [
      "tests/test_blueprints.py::test_dotted_name_not_allowed",
      "tests/test_blueprints.py::test_route_decorator_custom_endpoint_with_dots",
    ],
  };

  console.log(`\n=== DEEPSEEK V4 PRO — ${instance.instanceId} ===`);

  // Try up to 2 attempts
  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`\n--- Attempt ${attempt} ---`);
    const result = await evaluate(
      instance.instanceId,
      instance.problemStatement,
      instance.files,
      instance.failToPass,
    );

    if (result.resolved) {
      console.log(`\n✅ RESOLVED on attempt ${attempt}!`);
      console.log(`  Cost: $${result.cost.toFixed(6)}  Tokens: ${result.tokens}  Time: ${result.ms}ms`);
      console.log(`\nPatch:\n${result.patch.slice(0, 1500)}`);
      process.exit(0);
    }

    console.log(`  ❌ Attempt ${attempt} failed`);
    if (attempt < 2) {
      // Reset and try with more explicit instructions
      sh("git checkout -- src/flask/blueprints.py");
    }
  }

  console.log("\n❌ NOT RESOLVED after 2 attempts");
  process.exit(1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
