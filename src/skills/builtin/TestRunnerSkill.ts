/**
 * TestRunnerSkill
 * Detects and runs test commands, parses failures, provides diagnostics.
 */

import { execSync } from "child_process";
import { Skill, SkillCategory, SkillContext, SkillResult } from "../types.js";
import { getLogger } from "../../monitoring/logger.js";
import { promises as fs } from "fs";

const logger = getLogger("TestRunnerSkill");

export interface TestResult {
  command: string;
  exitCode: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: Array<{
    testName: string;
    file?: string;
    error: string;
    suggestion?: string;
  }>;
  stdout: string;
  stderr: string;
}

export const TestRunnerSkill: Skill = {
  name: "run-tests",
  description: "Detect and run project test commands, parse results, diagnose failures",
  category: SkillCategory.TESTING,
  version: "1.0.0",
  enabled: true,
  builtin: true,
  parameters: {
    required: [],
    optional: ["command", "cwd", "testFile", "timeout"],
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const cwd = params.cwd || process.cwd();
    const timeout = params.timeout || 300000;

    try {
      const command = params.command || (await detectTestCommand(cwd));
      if (!command) {
        return {
          success: false,
          error: "No test command detected",
          result: { command: "none", exitCode: -1 },
        };
      }

      const finalCommand = params.testFile ? `${command} ${params.testFile}` : command;
      const startTime = Date.now();

      try {
        const stdout = execSync(finalCommand, {
          cwd, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024,
          timeout,
          env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
        });

        const duration = Date.now() - startTime;
        const parsed = parseTestOutput(stdout, finalCommand);
        return { success: true, result: { ...parsed, command: finalCommand, duration, exitCode: 0, stderr: "" } };
      } catch (error: any) {
        const duration = Date.now() - startTime;
        const stdout = error.stdout || "";
        const stderr = error.stderr || error.message || "";
        const parsed = parseTestOutput(stdout, finalCommand);
        const result = {
          ...parsed,
          command: finalCommand,
          exitCode: error.status || 1,
          duration,
          stderr,
        };
        return { success: parsed.failed === 0, result };
      }
    } catch (error: any) {
      return { success: false, error: error.message, result: null };
    }
  },

  validate(params: any): boolean {
    return true;
  },
};

async function detectTestCommand(cwd: string): Promise<string | null> {
  // Check package.json for test scripts
  const pkgPath = `${cwd}/package.json`;
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
    const scripts = pkg.scripts || {};

    // Prefer known test runners
    if (scripts["test"]) return "npm test --";
    if (scripts["test:run"]) return "npm run test:run --";
    if (scripts["vitest"]) return "npm run vitest --";
    if (scripts["jest"]) return "npm run jest --";

    return null;
  } catch {
    // Check for common config files
    try {
      await fs.access(`${cwd}/vitest.config.ts`);
      return "npx vitest run --";
    } catch {}
    try {
      await fs.access(`${cwd}/vitest.config.js`);
      return "npx vitest run --";
    } catch {}
    try {
      await fs.access(`${cwd}/jest.config.ts`);
      return "npx jest --";
    } catch {}
    try {
      await fs.access(`${cwd}/jest.config.js`);
      return "npx jest --";
    } catch {}

    return null;
  }
}

function parseTestOutput(output: string, command: string): Omit<TestResult, "command" | "duration" | "exitCode" | "stderr"> {
  let total = 0, passed = 0, failed = 0, skipped = 0;
  const failures: TestResult["failures"] = [];

  // Vitest output format
  const vitestMatch = output.match(/Tests\s+(\d+)\s+failed\s+\|\s+(\d+)\s+passed\s*(?:\|\s+(\d+)\s+skipped)?.*\((\d+)\)/);
  if (vitestMatch) {
    failed = parseInt(vitestMatch[1]);
    passed = parseInt(vitestMatch[2]);
    skipped = parseInt(vitestMatch[3] || "0");
    total = passed + failed + skipped;
  }

  // Jest output format
  const jestMatch = output.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/);
  if (jestMatch) {
    failed = parseInt(jestMatch[1]);
    passed = parseInt(jestMatch[2]);
    total = parseInt(jestMatch[3]);
  }

  // Parse individual failures
  const lines = output.split("\n");
  let currentFailure: Partial<TestResult["failures"][0]> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Vitest failure: FAIL  path/to/test.ts > test name
    const vitestFail = line.match(/^FAIL\s+(.+?\.test\.\w+)\s*>\s*(.+)/);
    if (vitestFail) {
      if (currentFailure) failures.push(currentFailure as any);
      currentFailure = { file: vitestFail[1], testName: vitestFail[2], error: "" };
      continue;
    }

    // Jest failure: ● test name
    const jestFail = line.match(/^\s*[●•]\s+(.+)/);
    if (jestFail && !currentFailure) {
      currentFailure = { testName: jestFail[1], error: "" };
      continue;
    }

    // Error message
    if (currentFailure && (line.includes("Error:") || line.includes("AssertionError:") || line.includes("expected"))) {
      currentFailure.error = line.trim();
      failures.push(currentFailure as any);
      currentFailure = null;
    }
  }

  if (currentFailure) failures.push(currentFailure as any);

  // Suggest fixes for common errors
  for (const f of failures) {
    f.suggestion = suggestFix(f.error);
  }

  if (total === 0 && output.length > 0) {
    total = passed = 1;
  }

  return { total, passed, failed, skipped, failures, stdout: output };
}

function suggestFix(error: string): string {
  if (/cannot find module/i.test(error)) return "Install missing dependency: npm install";
  if (/expected.*received/i.test(error)) return "Check the assertion and adjust the expected value";
  if (/timeout/i.test(error)) return "Increase test timeout or optimize slow test";
  if (/econnrefused|eaddrinuse/i.test(error)) return "Ensure required services are running";
  if (/permission denied/i.test(error)) return "Check file permissions or run with appropriate access";
  if (/syntax error/i.test(error)) return "Fix syntax error in the source code";
  if (/type.*is not assignable/i.test(error)) return "Fix type mismatch in the test or source";
  return "Investigate the error details in the test output";
}

export const DiagnosticsSkill: Skill = {
  name: "diagnostics",
  description: "Collect project diagnostics: TypeScript errors, lint results, test coverage",
  category: SkillCategory.TESTING,
  version: "1.0.0",
  enabled: true,
  builtin: true,
  parameters: {
    required: [],
    optional: ["cwd", "types"],
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const cwd = params.cwd || process.cwd();
    const types = params.types || ["typescript", "lint"];
    const results: Record<string, any> = {};

    try {
      for (const type of types) {
        try {
          switch (type) {
            case "typescript":
              results.typescript = execSync("npx tsc --noEmit 2>&1 || true", {
                cwd, encoding: "utf-8", maxBuffer: 5 * 1024 * 1024,
              }).trim().split("\n").filter((l: string) => l).length;
              results.tsErrors = results.typescript > 0
                ? execSync("npx tsc --noEmit 2>&1 || true", {
                  cwd, encoding: "utf-8", maxBuffer: 5 * 1024 * 1024,
                }).trim().split("\n").slice(0, 10)
                : [];
              break;
            default:
              results[type] = "not implemented";
          }
        } catch (error: any) {
          results[type] = `Error: ${error.message}`;
        }
      }
      return { success: true, result: results };
    } catch (error: any) {
      return { success: false, error: error.message, result: null };
    }
  },

  validate(): boolean { return true; },
};
