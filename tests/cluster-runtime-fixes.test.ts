import { describe, expect, it } from "vitest";
import { CodeAgent } from "../src/agents/CodeAgent.js";
import { ResearchAgent } from "../src/agents/cluster/ResearchAgent.js";
import { TestAgent } from "../src/agents/cluster/TestAgent.js";
import { ClusterDAGBuilder } from "../src/orchestrator/ClusterDAGBuilder.js";
import { ClusterReporter } from "../src/orchestrator/ClusterReporter.js";
import { LLMClient } from "../src/llm/LLMClient.js";
import { checkModeToolAccess } from "../src/security/ModeToolGate.js";
import { createSkillManager } from "../src/skills/SkillManager.js";
import type { SkillManager } from "../src/skills/SkillManager.js";

function fakeLLM(content: string, usage = {
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
  cacheHitTokens: 4,
  cacheMissTokens: 6,
}) {
  return {
    completeWithMeta: async (_prompt: string, options: any = {}) => ({
      content,
      usage,
      finishReason: "stop",
      model: options.model || "deepseek-v4-pro",
    }),
  };
}

async function initializedSkillManager(): Promise<SkillManager> {
  const manager = createSkillManager();
  await manager.initialize();
  return manager;
}

describe("cluster runtime fixes", () => {
  it("LLMClient sends per-request model override and returns the effective model when provider omits it", async () => {
    const client = new LLMClient({
      apiKey: "test-key",
      baseURL: "https://example.invalid/v1",
      model: "deepseek-v4-pro",
    });
    let body: any;
    (client as any).client = {
      chat: {
        completions: {
          create: async (requestBody: any) => {
            body = requestBody;
            return {
              choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
            };
          },
        },
      },
    };

    const result = await client.completeWithMeta("hello", {
      model: "deepseek-v4-flash",
      thinking: "disabled",
      reasoningEffort: "max",
    });

    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(result.model).toBe("deepseek-v4-flash");
  });

  it("mode gate is enforced at skill/tool granularity", () => {
    expect(checkModeToolAccess("file-ops", "plan", { operation: "read" }).allowed).toBe(true);
    expect(checkModeToolAccess("file-ops", "plan", { operation: "write" }).allowed).toBe(false);
    expect(checkModeToolAccess("web-search", "agent").allowed).toBe(false);
    expect(checkModeToolAccess("git_push", "yolo").allowed).toBe(false);
  });

  it("ResearchAgent uses file tools and returns repo context artifact", async () => {
    const agent = new ResearchAgent(fakeLLM("architecture notes") as any, await initializedSkillManager());
    const result = await agent.execute({
      id: "research-1",
      name: "Scan src code",
      target: "src/agents/cluster",
      outputArtifact: "repo_context",
    });

    expect(result.outputArtifact).toBe("repo_context");
    expect(result.toolEvidence.listedDirectories.length).toBeGreaterThan(0);
    expect(result.toolEvidence.sampledFiles.length).toBeGreaterThan(0);
    expect(result.artifact.keyFiles.length).toBeGreaterThan(0);
  });

  it("CodeAgent returns a structured patch artifact for cluster patch steps", async () => {
    const previousLiveFlag = process.env.USE_LIVE_LLM_FOR_TESTS;
    process.env.USE_LIVE_LLM_FOR_TESTS = "true";
    const llm = fakeLLM(JSON.stringify({
      files: [{
        path: "src/example.ts",
        operation: "modify",
        diff: "--- a/src/example.ts\n+++ b/src/example.ts\n@@\n-old\n+new",
        newContent: "new",
      }],
      summary: "update example",
      breakingChanges: false,
    }));
    const agent = new CodeAgent(llm as any, await initializedSkillManager());
    let result: any;
    try {
      result = await agent.execute({
        id: "code-1",
        name: "Generate code patch",
        description: "patch example",
        outputArtifact: "patch",
      });
    } finally {
      if (previousLiveFlag === undefined) {
        delete process.env.USE_LIVE_LLM_FOR_TESTS;
      } else {
        process.env.USE_LIVE_LLM_FOR_TESTS = previousLiveFlag;
      }
    }

    expect(result.outputArtifact).toBe("patch");
    expect(result.artifact.files[0].path).toBe("src/example.ts");
    expect(result.artifact.fileCount).toBe(1);
    expect(result.artifact.linesAdded).toBe(1);
    expect(result.artifact.linesRemoved).toBe(1);
  });

  it("TestAgent skips execution without an explicit testCommand", async () => {
    const agent = new TestAgent(fakeLLM("unused") as any, await initializedSkillManager());
    const result = await agent.execute({
      id: "test-1",
      name: "Run tests and analyze results",
      description: "This description must not be executed",
      outputArtifact: "test_report",
    });

    expect(result.skipped).toBe(true);
    expect(result.result.command).toBe("");
  });

  it("ClusterDAGBuilder preserves research target and explicit test command metadata", () => {
    process.env.NAC_TEST_COMMAND = "pnpm vitest run tests/foo.test.ts";
    const builder = new ClusterDAGBuilder();
    const dag = builder.build({
      runId: "run_1",
      coordinator: {
        agentType: "CoordinatorAgent",
        role: "coordinator",
        count: 1,
        model: "deepseek-v4-pro",
        thinking: "enabled",
        skills: [],
      },
      members: [
        {
          agentType: "ResearchAgent",
          role: "researcher",
          count: 2,
          model: "deepseek-v4-flash",
          thinking: "disabled",
          skills: [],
        },
        {
          agentType: "CodeAgent",
          role: "code_agent",
          count: 1,
          model: "deepseek-v4-pro",
          thinking: "enabled",
          skills: [],
        },
        {
          agentType: "TestAgent",
          role: "tester",
          count: 1,
          model: "deepseek-v4-flash",
          thinking: "enabled",
          skills: [],
        },
      ],
      collaborationMode: "pipeline",
      modelPolicy: {},
      expectedArtifacts: [],
      estimatedProTokens: 0,
      estimatedFlashTokens: 0,
      estimatedCost: 0,
    });

    const executable = builder.toExecutableDAG(dag);
    const researchTask = executable.getAllTasks().find(task => task.id === "step_research_0");
    const testTask = executable.getAllTasks().find(task => task.id === "step_test");
    expect(researchTask?.target).toBe("src/");
    expect(testTask?.testCommand).toBe("pnpm vitest run tests/foo.test.ts");
    delete process.env.NAC_TEST_COMMAND;
  });

  it("ClusterReporter accumulates actual token usage instead of replacing it", () => {
    const reporter = new ClusterReporter();
    reporter.start();
    reporter.recordTokenUsage("CodeAgent", {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cacheHitTokens: 4,
      cacheMissTokens: 6,
    });
    reporter.recordTokenUsage("CodeAgent", {
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
      cacheHitTokens: 6,
      cacheMissTokens: 14,
    });

    const report = reporter.generateReport({
      runId: "run_usage",
      teamPlan: {
        runId: "run_usage",
        coordinator: {
          agentType: "CoordinatorAgent",
          role: "coordinator",
          count: 1,
          model: "deepseek-v4-pro",
          thinking: "enabled",
          skills: [],
        },
        members: [{
          agentType: "CodeAgent",
          role: "code_agent",
          count: 1,
          model: "deepseek-v4-pro",
          thinking: "enabled",
          skills: [],
        }],
        collaborationMode: "pipeline",
        modelPolicy: {},
        expectedArtifacts: [],
        estimatedProTokens: 0,
        estimatedFlashTokens: 0,
        estimatedCost: 0,
      },
      clusterDag: {
        runId: "run_usage",
        mode: "pipeline",
        steps: [],
        maxParallelism: 1,
        criticalPath: [],
      },
      artifacts: [],
      status: "completed",
    });

    expect(report.totalProTokens).toBe(45);
    expect(report.workers[0].tokens).toBe(45);
    expect(report.cacheHitRate).toBeCloseTo(10 / 30, 3);
  });
});
