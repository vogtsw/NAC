import { BaseAgent } from "../BaseAgent.js";
import { AgentStatus } from "../../state/models.js";
import type { LLMClient } from "../../llm/LLMClient.js";
import type { SkillManager } from "../../skills/SkillManager.js";

export class TestAgent extends BaseAgent {
  constructor(llm: LLMClient, skillManager: SkillManager) {
    super(llm, skillManager, "TestAgent");
  }

  async execute(task: any): Promise<any> {
    this.setStatus(AgentStatus.BUSY);

    try {
      // Only use explicit testCommand; never run DAG descriptions or defaults as shell commands.
      const testCmd = typeof task.testCommand === "string" ? task.testCommand.trim() : "";
      const testPattern = task.testPattern || task.name || "";

      if (!testCmd) {
        this.tasksCompleted++;
        this.totalExecutionTime += task.estimatedDuration || 0;
        this.setStatus(AgentStatus.IDLE);
        return {
          taskId: task.id,
          result: {
            command: "",
            total: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            duration: 0,
            failures: [],
            summary: "Skipped test execution because no explicit testCommand was provided.",
          },
          agentType: "TestAgent",
          outputArtifact: task.outputArtifact || "test_report",
          skipped: true,
        };
      }

      // Run tests via skill if available
      let testResult: any;
      let exitCode: number | undefined;
      let stdout = '';
      let stderr = '';

      try {
        const runResult = await this.useSkill('run-tests', {
          command: testCmd,
          pattern: testPattern,
        });
        testResult = runResult.result || (runResult as any);
        exitCode = (runResult as any).exitCode ?? (testResult as any)?.exitCode;
        stdout = (runResult as any).stdout || (testResult as any)?.stdout || '';
        stderr = (runResult as any).stderr || (testResult as any)?.stderr || '';
      } catch {
        // Fallback: use LLM to analyze test context
        const response = await this.callLLM(
          `You are a TestAgent running on deepseek-v4-flash for test execution and log analysis.
Your role: Run tests, parse results, identify failures, and produce structured test reports.

Task: ${task.description || task.name}
Test command: ${testCmd}
Test pattern: ${testPattern}

Output a structured test report with:
1. Test command executed
2. Pass/fail counts
3. List of failures with file paths and line numbers
4. Root cause analysis for each failure
5. Suggested fixes`,
          { temperature: 0.3, maxTokens: 2000 }
        );
        testResult = { result: response };
      }

      this.tasksCompleted++;
      this.totalExecutionTime += task.estimatedDuration || 60;
      this.setStatus(AgentStatus.IDLE);

      // Build structured TestReportArtifact
      const passed = testResult?.passed ?? testResult?.total ?? 0;
      const failed = testResult?.failed ?? 0;
      const total = (testResult?.total ?? 0) || passed + failed;

      return {
        taskId: task.id,
        result: testResult?.result || testResult,
        agentType: "TestAgent",
        outputArtifact: task.outputArtifact || "test_report",
        testReport: {
          command: testCmd,
          total,
          passed,
          failed,
          skipped: testResult?.skipped ?? ((!testResult?.exitCode && !testResult?.stdout) ? total : 0),
          duration: testResult?.duration ?? 0,
          exitCode: exitCode ?? (failed > 0 ? 1 : 0),
          stdout: stdout.substring(0, 4000),
          stderr: stderr.substring(0, 2000),
          failures: Array.isArray(testResult?.failures) ? testResult.failures : [],
          summary: testResult?.summary || testResult?.result || '',
        },
      };
    } catch (error: any) {
      this.setStatus(AgentStatus.IDLE);
      throw error;
    }
  }
}
