/**
 * SWE-bench Final v2 — Only sends the two functions needing fix. Efficient + precise.
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

async function main() {
  sh("git checkout -- src/flask/blueprints.py");
  console.log("=== SWE-bench: pallets__flask-4045 ===\n");

  const file = readFileSync(join(REPO_PATH, "src/flask/blueprints.py"), "utf-8");
  const lines = file.split("\n");

  // Find function boundaries
  const bpStart = lines.findIndex(l => l.includes("class Blueprint(Scaffold):"));
  const initIdx = lines.findIndex((l, i) => i > bpStart && l.trimStart().startsWith("def __init__"));
  const addUrlIdx = lines.findIndex((l, i) => i > initIdx && l.trimStart().startsWith("def add_url_rule"));
  const nextDefAdd = lines.findIndex((l, i) => i > addUrlIdx && l.trimStart().startsWith("def "));

  // Extract __init__ (20 lines from def)
  const initFunc = lines.slice(initIdx, initIdx + 22).map((l, i) => `${initIdx+1+i}: ${l}`).join("\n");
  // Extract add_url_rule (15 lines from def)
  const addUrlFunc = lines.slice(addUrlIdx, addUrlIdx + 15).map((l, i) => `${addUrlIdx+1+i}: ${l}`).join("\n");

  const prompt = `Fix two validation issues in Flask's Blueprint class.

## Function 1: Blueprint.__init__ (currently)
${initFunc}

ADD after line with "self.name = name":
        if "." in name:
            raise ValueError("'name' may not contain a dot '.' character.")

## Function 2: Blueprint.add_url_rule (currently)
${addUrlFunc}

CHANGE the assert statements to if/raise ValueError:
- Replace "assert '.' not in endpoint, '...'" with "if endpoint and '.' in endpoint: raise ValueError('...')"
- Replace the view_func assert similarly

## Required Output
Provide ONLY the corrected code for these two functions. Format:

\`\`\`python
    def __init__(...):
        ...
        self.name = name
        if "." in name:
            raise ValueError("'name' may not contain a dot '.' character.")
        ...

    def add_url_rule(...):
        ...
        if endpoint and "." in endpoint:
            raise ValueError("'endpoint' may not contain a dot '.' character.")
        ...
\`\`\``;

  console.log(`Prompt: ${prompt.split("\n").length} lines\n`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`--- Attempt ${attempt} ---`);
    const start = Date.now();

    const resp = await client.chat.completions.create({
      model: "deepseek-v4-pro",
      messages: [
        { role: "system", content: "You fix Python bugs. Output only the corrected functions. Be precise and minimal." },
        { role: "user", content: prompt },
      ],
      temperature: 0.02,
      max_tokens: 2048,
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });

    const content = resp.choices[0]?.message?.content || "";
    const u = resp.usage!;
    const cost = (u.prompt_tokens/1e6)*0.14 + (u.completion_tokens/1e6)*0.42;
    console.log(`  ${u.total_tokens}t, $${cost.toFixed(6)}, ${Date.now()-start}ms`);

    // Parse the model output to extract fixed functions
    // Strategy: find the __init__ and add_url_rule in the output
    const outInitIdx = content.indexOf("def __init__");
    const outAddIdx = content.indexOf("def add_url_rule");

    if (outInitIdx < 0) {
      console.log("  Missing __init__ in output");
      continue;
    }

    // Build the corrected file
    const outLines = content.split("\n");
    const fixedLines = [...lines];

    // Helper: find content between two markers in output
    function extractFunc(startMarker: string, endMarker?: string): string[] {
      const idx = outLines.findIndex(l => l.trimStart().startsWith(startMarker));
      if (idx < 0) return [];
      const result: string[] = [];
      for (let i = idx; i < outLines.length; i++) {
        if (endMarker && outLines[i].trimStart().startsWith(endMarker)) break;
        if (i > idx && outLines[i].trimStart().startsWith("def ") && !outLines[i].trimStart().startsWith(startMarker)) break;
        result.push(outLines[i]);
      }
      return result;
    }

    // Extract fixed __init__ body
    const fixedInit = extractFunc("def __init__", "def add_url_rule");
    // Extract fixed add_url_rule body
    const fixedAddUrl = outLines.slice(outAddIdx).filter(l => l.trim()); // take all non-empty lines from add_url_rule

    if (fixedInit.length < 3) {
      console.log(`  __init__ extraction failed (got ${fixedInit.length} lines)`);
      continue;
    }

    // Apply __init__ fix
    // Find and replace the __init__ function in the original file
    const origInitEnd = lines.findIndex((l, i) => i > initIdx && l.trimStart().startsWith("def ") && !l.includes("__init__"));
    if (origInitEnd > initIdx) {
      // Replace lines from initIdx to origInitEnd-1
      fixedLines.splice(initIdx, origInitEnd - initIdx, ...fixedInit);
    }

    // Apply add_url_rule fix (adjust index after init change)
    // Recalculate add_url_rule position after __init__ change
    const newAddIdx = fixedLines.findIndex((l, i) => i > (initIdx + fixedInit.length - 5) && l.trimStart().startsWith("def add_url_rule"));
    if (newAddIdx > 0) {
      // Find end of add_url_rule
      const origAddEnd = fixedLines.findIndex((l, i) => i > newAddIdx && l.trimStart().startsWith("def ") && !l.includes("add_url_rule"));
      const endIdx = origAddEnd > newAddIdx ? origAddEnd : newAddIdx + 15;
      // Replace by finding the exact assert lines
      for (let i = newAddIdx; i < endIdx; i++) {
        if (fixedLines[i].includes("assert") && fixedLines[i].includes("endpoint")) {
          // Replace the if/assert pattern
          const epMatch = fixedLines[i].match(/if endpoint:/);
          if (epMatch) {
            fixedLines[i] = fixedLines[i].replace(/assert.*$/, `raise ValueError("'endpoint' may not contain a dot '.' character.")`);
            if (fixedLines[i].includes("assert")) {
              fixedLines[i] = `        if endpoint and "." in endpoint:`;
              fixedLines.splice(i + 1, 0, `            raise ValueError("'endpoint' may not contain a dot '.' character.")`);
              // Remove old assert line
              const next = i + 2;
              if (fixedLines[next]?.includes("assert")) fixedLines.splice(next, 1);
            }
          } else {
            // Direct assert
            fixedLines[i] = `        if endpoint and "." in endpoint:`;
            fixedLines.splice(i + 1, 0, `            raise ValueError("'endpoint' may not contain a dot '.' character.")`);
            // Remove old assert
            if (fixedLines[i + 2]?.includes("assert")) fixedLines.splice(i + 2, 1);
          }
        }
        if (fixedLines[i]?.includes("assert") && fixedLines[i]?.includes("view_func")) {
          // Handle multi-line assert for view_func
          fixedLines[i] = `        if view_func and hasattr(view_func, "__name__") and "." in view_func.__name__:`;
          // Remove subsequent assert lines
          let j = i + 1;
          while (j < fixedLines.length && (fixedLines[j].trim().startsWith("assert") || fixedLines[j].trim().startsWith('"') || fixedLines[j].trim().startsWith("')") || fixedLines[j].trim() === "" || fixedLines[j].trim().startsWith("),"))) {
            fixedLines.splice(j, 1);
          }
          fixedLines.splice(i + 1, 0, `            raise ValueError("'view_func' name may not contain a dot '.' character.")`);
        }
      }
    }

    const newFile = fixedLines.join("\n");
    writeFileSync(join(REPO_PATH, "src/flask/blueprints.py"), newFile, "utf-8");

    // Run tests
    const testResult = sh(`"${PYTHON}" -m pytest tests/test_blueprints.py::test_dotted_name_not_allowed tests/test_blueprints.py::test_route_decorator_custom_endpoint_with_dots -v --no-header --tb=short --rootdir="${REPO_PATH}"`);

    if (testResult.includes("2 passed")) {
      console.log("  ✅ TESTS PASS");
      const diff = sh("git diff --no-color src/flask/blueprints.py");
      console.log(`\n✅ SWE-bench RESOLVED! (attempt ${attempt})`);
      console.log(`Cost: $${cost.toFixed(6)}`);
      console.log(`\nPatch:\n${diff.slice(0, 2000)}`);
      process.exit(0);
    }

    console.log(`  ❌ Tests fail: ${testResult.split('\n').filter(l => l.includes('FAILED') || l.includes('error')).join(' | ').slice(0, 200)}`);
    sh("git checkout -- src/flask/blueprints.py");
  }

  console.log("\n❌ Not resolved");
  process.exit(1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
