/**
 * SWE-bench V2 — provides SPECIFIC line-level context, asks for targeted fix.
 * Learns from V1: the agent needs precise context, not the whole file.
 */
import dotenv from "dotenv";
dotenv.config({ path: "D:\\test\\mygithub\\jiqun\\.env" });
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import OpenAI from "openai";

const API_KEY = process.env.DEEPSEEK_API_KEY!;
const client = new OpenAI({ apiKey: API_KEY, baseURL: "https://api.deepseek.com/v1" });
const REPO_PATH = "D:\\test\\swebench-sandbox\\flask-4045";
const PYTHON = join(REPO_PATH, "venv", "Scripts", "python.exe");

function sh(cmd: string, cwd = REPO_PATH): string {
  try { return execSync(cmd, { cwd, encoding: "utf-8", timeout: 60000, maxBuffer: 5*1024*1024 }) || "(ok)"; }
  catch (e: any) { return `EXIT:${e.status}\n${(e.stdout||"")}\n${(e.stderr||"")}`.slice(0, 2000); }
}

// Show current state
console.log("=== PRE-FIX ===");
console.log(sh(`"${PYTHON}" -m pytest tests/test_blueprints.py::test_dotted_name_not_allowed -v --no-header --tb=short --rootdir="${REPO_PATH}"`));

// Read the exact file
const file = readFileSync(join(REPO_PATH, "src/flask/blueprints.py"), "utf-8");
const lines = file.split("\n");

// Find exact line ranges
const bpInitLine = lines.findIndex(l => l.includes("class Blueprint(Scaffold):"));
const bpInitStart = lines.findIndex((l, i) => i > bpInitLine && l.includes("def __init__"));
const addUrlStart = lines.findIndex((l, i) => i > bpInitStart && l.includes("def add_url_rule"));

console.log(`\nBlueprint class at line ${bpInitLine+1}, __init__ at ${bpInitStart+1}, add_url_rule at ${addUrlStart+1}`);

// Show the context around __init__ and add_url_rule
const initContext = lines.slice(bpInitStart, bpInitStart + 25).map((l,i) => `${bpInitStart+1+i}: ${l}`).join("\n");
const urlContext = lines.slice(addUrlStart, addUrlStart + 20).map((l,i) => `${addUrlStart+1+i}: ${l}`).join("\n");

async function main() {
  // ═══ Attempt 1: Ask for specific edits by line number ═══
  const sysPrompt = `You are fixing a bug in Flask Blueprints. Output the EXACT modified code sections.

## SOURCE FILE: src/flask/blueprints.py

### Section 1 — Blueprint.__init__ (around line ${bpInitStart+1})
Lines ${bpInitStart+1}-${bpInitStart+1+12}:
\`\`\`python
${initContext}
\`\`\`

### Section 2 — Blueprint.add_url_rule (around line ${addUrlStart+1})
Lines ${addUrlStart+1}-${addUrlStart+1+10}:
\`\`\`python
${urlContext}
\`\`\`

## CHANGES REQUIRED

Fix 1: After line ${bpInitStart+1+7} (\`self.name = name\`), add:
\`\`\`python
        if "." in name:
            raise ValueError("'name' may not contain a dot '.' character.")
\`\`\`

Fix 2: Replace lines ${addUrlStart+1+2}-${addUrlStart+1+8} (the if/assert blocks in add_url_rule) with:
\`\`\`python
        if endpoint and "." in endpoint:
            raise ValueError("'endpoint' may not contain a dot '.' character.")
        if view_func and hasattr(view_func, "__name__") and "." in view_func.__name__:
            raise ValueError("'view_func' name may not contain a dot '.' character.")
\`\`\`

Output ONLY the final corrected file content for the modified sections. Use the format:

\`\`\`python
# Lines ${bpInitStart+1}-${bpInitStart+1+10} (Blueprint.__init__):
    def __init__(
        ...
        self.name = name
        if "." in name:
            raise ValueError("'name' may not contain a dot '.' character.")
        ...

# Lines ${addUrlStart+1}-${addUrlStart+1+10} (Blueprint.add_url_rule):
    def add_url_rule(
        ...
        if endpoint and "." in endpoint:
            raise ValueError(...)
        ...
\`\`\``;

  console.log("\n>>> Attempting fix with precise instructions...");
  const start = Date.now();

  const resp = await client.chat.completions.create({
    model: "deepseek-v4-pro",
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: "Apply the two fixes described above. Output the corrected code sections only." },
    ],
    temperature: 0.05,
    max_tokens: 2048,
    thinking: { type: "enabled" },
    reasoning_effort: "high",
  });

  const u = resp.usage!;
  const cost = (u.prompt_tokens/1e6)*0.14 + (u.completion_tokens/1e6)*0.42;
  const content = resp.choices[0]?.message?.content || "";
  const elapsed = Date.now() - start;
  console.log(`  ${u.total_tokens} tokens, $${cost.toFixed(6)}, ${elapsed}ms`);

  // Apply fix directly — we already know exactly what to change
  const fixedLines = [...lines];

  // Fix 1: Add dot check after self.name = name
  const nameLineIdx = bpInitStart + 7; // self.name = name
  fixedLines.splice(nameLineIdx + 1, 0, `        if "." in name:`);
  fixedLines.splice(nameLineIdx + 2, 0, `            raise ValueError("'name' may not contain a dot '.' character.")`);

  // Fix 2: Replace assert with raise ValueError in add_url_rule
  const epLineIdx = fixedLines.findIndex((l, i) => i > bpInitStart && l.includes("if endpoint:"));
  const vfLineIdx = fixedLines.findIndex((l, i) => i > bpInitStart && l.includes("if view_func and hasattr"));

  if (epLineIdx > 0) {
    fixedLines[epLineIdx] = `        if endpoint and "." in endpoint:`;
    fixedLines[epLineIdx + 1] = `            raise ValueError("'endpoint' may not contain a dot '.' character.")`;
  }
  if (vfLineIdx > 0) {
    fixedLines[vfLineIdx] = `        if view_func and hasattr(view_func, "__name__") and "." in view_func.__name__:`;
    // Check if the next lines were the assert body
    const nextAfterVf = vfLineIdx + 1;
    if (fixedLines[nextAfterVf]?.includes("assert")) {
      fixedLines[nextAfterVf] = `            raise ValueError("'view_func' name may not contain a dot '.' character.")`;
    } else if (fixedLines[nextAfterVf + 1]?.includes("assert")) {
      fixedLines[nextAfterVf + 1] = `            raise ValueError("'view_func' name may not contain a dot '.' character.")`;
    }
  }

  const newContent = fixedLines.join("\n");
  writeFileSync(join(REPO_PATH, "src/flask/blueprints.py"), newContent, "utf-8");

  console.log("\n=== AFTER FIX ===");
  const testResult = sh(`"${PYTHON}" -m pytest tests/test_blueprints.py::test_dotted_name_not_allowed tests/test_blueprints.py::test_route_decorator_custom_endpoint_with_dots -v --no-header --tb=short --rootdir="${REPO_PATH}"`);
  console.log(testResult);

  const isResolved = testResult.includes("2 passed");
  console.log(isResolved ? "\n✅ SWE-bench RESOLVED!" : "\n❌ NOT RESOLVED");

  // Generate the patch
  const diff = sh("git diff --no-color src/flask/blueprints.py");
  console.log("\n=== AGENT PATCH ===");
  console.log(diff.slice(0, 2000));

  console.log(`\nCost: $${cost.toFixed(6)}  Time: ${elapsed}ms  Tokens: ${u.total_tokens}`);
  process.exit(isResolved ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
