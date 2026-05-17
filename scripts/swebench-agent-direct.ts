/**
 * Direct SWE-bench Agent — runs DeepSeek on a single SWE-bench instance.
 * Reads the pre-setup sandbox and attempts to fix the issue.
 */
import dotenv from "dotenv";
dotenv.config({ path: "D:\\test\\mygithub\\jiqun\\.env" });
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import OpenAI from "openai";

const API_KEY = process.env.DEEPSEEK_API_KEY!;
const PRO = "deepseek-v4-pro";
const client = new OpenAI({ apiKey: API_KEY, baseURL: "https://api.deepseek.com/v1" });

const REPO_PATH = "D:\\test\\swebench-sandbox\\flask-4045";
const PYTHON = join(REPO_PATH, "venv", "Scripts", "python.exe");

function sh(cmd: string, cwd = REPO_PATH, timeout = 60000): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", timeout, maxBuffer: 5 * 1024 * 1024 }) || "(ok)";
  } catch (e: any) {
    return `EXIT:${e.status} ${(e.stdout || "") + (e.stderr || "")}`.slice(0, 2000);
  }
}

function readFile(path: string): string {
  const p = join(REPO_PATH, path);
  if (!existsSync(p)) return `[NOT FOUND: ${path}]`;
  try { return readFileSync(p, "utf-8"); } catch { return `[ERROR: ${path}]`; }
}

function writeFile(path: string, content: string): string {
  const p = join(REPO_PATH, path);
  try { writeFileSync(p, content, "utf-8"); return `OK ${content.length}B`; } catch (e: any) { return `ERROR: ${e.message}`; }
}

function runTests(testList: string): string {
  const tests = testList.split(",").map(s => s.trim()).filter(Boolean);
  const results: string[] = [];
  for (const t of tests) {
    const r = sh(`"${PYTHON}" -m pytest ${t} -v --no-header --rootdir="${REPO_PATH}"`, REPO_PATH, 60000);
    const pm = r.match(/(\d+) passed/); const fm = r.match(/(\d+) failed/);
    results.push(`${t}: ${pm?.[1] || "0"}P ${fm?.[1] || "0"}F`);
  }
  return results.join("\n");
}

async function main() {
  console.log("SWE-bench Agent: pallets__flask-4045\n");

  const failToPass = [
    "tests/test_blueprints.py::test_dotted_name_not_allowed",
    "tests/test_blueprints.py::test_route_decorator_custom_endpoint_with_dots",
  ];
  const passToPassSample = [
    "tests/test_blueprints.py::test_templates_list",
    "tests/test_blueprints.py::test_url_processors",
    "tests/test_blueprints.py::test_route_decorator_custom_endpoint_without_dots",
  ];

  // Verify pre-fix state
  console.log("Pre-fix state:");
  console.log(runTests(failToPass.join(",")));
  console.log();

  const sysPrompt = `You are a Senior Software Engineer fixing a bug in Flask (pallets/flask).
Working directory: ${REPO_PATH}
Python venv: ${PYTHON}

## BUG
When a Blueprint name contains a dot (.) character, Flask should raise a ValueError.
Currently, dots in Blueprint names cause issues with nested blueprints (dots are now significant).
An error was already added for endpoint names but NOT for Blueprint names.

## TASK
Fix the Blueprint class so that:
1. Blueprint.__init__ raises ValueError if name contains a dot
2. Blueprint.add_url_rule raises ValueError (not AssertionError) if endpoint contains a dot

## TOOLS
Use JSON format:
\`\`\`json
{"tool": "file_read", "args": {"path": "src/flask/blueprints.py"}}
\`\`\`

- file_read(path) — read a file
- file_write(path, content) — write/replace a file
- run_tests(test_list) — run comma-separated pytest IDs
- bash(command) — run shell command
- submit_fix — submit your fix when tests pass

## TESTS THAT MUST PASS
${failToPass.join("\n")}

## IMPORTANT
- Read the source first to understand the code structure
- Make MINIMAL changes — only fix the described bug
- Change assert to raise ValueError for the endpoint check
- Add a ValueError check for dotted Blueprint names in __init__
- Keep code style consistent`;

  const messages: any[] = [
    { role: "system", content: sysPrompt },
    { role: "user", content: `The file to fix is src/flask/blueprints.py. Read it first to understand the code, then fix the two issues:
1. Blueprint.__init__ doesn't check for dots in the name
2. Blueprint.add_url_rule uses assert instead of raise ValueError for endpoint validation

The failing tests are: ${failToPass.join(", ")}` },
  ];

  let totalTokens = 0, totalCost = 0;
  const start = Date.now();

  for (let turn = 0; turn < 8; turn++) {
    console.log(`--- Turn ${turn + 1} ---`);
    const isPro = true;
    const body: any = { model: PRO, messages, temperature: 0.2, max_tokens: 4096 };
    body.thinking = { type: "enabled" };
    body.reasoning_effort = turn < 3 ? "high" : "max";

    const resp = await client.chat.completions.create(body);
    const content = resp.choices[0]?.message?.content || "";
    const u = resp.usage!;
    totalTokens += u.total_tokens;
    totalCost += (u.prompt_tokens / 1e6) * 0.14 + (u.completion_tokens / 1e6) * 0.42;

    // Show reasoning briefly
    console.log(`  (${u.total_tokens} tokens, $${((u.prompt_tokens / 1e6) * 0.14 + (u.completion_tokens / 1e6) * 0.42).toFixed(4)})`);

    // Parse tool calls
    const toolPatterns = [
      ...(content.match(/```(?:json)?\s*\n?(\{[\s\S]*?\})\s*```/g) || []).map(b => b.replace(/```(?:json)?\s*\n?/, "").replace(/\s*```/, "")),
      ...(content.match(/\{[^}]*"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[^}]+\}[^}]*\}/g) || []),
    ];

    let acted = false;
    for (const m of toolPatterns) {
      try {
        const call = JSON.parse(m);
        if (!call.tool) continue;
        const tname = call.tool as string;
        const args = call.args || {};
        acted = true;

        console.log(`  > ${tname}(${JSON.stringify(args).slice(0, 100)})`);
        let result = "";

        switch (tname) {
          case "file_read":
            result = readFile(args.path || "").slice(0, 5000);
            break;
          case "file_write":
            result = writeFile(args.path || "", args.content || "");
            break;
          case "run_tests":
            result = runTests(args.test_list || "");
            break;
          case "bash":
            result = sh(args.command || "echo ok").slice(0, 2000);
            break;
          case "submit_fix":
            result = "FIX SUBMITTED ✓";
            break;
          default:
            result = `Unknown: ${tname}`;
        }

        const short = result.slice(0, 300);
        console.log(`  < ${short}${result.length > 300 ? "..." : ""}`);

        messages.push({ role: "assistant", content: `Called ${tname}` });
        messages.push({ role: "user", content: `Result:\n${result}` });

        if (tname === "submit_fix") {
          // Evaluate
          const final = runTests(failToPass.join(","));
          console.log(`\nFINAL TEST RESULT:\n${final}`);
          const allPass = failToPass.every(t => final.includes(t) && final.includes("1P 0F"));
          console.log(allPass ? "\n✅ RESOLVED!" : "\n❌ NOT RESOLVED");

          console.log(`\nTokens: ${totalTokens}  Cost: $${totalCost.toFixed(4)}  Time: ${Date.now() - start}ms`);
          process.exit(allPass ? 0 : 1);
        }
      } catch { /* not JSON */ }
    }

    if (!acted) {
      messages.push({ role: "assistant", content: content.slice(0, 1000) });
      if (turn >= 1 && !content.includes('"tool"')) {
        messages.push({ role: "user", content: 'Call a tool. Format: ```json\n{"tool": "file_read", "args": {"path": "src/flask/blueprints.py"}}\n```' });
      }
    }

    if (turn >= 3 && !messages.some((m: any) => m.content?.includes("file_write"))) {
      messages.push({ role: "user", content: "Make the fix now with file_write." });
    }
  }

  // Ran out of turns
  console.log("\n⚠ Out of turns — checking final state");
  const final = runTests(failToPass.join(","));
  console.log(final);
  console.log(`Tokens: ${totalTokens}  Cost: $${totalCost.toFixed(4)}`);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
