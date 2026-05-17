/**
 * SWE-bench Direct Fix — provides source code in prompt, asks for patch.
 * More reliable than tool-based agent for focused bug fixes.
 */
import dotenv from "dotenv";
dotenv.config({ path: "D:\\test\\mygithub\\jiqun\\.env" });
import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import OpenAI from "openai";

const API_KEY = process.env.DEEPSEEK_API_KEY!;
const client = new OpenAI({ apiKey: API_KEY, baseURL: "https://api.deepseek.com/v1" });
const REPO_PATH = "D:\\test\\swebench-sandbox\\flask-4045";
const PYTHON = join(REPO_PATH, "venv", "Scripts", "python.exe");

function sh(cmd: string, cwd = REPO_PATH): string {
  try { return execSync(cmd, { cwd, encoding: "utf-8", timeout: 30000 }) || "(ok)"; }
  catch (e: any) { return `EXIT:${e.status} ${(e.stdout||"")+(e.stderr||"")}`.slice(0, 1000); }
}

// Verify current state
console.log("Pre-fix:");
console.log(sh(`"${PYTHON}" -m pytest tests/test_blueprints.py::test_dotted_name_not_allowed tests/test_blueprints.py::test_route_decorator_custom_endpoint_with_dots -v --no-header --rootdir="${REPO_PATH}"`));

// Read the source that needs fixing
const blueprintsPy = readFileSync(join(REPO_PATH, "src/flask/blueprints.py"), "utf-8");

// Extract the relevant sections
const initSection = blueprintsPy.split("def __init__")[2]; // Blueprint.__init__ is the 3rd __init__
const addUrlRuleSection = blueprintsPy.split("def add_url_rule")[2]; // Blueprint.add_url_rule is the 3rd

console.log("\nBlueprint.__init__ (relevant part):");
const initLines = initSection.split("\n").slice(0, 35);
console.log(initLines.map((l,i) => `${i+1}: ${l}`).join("\n"));

console.log("\nBlueprint.add_url_rule (relevant part):");
const urlLines = addUrlRuleSection.split("\n").slice(0, 20);
console.log(urlLines.map((l,i) => `${i+1}: ${l}`).join("\n"));

async function main() {
  const prompt = `Fix two bugs in this Flask Blueprint source code.

## Bug 1 — Blueprint name validation missing
In Blueprint.__init__, there is NO check for dots in the blueprint name. Add a check after the name assignment (after self.name = name). The fix should raise ValueError if "." is in the name.

## Bug 2 — Blueprint endpoint validation uses assert
In Blueprint.add_url_rule, the endpoint and view_func dot checks use assert, which raises AssertionError. Change these to raise ValueError instead, matching Flask's style.

Output ONLY a unified diff patch. Format:

\`\`\`diff
--- a/src/flask/blueprints.py
+++ b/src/flask/blueprints.py
@@ ... @@
 (your fix here)
\`\`\`

Here is the source file:
\`\`\`python
${blueprintsPy}
\`\`\``;

  console.log("\nSending to DeepSeek V4 Pro...");
  const start = Date.now();

  const resp = await client.chat.completions.create({
    model: "deepseek-v4-pro",
    messages: [
      { role: "system", content: "You are a Flask maintainer. Output only a unified diff patch. Be precise." },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 4096,
    thinking: { type: "enabled" },
    reasoning_effort: "high",
  });

  const content = resp.choices[0]?.message?.content || "";
  const usage = resp.usage!;
  const cost = (usage.prompt_tokens/1e6)*0.14 + (usage.completion_tokens/1e6)*0.42;

  console.log(`Response: ${usage.total_tokens} tokens, $${cost.toFixed(4)}, ${Date.now()-start}ms`);

  // Extract diff
  const diffMatch = content.match(/```(?:diff)?\s*\n?(diff --git[\s\S]*?)```/) ||
                    content.match(/(diff --git[\s\S]*?)(?:\n\Z|\n[^d])/);
  const patch = diffMatch?.[1] || "";

  if (!patch || patch.length < 20) {
    console.log("❌ No valid diff found in response");
    console.log("Raw response (first 2000 chars):");
    console.log(content.slice(0, 2000));
    process.exit(1);
  }

  console.log(`\nPatch (${patch.length} chars):`);
  console.log(patch.slice(0, 2000));

  // Apply patch
  const patchFile = join(REPO_PATH, "agent_fix.diff");
  writeFileSync(patchFile, patch, "utf-8");

  console.log("\nApplying patch...");
  const applyResult = sh(`git apply --verbose "${patchFile}"`);
  console.log(applyResult);

  // Run tests
  console.log("\nRunning FAIL_TO_PASS tests...");
  const testResult = sh(`"${PYTHON}" -m pytest tests/test_blueprints.py::test_dotted_name_not_allowed tests/test_blueprints.py::test_route_decorator_custom_endpoint_with_dots -v --no-header --rootdir="${REPO_PATH}"`);
  console.log(testResult);

  const passed = testResult.includes("2 passed");
  console.log(passed ? "\n✅ RESOLVED!" : "\n❌ NOT RESOLVED");
  console.log(`Cost: $${cost.toFixed(4)}  Time: ${Date.now()-start}ms`);
  process.exit(passed ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
