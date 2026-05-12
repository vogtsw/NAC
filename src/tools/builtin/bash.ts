/**
 * BashTool — shell command execution with sandbox + cross-platform shell detection.
 *
 * Shell resolution priority (Windows):
 *   1. Git Bash (C:\Program Files\Git\bin\bash.exe)
 *   2. WSL (wsl -e bash)
 *   3. cmd.exe (handles &&, || better than PowerShell)
 *   4. PowerShell (fallback)
 *
 * On macOS/Linux: /bin/bash
 */

import { Tool } from "../base.js";
import type { ToolExecutionContext, ToolResult } from "../../agent/types.js";
import { execSync, execFileSync } from "child_process";
import { existsSync } from "fs";

const DANGEROUS_COMMANDS = [
  "rm -rf /", "dd if=", "mkfs.", ":(){ :|:& };:", "> /dev/sda",
  "shutdown", "reboot", "halt", "poweroff",
];

// ── Shell Detection ──────────────────────────────────────

interface ResolvedShell {
  shell: string | true;     // string = shell path, true = default OS shell
  prefix: string[];         // args before the user's command
  description: string;      // for logging
}

function resolveShell(): ResolvedShell {
  // Non-Windows: use bash directly
  if (process.platform !== "win32") {
    return { shell: "/bin/bash", prefix: ["-c"], description: "/bin/bash" };
  }

  // Windows: try which bash first (most reliable), then known paths
  try {
    const whichBash = execFileSync("where", ["bash"], { timeout: 3000, encoding: "utf-8" }).trim().split("\n")[0];
    if (whichBash && existsSync(whichBash)) {
      return { shell: whichBash, prefix: ["-c"], description: `Git Bash (${whichBash})` };
    }
  } catch { /* where not available */ }

  const gitBashPaths = [
    "D:\\Program Files\\Git\\bin\\bash.exe",
    "D:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
    `${process.env.USERPROFILE}\\scoop\\apps\\git\\current\\bin\\bash.exe`,
  ];
  for (const bashPath of gitBashPaths) {
    if (existsSync(bashPath)) {
      return { shell: bashPath, prefix: ["-c"], description: `Git Bash (${bashPath})` };
    }
  }

  // Try MSYS2 bash
  const msys2Paths = ["C:\\msys64\\usr\\bin\\bash.exe", "C:\\tools\\msys64\\usr\\bin\\bash.exe"];
  for (const bashPath of msys2Paths) {
    if (existsSync(bashPath)) {
      return { shell: bashPath, prefix: ["-c"], description: `MSYS2 Bash (${bashPath})` };
    }
  }

  // Try WSL
  try {
    execFileSync("wsl", ["--version"], { timeout: 5000, stdio: "ignore" });
    return { shell: "wsl", prefix: ["-e", "bash", "-c"], description: "WSL bash" };
  } catch {
    // WSL not available
  }

  // cmd.exe: better than PowerShell for basic shell syntax (&&, ||, redirects)
  // but no [ -d ], head, etc.
  return { shell: "cmd.exe", prefix: ["/c"], description: "cmd.exe (PowerShell fallback)" };
}

// ── Command Preprocessing ────────────────────────────────

/**
 * Attempt to translate common bash-isms to the resolved shell.
 * This is a best-effort layer — the agent should prefer Node.js one-liners
 * for cross-platform compatibility.
 */
function preprocessCommand(command: string, shell: ResolvedShell): string {
  // If using bash or WSL, no translation needed
  if (shell.description.includes("bash") || shell.description.includes("WSL")) {
    return command;
  }

  // For cmd.exe / PowerShell: translate common bash-isms
  let cmd = command;

  // Replace bash if-statement with PowerShell/CMD compatible version
  // "if [ -d X ]; then A; else B; fi" → try-catch pattern via node
  if (cmd.includes("[ -d ") || cmd.includes("[ -f ") || cmd.includes("if [")) {
    // Extract path and commands, rewrite as node one-liner
    const dirMatch = cmd.match(/\[ -[df]\s+"?([^"\]]+)"?\s*\];\s*then\s+(.+?);\s*else\s+(.+?);?\s*fi/);
    if (dirMatch) {
      const [, filePath, thenCmd, elseCmd] = dirMatch;
      return `node -e "const fs=require('fs');const p='${filePath.replace(/\\/g, '\\\\')}';try{if(fs.existsSync(p)){require('child_process').execSync('${thenCmd.replace(/'/g, "\\'")}',{stdio:'inherit'})}else{require('child_process').execSync('${elseCmd.replace(/'/g, "\\'")}',{stdio:'inherit'})}}catch(e){console.error(e.message);process.exit(1)}"`;
    }
  }

  // Replace "|| echo" pattern → use cmd.exe error handling
  cmd = cmd.replace(/\|\|\s*echo\s+"([^"]+)"/g, '2>&1 || echo $1');

  return cmd;
}

// ── BashTool ─────────────────────────────────────────────

export class BashTool extends Tool {
  readonly name = "bash";
  readonly description = (() => {
    const sh = resolveShell();
    if (sh.description.includes("bash") || sh.description.includes("WSL")) {
      return "Execute a shell command (bash). Use for running tests, building, " +
        "installing packages. Supports standard bash syntax: if [ -d X ], ||, &&, pipes.";
    }
    // Windows without bash/WSL: guide toward cross-platform commands
    return `Execute a shell command. SHELL: ${sh.description}. ` +
      "CRITICAL: This shell does NOT support bash syntax (if [ -d X ], ||, head). " +
      "Use ONLY cross-platform syntax:" +
      "• File check: node -e \"fs.existsSync('path')\"" +
      "• Error fallback: use try/catch in node -e" +
      "• Filter lines: use node -e with .split('\\n').filter()" +
      "• Command separator: use & (cmd) or ; (PowerShell)" +
      "NEVER use: if [ -d X ], ||, 2>/dev/null, head, grep -v outside node -e.";
  })();
  readonly parameters = [
    {
      name: "command",
      type: "string",
      description: "The shell command to execute. Prefer node -e for cross-platform.",
    },
    {
      name: "workingDir",
      type: "string",
      description: "Working directory (optional, defaults to project root)",
      required: false,
    },
    {
      name: "timeout",
      type: "number",
      description: "Timeout in milliseconds (default: 120000 = 2 min)",
      required: false,
    },
  ];
  readonly requiresApproval = true;

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const start = Date.now();
    const command = args.command as string;
    const workingDir = (args.workingDir as string) || context.workingDir;
    const timeout = (args.timeout as number) || 120_000;
    const shell = resolveShell();

    if (!command || typeof command !== "string") {
      return this.error("", "Command is required", Date.now() - start);
    }

    // Safety check: block dangerous commands
    const lowerCmd = command.toLowerCase();
    for (const dangerous of DANGEROUS_COMMANDS) {
      if (lowerCmd.includes(dangerous.toLowerCase())) {
        return this.error(
          "",
          `Blocked dangerous command pattern: "${dangerous}"`,
          Date.now() - start
        );
      }
    }

    // Preprocess for current shell
    const processedCmd = preprocessCommand(command, shell);

    try {
      // Fast path: "node" / "npm" / "pnpm" / "npx" / "tsx" — execute directly
      // This avoids all shell quoting issues on Windows
      const nodeCmds = ["node", "npm", "pnpm", "npx", "tsx", "tsc", "git", "python", "python3"];
      const firstWord = processedCmd.trim().split(/\s+/)[0].replace(/^"|"$/g, "");
      if (nodeCmds.includes(firstWord)) {
        const args = processedCmd.trim().split(/\s+/).slice(1).map(a => a.replace(/^"|"$/g, ""));
        const result = execFileSync(firstWord, args, {
          cwd: workingDir,
          timeout,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, HOME: process.env.HOME || process.env.USERPROFILE || "" },
        });
        const output = (result || "(command executed successfully with no output)")
          .replace(/\r\n/g, "\n").trim();
        return this.success("", output, Date.now() - start, {
          command: processedCmd,
          shell: `direct:${firstWord}`,
          workingDir,
        });
      }

      // General shell path
      const shellArgs = [...shell.prefix, processedCmd];
      const result = execFileSync(shell.shell as string, shellArgs, {
        cwd: workingDir,
        timeout,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          HOME: process.env.HOME || process.env.USERPROFILE || "",
        },
        shell: typeof shell.shell === "boolean" ? shell.shell : undefined,
      });

      const output = (result || "(command executed successfully with no output)")
        .replace(/\r\n/g, "\n")
        .trim();
      return this.success("", output, Date.now() - start, {
        command: processedCmd,
        shell: shell.description,
        workingDir,
      });
    } catch (e: any) {
      const stderr = e.stderr || e.message || "Unknown error";
      const cleanError = stderr.toString().replace(/\r\n/g, "\n").trim();
      return this.error("", cleanError, Date.now() - start);
    }
  }
}
