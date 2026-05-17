export type RuntimeMode = "plan" | "agent" | "yolo";

export interface ModeToolDecision {
  allowed: boolean;
  reason?: string;
}

function normalizeMode(mode?: string): RuntimeMode {
  return mode === "plan" || mode === "yolo" || mode === "agent" ? mode : "agent";
}

function normalizeToolName(toolName: string, params?: Record<string, unknown>): string {
  if (toolName === "file-ops") {
    const operation = String(params?.operation || "").toLowerCase();
    if (["read", "list", "exists", "search"].includes(operation)) return "file_read";
    if (operation === "delete") return "file_delete";
    if (["write", "modify", "mkdir"].includes(operation)) return "file_write";
  }
  if (toolName === "apply-patch") return "apply_patch";
  if (toolName === "terminal-exec") return "bash";
  if (toolName === "web-search") return "web_search";
  return toolName;
}

/**
 * Central runtime-mode gate shared by the orchestrator and agent skill calls.
 * It is intentionally conservative where the product does not yet have an
 * interactive approval loop.
 */
export function checkModeToolAccess(
  toolName: string,
  mode?: string,
  params?: Record<string, unknown>,
): ModeToolDecision {
  const m = normalizeMode(mode);
  const tool = normalizeToolName(toolName, params);

  const readTools = new Set(["file_read", "grep", "glob", "diagnostics", "code-review", "data-analysis"]);
  const writeTools = new Set(["file_write", "edit_file", "apply_patch"]);
  const destructiveTools = new Set(["bash", "run_command", "terminal-exec", "file_delete"]);
  const gitWriteTools = new Set(["git_commit", "git_push", "git-ops"]);
  const networkTools = new Set(["web_search", "web_fetch", "mcp_call_tool", "npm_install", "pip_install"]);

  if (m === "plan") {
    if (readTools.has(tool)) return { allowed: true };
    if (writeTools.has(tool)) return { allowed: false, reason: "Plan mode: write tools are disabled" };
    if (destructiveTools.has(tool)) return { allowed: false, reason: "Plan mode: shell/destructive tools are disabled" };
    if (gitWriteTools.has(tool)) return { allowed: false, reason: "Plan mode: git write operations are disabled" };
    if (networkTools.has(tool)) return { allowed: false, reason: "Plan mode: network access is disabled" };
    return { allowed: true };
  }

  if (m === "agent") {
    if (tool === "file_delete" && params?.confirmed !== true) {
      return { allowed: false, reason: "Agent mode: file delete requires explicit confirmation" };
    }
    if (gitWriteTools.has(tool)) return { allowed: false, reason: "Agent mode: git write operations require explicit approval" };
    if (networkTools.has(tool)) return { allowed: false, reason: "Agent mode: network tools require explicit approval" };
    return { allowed: true };
  }

  if (tool === "git_push") {
    return { allowed: false, reason: "YOLO mode: git push still requires explicit approval" };
  }
  return { allowed: true };
}
