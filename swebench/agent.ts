/**
 * SWE-bench DeepSeek Agent — reads repo source, produces fix patch, runs tests.
 */
import { execSync } from "child_process";
import OpenAI from "openai";
import type { AgentRunResult, AgentToolCall, SandboxInfo } from "./types";
import { createPatch, readFile, runPythonTests, writeFile } from "./sandbox";

const API_KEY = process.env.DEEPSEEK_API_KEY || "";
const PRO = "deepseek-v4-pro";
const FLASH = "deepseek-v4-flash";

const TOOLS_DEF = `Available tools (call in JSON):
- file_read(path) → file contents
- file_write(path, content) → write file
- grep_files(pattern) → search codebase
- run_tests(test_list) → run comma-separated test IDs
- bash(command) → run shell command
- submit_patch → call when all tests pass

Format: {"tool": "<name>", "args": {...}}`;

export async function runSWEBenchAgent(
  inst: {
    instance_id: string;
    repo: string;
    problem_statement: string;
    FAIL_TO_PASS: string;
    PASS_TO_PASS: string;
  },
  info: SandboxInfo,
  options: { model?: string; maxTurns?: number } = {},
): Promise<AgentRunResult> {
  const model = options.model || PRO;
  const maxTurns = options.maxTurns || 8;
  const client = new OpenAI({ apiKey: API_KEY, baseURL: "https://api.deepseek.com/v1" });

  const failToPass = JSON.parse(inst.FAIL_TO_PASS) as string[];
  const passToPass = JSON.parse(inst.PASS_TO_PASS) as string[];

  const sysPrompt = `You are a Senior Software Engineer fixing a real GitHub issue in ${inst.repo}.
Work in: ${info.repoPath}

## PROBLEM
${inst.problem_statement}

## REQUIREMENTS
1. Read the relevant source files first to understand the codebase
2. Identify the root cause of the bug
3. Write the minimal fix
4. Run the failing tests to verify: ${failToPass.join(", ")}
5. Also run key passing tests to check for regressions (sample 5-10 from ${passToPass.length} tests)
6. Use submit_patch ONLY when ALL tests pass

## TOOLS
${TOOLS_DEF}

## IMPORTANT
- Make minimal changes — only fix what's broken
- Use file_read first to understand the code
- Use grep_files to find relevant patterns
- Keep existing code style and conventions`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: sysPrompt },
    { role: "user", content: `Fix the issue: ${inst.problem_statement}\n\nThe following tests must pass after your fix: ${failToPass.join(", ")}\n\nStart by reading relevant source files to understand the bug.` },
  ];

  const toolCalls: AgentToolCall[] = [];
  let totalTokens = 0;
  let totalCost = 0;
  let finalPatch = "";
  const start = Date.now();

  for (let turn = 0; turn < maxTurns; turn++) {
    const isPro = model === PRO;
    const body: any = {
      model,
      messages,
      temperature: 0.2,
      max_tokens: 4096,
    };
    if (isPro) {
      body.thinking = { type: "enabled" };
      body.reasoning_effort = turn < 3 ? "high" : "max";
    }

    let content = "";
    try {
      const resp = await client.chat.completions.create(body);
      content = resp.choices[0]?.message?.content || "";
      const u = resp.usage!;
      totalTokens += u.total_tokens;
      totalCost += isPro
        ? (u.prompt_tokens / 1e6) * 0.14 + (u.completion_tokens / 1e6) * 0.42
        : (u.prompt_tokens / 1e6) * 0.04 + (u.completion_tokens / 1e6) * 0.12;
    } catch (e: any) {
      console.error(`  LLM error (turn ${turn}):`, e.message);
      messages.push({ role: "user", content: `Error: ${e.message}. Try again with a simpler approach.` });
      continue;
    }

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
        let result = "";

        switch (tname) {
          case "file_read": {
            result = readFile(info.repoPath, args.path || "");
            break;
          }
          case "file_write": {
            result = writeFile(info.repoPath, args.path || "", args.content || "");
            break;
          }
          case "grep_files": {
            try {
              const r = execSync(`grep -rn "${args.pattern}" ${info.repoPath} --include="*.py" 2>/dev/null || echo "(no matches)"`, { encoding: "utf-8", timeout: 10000 });
              result = r.substring(0, 3000);
            } catch {
              result = "(no matches)";
            }
            break;
          }
          case "run_tests": {
            const testIds = (args.test_list || "").split(",").map((s: string) => s.trim()).filter(Boolean);
            const testRes = runPythonTests(info, testIds);
            result = `PASS:${testRes.passed} FAIL:${testRes.failed} ERROR:${testRes.error}\n${testRes.output.substring(0, 2000)}`;
            break;
          }
          case "bash": {
            try {
              const r = execSync(args.command, { cwd: info.repoPath, encoding: "utf-8", timeout: 30000, maxBuffer: 1024 * 1024 });
              result = r || "(ok)";
            } catch (e: any) {
              result = `EXIT:${e.status} ${(e.stderr || "") + (e.stdout || "")}`.substring(0, 2000);
            }
            break;
          }
          case "submit_patch": {
            finalPatch = createPatch(info.repoPath);
            result = `Patch submitted: ${finalPatch.length} chars`;
            break;
          }
          default:
            result = `Unknown tool: ${tname}`;
        }

        toolCalls.push({ tool: tname, args, result: result.substring(0, 1000) });
        messages.push({ role: "assistant", content: `Called ${tname}` });
        messages.push({ role: "user", content: `Result for ${tname}:\n${result}` });

        if (tname === "submit_patch") break;
      } catch {
        // Not a valid JSON tool call
      }
    }

    if (finalPatch) break;

    if (!acted) {
      messages.push({ role: "assistant", content });
      // Nudge the agent to use tools
      if (content.length > 100 && !content.includes('"tool"')) {
        messages.push({
          role: "user",
          content:
            'You must use tools. Based on your analysis, call file_read to inspect the relevant file, then file_write to apply the fix, then run_tests to verify. Format: ```json\n{"tool": "file_read", "args": {"path": "src/path/to/file.py"}}\n```',
        });
      }
    }

    // If the agent seems confused, inject guidance
    if (turn >= 3 && !toolCalls.some(t => t.tool === "file_write") && !finalPatch) {
      messages.push({
        role: "user",
        content:
          "You haven't written any files yet. Based on your analysis, make the fix now with file_write. The fix should be minimal — only fix what's described in the problem statement.",
      });
    }
  }

  // If no patch submitted, generate from git diff
  if (!finalPatch) {
    finalPatch = createPatch(info.repoPath);
  }

  return {
    patch: finalPatch,
    toolCalls,
    tokens: totalTokens,
    cost: Math.round(totalCost * 1e6) / 1e6,
    durationMs: Date.now() - start,
  };
}
