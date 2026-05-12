/**
 * DelegateTool — spawn a sub-agent with a specific role to handle a sub-task.
 * This is how Claude Code (AgentTool) and Hermes Agent (delegate_tool)
 * implement multi-agent collaboration: the main agent delegates to specialists.
 */
import { Tool } from "../base.js";
import type { ToolExecutionContext, ToolResult } from "../../agent/types.js";
import { getDefaultAdapter } from "../../llm/index.js";

export class DelegateTool extends Tool {
  readonly name = "delegate";
  readonly description =
    "Delegate a sub-task to a specialized sub-agent. The sub-agent runs with a " +
    "specific role description and has access to all tools. Returns the sub-agent's " +
    "final answer. Use this when a task requires a specific perspective or when " +
    "you need to run independent analyses in parallel.";
  readonly parameters = [
    {
      name: "role",
      type: "string",
      description: "The specialized role for the sub-agent (e.g. 'code-reviewer', 'data-analyst', 'security-auditor')",
    },
    {
      name: "task",
      type: "string",
      description: "The specific sub-task to delegate",
    },
  ];
  readonly safeForParallel = true; // sub-agents can run in parallel

  async execute(
    args: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<ToolResult> {
    const start = Date.now();
    const role = (args.role as string) || "specialist";
    const task = (args.task as string) || "";

    if (!task) {
      return this.error("", "Task is required for delegation", Date.now() - start);
    }

    try {
      const llm = getDefaultAdapter();
      const systemPrompt = [
        `You are a specialized sub-agent with the role: ${role}.`,
        `Your task is to analyze the following and provide a concise, structured answer.`,
        `You have NO tools — you are a pure reasoning agent.`,
        `Reply with only the information requested. Be specific and evidence-based.`,
        `Do NOT say "I am an AI" or "I don't have access". Just do the analysis.`,
      ].join("\n");

      const response = await llm.complete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: task },
        ],
        { temperature: 0.5, maxTokens: 2048 }
      );

      const answer = response.content.trim();
      return this.success("", answer, Date.now() - start, {
        role,
        task: task.substring(0, 100),
        tokens: response.usage.totalTokens,
      });
    } catch (e: any) {
      return this.error("", `Sub-agent error: ${e.message}`, Date.now() - start);
    }
  }
}
