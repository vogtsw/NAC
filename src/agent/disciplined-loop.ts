/**
 * Disciplined Agent Loop
 *
 * 强制执行纪律——每个 Agent 角色有必需的工具链、验证检查点、失败升级路径。
 * 基于 benchmark 发现：Agent 足够聪明理解问题，但缺乏执行纪律。
 * 这层在框架层面强制执行，不仅依赖 prompt 指导。
 */
import { AgentLoop, type LoopOptions } from "./loop.js";
import type { AgentResult } from "./types.js";
import { createAssistantMessage, createUserMessage } from "./transcript.js";

// ═══ 角色执行契约 ═══
export interface RoleContract {
  role: string;
  /** 必选工具链（按顺序必须全部调用至少一次） */
  requiredToolSequence: string[];
  /** 禁止在满足条件前调用 task_complete */
  preconditionForCompletion: CompletionPrecondition;
  /** 最大修复尝试次数 */
  maxRepairAttempts: number;
  /** 失败时升级模型 */
  escalationModel?: string;
}

export type CompletionPrecondition =
  | { type: "tests_pass"; command?: string }
  | { type: "files_written"; minCount: number }
  | { type: "files_read"; minCount: number }
  | { type: "all_of"; conditions: CompletionPrecondition[] }
  | { type: "none" }; // no precondition

// ═══ 预定义角色契约 ═══
const ROLE_CONTRACTS: Record<string, RoleContract> = {
  PlannerAgent: {
    role: "PlannerAgent",
    requiredToolSequence: ["file_read", "task_complete"],
    preconditionForCompletion: { type: "files_read", minCount: 2 },
    maxRepairAttempts: 1,
  },
  ResearchAgent: {
    role: "ResearchAgent",
    requiredToolSequence: ["file_read", "task_complete"],
    preconditionForCompletion: { type: "files_read", minCount: 1 },
    maxRepairAttempts: 1,
    escalationModel: "deepseek-v4-pro",
  },
  CodeAgent: {
    role: "CodeAgent",
    requiredToolSequence: ["file_read", "file_write", "run_tests", "task_complete"],
    preconditionForCompletion: {
      type: "all_of",
      conditions: [
        { type: "tests_pass" },
        { type: "files_written", minCount: 1 },
      ],
    },
    maxRepairAttempts: 3,
    escalationModel: "deepseek-v4-pro",
  },
  TestAgent: {
    role: "TestAgent",
    requiredToolSequence: ["run_tests", "task_complete"],
    preconditionForCompletion: { type: "tests_pass" },
    maxRepairAttempts: 2,
  },
  ReviewAgent: {
    role: "ReviewAgent",
    requiredToolSequence: ["file_read", "task_complete"],
    preconditionForCompletion: { type: "files_read", minCount: 2 },
    maxRepairAttempts: 1,
  },
  CoordinatorAgent: {
    role: "CoordinatorAgent",
    requiredToolSequence: ["file_read", "task_complete"],
    preconditionForCompletion: { type: "none" },
    maxRepairAttempts: 1,
  },
};

// ═══ 执行统计 ═══
export interface DisciplineReport {
  role: string;
  contractSatisfied: boolean;
  toolSequenceCompleted: string[];
  toolSequenceMissing: string[];
  preconditionMet: boolean;
  preconditionDetail: string;
  repairAttempts: number;
  escalated: boolean;
  escalatedModel?: string;
}

// ═══ Disciplined Agent Loop ═══
export class DisciplinedAgentLoop {
  private loop: AgentLoop;
  private contract: RoleContract;
  private repairCount = 0;
  private toolsCalled: string[] = [];
  private writtenFiles: string[] = [];
  private readFiles: string[] = [];
  private testsPassed = false;

  constructor(
    private role: string,
    options: LoopOptions = {},
    contractOverride?: Partial<RoleContract>,
  ) {
    this.loop = new AgentLoop(options);
    this.contract = {
      ...(ROLE_CONTRACTS[role] || ROLE_CONTRACTS.GenericAgent || {
        role, requiredToolSequence: [], preconditionForCompletion: { type: "none" }, maxRepairAttempts: 0,
      }),
      ...contractOverride,
    };
  }

  /** 带有执行纪律的运行 */
  async run(task: string, signal?: AbortSignal): Promise<{
    result: AgentResult;
    discipline: DisciplineReport;
  }> {
    this.toolsCalled = [];
    this.writtenFiles = [];
    this.readFiles = [];
    this.testsPassed = false;
    this.repairCount = 0;

    // ── Phase 1: Inject role contract into system prompt ──
    const contractPrompt = this.buildContractPrompt();
    this.loop.addMessage(createUserMessage(contractPrompt));

    // ── Phase 2: Run agent loop ──
    let result = await this.loop.run(task, signal);

    // ── Phase 3: Extract tool calls from history ──
    this.extractToolUsage(result);

    // ── Phase 4: Repair loop ──
    while (!this.checkPrecondition() && this.repairCount < this.contract.maxRepairAttempts) {
      this.repairCount++;

      const missing = this.getMissingTools();
      const precondDetail = this.getPreconditionDetail();

      const repairPrompt =
        `[SYSTEM DISCIPLINE CHECK — Attempt ${this.repairCount}/${this.contract.maxRepairAttempts}]\n\n` +
        `Your role as ${this.role} requires:\n` +
        `1. Calling these tools: ${this.contract.requiredToolSequence.join(" → ")}\n` +
        (missing.length > 0 ? `   MISSING: ${missing.join(", ")}\n` : "") +
        `2. Meeting this condition before task_complete: ${precondDetail}\n` +
        (this.contract.escalationModel && this.repairCount >= 2
          ? `\n⚠ ESCALATION: This is your ${this.repairCount}${this.repairCount === 1 ? "st" : "nd"} retry. Your reasoning has been upgraded to maximum. Fix the issue NOW.\n`
          : `\nYou have ${this.contract.maxRepairAttempts - this.repairCount} attempt(s) remaining. Complete ALL required steps before calling task_complete.\n`);

      this.loop.clearHistory();
      this.loop.addMessage(createUserMessage(repairPrompt));
      this.loop.addMessage(createUserMessage(task));

      result = await this.loop.run(task, signal);
      this.extractToolUsage(result);
    }

    const discipline = this.buildReport();
    return { result, discipline };
  }

  /** 构建角色契约提示词 */
  private buildContractPrompt(): string {
    const seq = this.contract.requiredToolSequence.map((t, i) => `${i + 1}. ${t}`).join("\n");
    return (
      `[DISCIPLINED EXECUTION MODE — ${this.role}]\n\n` +
      `You are operating under enforced execution discipline. You MUST follow this sequence:\n${seq}\n\n` +
      `Rules:\n` +
      `- Call ALL tools in the sequence at least once before task_complete\n` +
      `- Do NOT skip steps — if a file needs fixing, you MUST file_write before task_complete\n` +
      `- If run_tests is required, you MUST run tests and they MUST pass before task_complete\n` +
      `- If a step fails, retry with a different approach — do NOT give up\n` +
      `- The discipline system will CHECK your work and may REJECT incomplete task_complete calls\n\n` +
      `Begin execution now.`
    );
  }

  private extractToolUsage(result: AgentResult): void {
    this.toolsCalled = [];
    this.writtenFiles = [];
    this.readFiles = [];
    this.testsPassed = false;

    for (const turn of result.turns) {
      if (turn.toolCalls) {
        for (const tc of turn.toolCalls) {
          this.toolsCalled.push(tc.name);
          if (tc.name === "file_write" || tc.name === "write_file") {
            this.writtenFiles.push((tc.arguments as any)?.path || "unknown");
          }
          if (tc.name === "file_read" || tc.name === "read_file") {
            this.readFiles.push((tc.arguments as any)?.path || "unknown");
          }
          if (tc.name === "run_tests" || tc.name === "bash") {
            // Check if tests passed from tool result
            if (turn.toolResults) {
              const idx = turn.toolCalls.indexOf(tc);
              const resultStr = turn.toolResults[idx]?.result || "";
              if (resultStr.includes("PASS:") && !resultStr.includes("FAIL:1") && !resultStr.includes("FAIL:2")) {
                const fm = resultStr.match(/FAIL:(\d+)/);
                this.testsPassed = !fm || parseInt(fm[1]) === 0;
              }
            }
          }
        }
      }
    }
  }

  private checkPrecondition(): boolean {
    // Check required tools all called
    const missing = this.getMissingTools();
    if (missing.length > 0) return false;

    // Check completion precondition
    const pc = this.contract.preconditionForCompletion;
    return this.evaluatePrecondition(pc);
  }

  private evaluatePrecondition(pc: CompletionPrecondition): boolean {
    switch (pc.type) {
      case "none": return true;
      case "tests_pass": return this.testsPassed;
      case "files_written": return this.writtenFiles.length >= pc.minCount;
      case "files_read": return this.readFiles.length >= pc.minCount;
      case "all_of":
        return pc.conditions.every(c => this.evaluatePrecondition(c));
      default: return true;
    }
  }

  private getMissingTools(): string[] {
    const called = new Set(this.toolsCalled);
    return this.contract.requiredToolSequence.filter(t => !called.has(t));
  }

  private getPreconditionDetail(): string {
    const pc = this.contract.preconditionForCompletion;
    switch (pc.type) {
      case "none": return "No precondition";
      case "tests_pass": return `Tests must pass (current: ${this.testsPassed ? "PASS" : "FAIL"})`;
      case "files_written": return `At least ${pc.minCount} file(s) must be written (current: ${this.writtenFiles.length})`;
      case "files_read": return `At least ${pc.minCount} file(s) must be read (current: ${this.readFiles.length})`;
      case "all_of": return pc.conditions.map(c => this.getConditionDetail(c)).join(" AND ");
      default: return "Unknown precondition";
    }
  }

  private getConditionDetail(pc: CompletionPrecondition): string {
    switch (pc.type) {
      case "tests_pass": return `tests pass (${this.testsPassed ? "✅" : "❌"})`;
      case "files_written": return `${pc.minCount}+ files written (${this.writtenFiles.length})`;
      case "files_read": return `${pc.minCount}+ files read (${this.readFiles.length})`;
      default: return "";
    }
  }

  private buildReport(): DisciplineReport {
    const missing = this.getMissingTools();
    const preconditionMet = this.checkPrecondition();

    return {
      role: this.role,
      contractSatisfied: missing.length === 0 && preconditionMet,
      toolSequenceCompleted: this.contract.requiredToolSequence.filter(t => this.toolsCalled.includes(t)),
      toolSequenceMissing: missing,
      preconditionMet,
      preconditionDetail: this.getPreconditionDetail(),
      repairAttempts: this.repairCount,
      escalated: this.repairCount >= 2 && !!this.contract.escalationModel,
      escalatedModel: this.repairCount >= 2 ? this.contract.escalationModel : undefined,
    };
  }

  getLoop(): AgentLoop { return this.loop; }
  getContract(): RoleContract { return this.contract; }
}
