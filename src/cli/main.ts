/**
 * CLI Entry Point — interactive agent harness command line.
 *
 * Usage:
 *   tsx src/cli/main.ts              # Interactive mode
 *   tsx src/cli/main.ts chat         # Chat mode alias
 *   tsx src/cli/main.ts run "query"  # Single query mode
 *   tsx src/cli/main.ts eval         # Show evaluation report
 *   tsx src/cli/main.ts stats        # Show system statistics
 */

import { AgentLoop } from "../agent/loop.js";
import { getSessionDB } from "../memory/session-db.js";
import { getTrajectoryRecorder, getEvalCalculator } from "../eval/metrics.js";
import { createInterface } from "readline";
import type { AgentResult } from "../agent/types.js";

// Load .env
import "dotenv/config";

const BANNER = `
╔══════════════════════════════════════════════╗
║          JIQUN — Agent Harness v2.0          ║
║    Claude Code / Hermes Agent inspired       ║
║    Tool Use · Memory · Eval · Trajectory     ║
╚══════════════════════════════════════════════╝
`;

const HELP = `
Commands:
  /help          Show this help
  /clear         Clear conversation history
  /history       Show conversation history
  /stats         Show session statistics
  /eval          Show evaluation report
  /export        Export trajectories for SFT
  /exit, /quit   Exit the program

You can also type any task and press Enter for the agent to process it.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  // ── Non-interactive commands ─────────────────────────
  if (command === "eval") {
    await runEval();
    return;
  }

  if (command === "stats") {
    await runStats();
    return;
  }

  if (command === "run" && args[1]) {
    await runSingleQuery(args[1]);
    return;
  }

  if (command === "cluster") {
    await runCluster(args.slice(1));
    return;
  }

  // ── Interactive mode ─────────────────────────────────
  await runInteractive();
}

// ── Eval Command ───────────────────────────────────────

async function runEval(): Promise<void> {
  const calculator = getEvalCalculator();
  const report = calculator.generateReport();
  console.log(report);

  // Also save to file
  const { writeFileSync } = await import("fs");
  writeFileSync("eval-report.md", report, "utf-8");
  console.log("\nReport saved to eval-report.md");
}

// ── Stats Command ──────────────────────────────────────

async function runStats(): Promise<void> {
  const db = getSessionDB();
  const stats = db.getStats();
  const calculator = getEvalCalculator();
  const metrics = calculator.calculate();

  console.log("\n=== System Statistics ===\n");
  console.log(`Sessions: ${stats.sessionCount}`);
  console.log(`Messages: ${stats.messageCount}`);
  console.log(`Memories:  ${stats.memoryCount}`);
  console.log(`DB Size:   ${stats.dbSize}`);
  console.log(`\n=== Agent Metrics ===`);
  console.log(`Task Completion:  ${(metrics.taskCompletionRate * 100).toFixed(1)}%`);
  console.log(`Tool Success:     ${(metrics.toolCallSuccessRate * 100).toFixed(1)}%`);
  console.log(`Avg Iterations:   ${metrics.avgIterationsPerTask}`);
  console.log(`Trajectories:     ${metrics.trajectoryCount}`);
}

// ── Single Query Mode ──────────────────────────────────

async function runSingleQuery(query: string): Promise<void> {
  console.log(BANNER);
  console.log(`\nProcessing: "${query}"\n`);

  const agent = new AgentLoop();
  let lastText = "";

  process.stdout.write("Agent: ");

  const result = await agent.runWithStreaming(query, {
    onText: (text) => {
      process.stdout.write(text.slice(lastText.length));
      lastText = text;
    },
    onToolStart: (name) => {
      console.log(`\n  [Tool: ${name}]`);
    },
    onToolEnd: (result) => {
      const icon = result.isError ? "✗" : "✓";
      console.log(`  ${icon} ${result.name}: ${result.result.substring(0, 100)}`);
    },
  });

  console.log(`\n`);
  console.log(`Stop reason: ${result.stopReason}`);
  console.log(`Iterations: ${result.turns.length}`);
  console.log(`Duration: ${result.totalDuration}ms`);
  console.log(`Tool calls: ${result.toolCallCount}`);
  console.log(`Tool success rate: ${(result.toolSuccessRate * 100).toFixed(1)}%`);

  // Record trajectory
  const recorder = getTrajectoryRecorder();
  const calculator = getEvalCalculator();
  const trajectory = recorder.record(
    `cli_${Date.now()}`,
    query,
    result
  );
  console.log(`Trajectory saved: ${trajectory.id}`);
}

// ── Cluster Command ────────────────────────────────────

async function runCluster(args: string[]): Promise<void> {
  const taskInput = args[0];
  const flags: Record<string, any> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].replace(/^--/, "");
      flags[key] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
    }
  }

  if (!taskInput) {
    console.error("Error: Task description required");
    console.log('Usage: pnpm cli cluster "<task>" [--mode plan|agent|yolo] [--dry-run] [--json]');
    process.exit(1);
  }

  const mode = flags.mode || "agent";
  if (!["plan", "agent", "yolo"].includes(mode)) {
    console.error(`Error: Invalid mode "${mode}". Use plan, agent, or yolo.`);
    process.exit(1);
  }

  process.env.NAC_CLUSTER = "true";

  const { createOrchestrator } = await import("../orchestrator/Orchestrator.js");
  const { getSkillManager } = await import("../skills/SkillManager.js");

  const dryRun = flags["dry-run"] || false;
  const jsonOutput = flags.json || false;
  const orchestrator = createOrchestrator({ useClusterPath: true });
  const skillManager = getSkillManager();

  await orchestrator.initialize();
  await skillManager.initialize();

  const sessionId = `cluster-${Date.now()}`;

  if (!jsonOutput) {
    console.log("\n" + "=".repeat(60));
    console.log("       NAC DeepSeek Cluster Agent");
    console.log("=".repeat(60));
    console.log(`  Mode:     ${mode}`);
    console.log(`  Dry Run:  ${dryRun ? "yes" : "no"}`);
    console.log(`  Session:  ${sessionId}`);
    console.log(`  Task:     ${taskInput.substring(0, 60)}`);
    console.log("-".repeat(60) + "\n");
  }

  const startTime = Date.now();
  try {
    const result = await orchestrator.processRequest({
      sessionId,
      userInput: taskInput,
      context: { mode, dryRun, cluster: true },
    });

    if (jsonOutput) {
      console.log(JSON.stringify({ success: result.success, sessionId, mode, duration: Date.now() - startTime, data: result.data }, null, 2));
    } else {
      if (result.data?.response) console.log(result.data.response);
      console.log(`\n${result.success ? "✓" : "✗"} Completed in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    }
    await orchestrator.shutdown();
    process.exit(result.success ? 0 : 1);
  } catch (error: any) {
    if (jsonOutput) console.log(JSON.stringify({ success: false, error: error.message }));
    else console.error(`\n✗ Cluster run failed: ${error.message}`);
    await orchestrator.shutdown();
    process.exit(1);
  }
}

// ── Interactive Mode ───────────────────────────────────

async function runInteractive(): Promise<void> {
  console.log(BANNER);
  console.log(HELP);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\nYou> ",
  });

  const db = getSessionDB();
  const sessionId = `session_${Date.now()}`;
  db.createSession(sessionId, { mode: "interactive" });

  const agent = new AgentLoop();

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // Handle commands
    if (input.startsWith("/")) {
      switch (input) {
        case "/help":
          console.log(HELP);
          break;
        case "/clear":
          agent.clearHistory();
          console.log("History cleared.");
          break;
        case "/history":
          const history = agent.getHistory();
          console.log(`\n--- History (${history.length} messages) ---`);
          for (const msg of history.slice(-20)) {
            const content =
              typeof msg.content === "string"
                ? msg.content.substring(0, 150)
                : "[structured content]";
            console.log(`[${msg.role}] ${content}`);
          }
          console.log("---");
          break;
        case "/stats":
          await runStats();
          break;
        case "/eval":
          await runEval();
          break;
        case "/export":
          const recorder = getTrajectoryRecorder();
          const sftData = recorder.exportForSFT();
          const { writeFileSync } = await import("fs");
          writeFileSync("sft-export.json", JSON.stringify(sftData, null, 2), "utf-8");
          console.log(`Exported ${sftData.length} trajectories to sft-export.json`);
          break;
        case "/exit":
        case "/quit":
          console.log("\nGoodbye!");
          rl.close();
          return;
        default:
          console.log(`Unknown command: ${input}. Type /help for available commands.`);
      }
      rl.prompt();
      return;
    }

    // Process user request
    console.log("\nAgent: ", "");

    try {
      const result = await agent.run(input);

      console.log(result.finalResponse);
      console.log(
        `\n[${result.stopReason}] ${result.turns.length} turns · ${result.toolCallCount} tool calls · ${result.totalDuration}ms`
      );

      // Record trajectory
      const recorder = getTrajectoryRecorder();
      recorder.record(sessionId, input, result);

      // Save messages to session
      db.addMessage(sessionId, { role: "user", content: input, timestamp: Date.now() });
      db.addMessage(sessionId, {
        role: "assistant",
        content: result.finalResponse,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      console.log(`\nError: ${error.message}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    db.updateSessionStatus(sessionId, "completed");
    console.log("\nSession saved.");
    process.exit(0);
  });
}

// ── Entry Point ─────────────────────────────────────────

main().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
