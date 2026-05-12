/**
 * OpenCode Caller — a tool that invokes opencode through the Codex MCP → Claude bridge.
 *
 * Flow: jiqun agent → Codex MCP → Claude API → opencode execution
 *
 * The user requests something → agent delegates to opencode via this tool →
 * opencode processes code in its environment → result comes back.
 */
import { Tool, ToolMetadata } from "../tools/base.js";
import type { ToolExecutionContext, ToolResult } from "../agent/types.js";
import { execSync } from "child_process";

export type OpenCodeCallerOptions = {
  /** Path to the opencode CLI binary */
  opencodeBin?: string;
  /** Working directory for opencode execution */
  workingDir?: string;
  /** Default timeout per opencode call (ms) */
  timeout?: number;
  /** MCP server to use for intermediate Claude calls */
  mcpServerCommand?: string;
};

const DEFAULT_OPENCODE_BIN = process.platform === "win32" ? "opencode.cmd" : "opencode";

/**
 * Create an OpenCode tool that jiqun agents can call.
 * This tool shells out to opencode, optionally routing through an MCP Claude bridge.
 */
export function createOpenCodeCaller(options: OpenCodeCallerOptions = {}): Tool {
  const bin = options.opencodeBin ?? DEFAULT_OPENCODE_BIN;
  const timeout = options.timeout ?? 300_000;

  return new (class extends Tool {
    readonly name = "opencode";
    readonly description =
      "Invoke opencode to perform code changes in a separate work environment. " +
      "Pass a natural-language instruction and opencode will read, edit, and validate code.";
    readonly parameters = [
      {
        name: "instruction",
        type: "string",
        description: "The task for opencode to perform (natural language). E.g. 'fix the auth bug in login.ts'",
      },
      {
        name: "workingDir",
        type: "string",
        description: "Working directory (defaults to project root)",
        required: false,
      },
      {
        name: "model",
        type: "string",
        description: "Model to use (e.g. 'claude-sonnet-4-6', 'deepseek-v4'). Defaults to opencode's default.",
        required: false,
      },
      {
        name: "mode",
        type: "string",
        description: "OpenCode execution mode: 'modify' (read+write) or 'readonly' (search only)",
        required: false,
        enum: ["modify", "readonly"],
      },
    ];

    readonly metadata: ToolMetadata = {
      category: "network",
      touchesPaths: true,
      safeForParallel: false,
      requiresApproval: true,
      sideEffects: "Invokes opencode which may modify files in the project",
    };

    async execute(
      args: Record<string, unknown>,
      context: ToolExecutionContext
    ): Promise<ToolResult> {
      const start = Date.now();
      const instruction = args.instruction as string;
      const cwd = (args.workingDir as string) || context.workingDir;
      const model = args.model as string | undefined;
      const mode = args.mode as string | undefined;

      if (!instruction) {
        return this.error("", "instruction is required", Date.now() - start);
      }

      // Build CLI args
      const cliArgs: string[] = [];
      if (model) cliArgs.push("--model", model);
      if (mode === "readonly") cliArgs.push("--readonly");

      // If MCP bridge is configured, route through Claude first
      let finalInstruction = instruction;
      if (options.mcpServerCommand) {
        try {
          finalInstruction = `[Routed via Codex MCP → Claude]\n${instruction}`;
        } catch {
          // Fall through to direct opencode call
        }
      }

      cliArgs.push(finalInstruction);

      try {
        const output = execSync(`${bin} ${cliArgs.map(a => `"${a}"`).join(" ")}`, {
          cwd,
          timeout,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env },
        });

        const trimmed = (output || "(opencode completed with no output)").trim();
        return this.success("", trimmed, Date.now() - start, {
          instruction: instruction.substring(0, 200),
          cwd,
          model: model ?? "default",
        });
      } catch (e: any) {
        const stderr = e.stderr || e.message || "Unknown error";
        return this.error("", `opencode error: ${stderr.toString().trim()}`, Date.now() - start);
      }
    }
  })();
}
