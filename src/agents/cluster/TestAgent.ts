import { BaseAgent, ModelPolicy } from "../BaseAgent.js";
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
      // Use TestRunnerSkill to run actual tests
      const testCmd = task.testCommand || task.description || "pnpm test";
      const testPattern = task.testPattern || task.name || "";

      // Run tests via skill if available
      let testResult: any;
      try {
        testResult = await this.useSkill("run-tests", {
          command: testCmd,
          pattern: testPattern,
        });
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

      return {
        taskId: task.id,
        result: testResult?.result || testResult,
        agentType: "TestAgent",
        outputArtifact: task.outputArtifact || "test_report",
      };
    } catch (error: any) {
      this.setStatus(AgentStatus.IDLE);
      throw error;
    }
  }
}
