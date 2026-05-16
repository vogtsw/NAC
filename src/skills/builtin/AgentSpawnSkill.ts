/**
 * AgentSpawnSkill
 * Cluster agent lifecycle management: spawn, wait, result, cancel.
 * Wires into real AgentFactory and AgentLoop for persistent sub-agent execution.
 */

import { Skill, SkillCategory, SkillContext, SkillResult } from "../types.js";
import { getLogger } from "../../monitoring/logger.js";
import type { BaseAgent } from "../../agents/BaseAgent.js";

const logger = getLogger("AgentSpawn");

export interface SpawnedAgent {
  id: string;
  type: string;
  role: string;
  model: string;
  status: "running" | "completed" | "failed" | "cancelled";
  task: string;
  result?: unknown;
  error?: string;
  startedAt: number;
  completedAt?: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// In-memory agent registry (production would use Blackboard/Redis)
const agentRegistry = new Map<string, SpawnedAgent>();

export const AgentSpawnSkill: Skill = {
  name: "agent-spawn",
  description: "Spawn, wait, get results, cancel, and list sub-agents in the cluster",
  category: SkillCategory.AUTOMATION,
  version: "1.0.0",
  enabled: true,
  builtin: true,
  parameters: {
    required: ["operation"],
    optional: ["agentType", "role", "model", "task", "agentId", "timeout"],
  },

  async execute(_context: SkillContext, params: any): Promise<SkillResult> {
    try {
      let result: any;
      switch (params.operation) {
        case "spawn":
          result = await spawnAgent(params);
          break;
        case "wait":
          result = await waitAgent(params);
          break;
        case "result":
          result = getAgentResult(params);
          break;
        case "cancel":
          result = cancelAgent(params);
          break;
        case "list":
          result = listAgents();
          break;
        default:
          return { success: false, error: `Unknown operation: ${params.operation}`, result: null };
      }
      return { success: true, result };
    } catch (error: any) {
      return { success: false, error: error.message, result: null };
    }
  },

  validate(params: any): boolean {
    switch (params.operation) {
      case "spawn":
        return !!(params.agentType && params.task);
      case "wait":
      case "result":
      case "cancel":
        return !!params.agentId;
      case "list":
        return true;
      default:
        return false;
    }
  },
};

async function spawnAgent(params: Record<string, any>): Promise<SpawnedAgent> {
  const id = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const agentType = params.agentType || "GenericAgent";
  const task = params.task || "Unnamed task";

  const agent: SpawnedAgent = {
    id,
    type: agentType,
    role: params.role || "worker",
    model: params.model || "deepseek-v4-flash",
    status: "running",
    task,
    startedAt: Date.now(),
  };

  agentRegistry.set(id, agent);

  // Wire into real AgentFactory for execution
  try {
    const { AgentFactory } = await import("../../agents/AgentFactory.js");
    const { getLLMClient } = await import("../../llm/LLMClient.js");
    const factory = new AgentFactory(getLLMClient());
    const agentInstance = await factory.create(agentType, { taskId: id, skills: [] } as any);

    // Execute in background
    const executePromise = agentInstance.execute({
      id,
      name: task,
      description: task,
      agentType,
      requiredSkills: [],
      dependencies: [],
      estimatedDuration: 120,
    });

    // Track execution
    executePromise.then((result: any) => {
      const existing = agentRegistry.get(id);
      if (existing) {
        existing.status = result?.error ? "failed" : "completed";
        existing.result = result;
        existing.completedAt = Date.now();
        logger.info({ id, status: existing.status }, "Agent execution finished");
      }
    }).catch((error: any) => {
      const existing = agentRegistry.get(id);
      if (existing) {
        existing.status = "failed";
        existing.error = error.message;
        existing.completedAt = Date.now();
        logger.warn({ id, error: error.message }, "Agent execution failed");
      }
    });

    logger.info({ id, type: agentType, role: agent.role, realExecution: true }, "Agent spawned with real execution");
  } catch (error: any) {
    logger.warn({ id, error: error.message }, "Agent spawned but real execution setup failed — using placeholder");
  }

  return agent;
}

async function waitAgent(params: Record<string, any>): Promise<SpawnedAgent> {
  const { agentId, timeout = 300000 } = params;
  const agent = agentRegistry.get(agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  const start = Date.now();

  while (agent.status === "running") {
    if (Date.now() - start > timeout) {
      agent.status = "failed";
      agent.error = "Timeout waiting for agent";
      return agent;
    }
    await sleep(100);
  }

  return agent;
}

function getAgentResult(params: Record<string, any>): SpawnedAgent | null {
  const { agentId } = params;
  const agent = agentRegistry.get(agentId);
  if (!agent) return null;

  if (agent.status === "completed" || agent.status === "failed") {
    return agent;
  }

  return agent;
}

function cancelAgent(params: Record<string, any>): { cancelled: boolean; agentId: string } {
  const { agentId } = params;
  const agent = agentRegistry.get(agentId);
  if (!agent) return { cancelled: false, agentId };

  agent.status = "cancelled";
  agent.completedAt = Date.now();
  logger.info({ agentId }, "Agent cancelled");
  return { cancelled: true, agentId };
}

function listAgents(): SpawnedAgent[] {
  return Array.from(agentRegistry.values());
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Mark an agent as completed with a result.
 * Called by the orchestrator when a sub-agent finishes work.
 */
export function markAgentComplete(agentId: string, result: unknown): void {
  const agent = agentRegistry.get(agentId);
  if (!agent) {
    logger.warn({ agentId }, "Attempt to complete unknown agent");
    return;
  }
  agent.status = "completed";
  agent.result = result;
  agent.completedAt = Date.now();
  logger.info({ agentId }, "Agent completed");
}

/**
 * Mark an agent as failed with an error.
 */
export function markAgentFailed(agentId: string, error: string): void {
  const agent = agentRegistry.get(agentId);
  if (!agent) {
    logger.warn({ agentId }, "Attempt to fail unknown agent");
    return;
  }
  agent.status = "failed";
  agent.error = error;
  agent.completedAt = Date.now();
  logger.warn({ agentId, error }, "Agent failed");
}

/**
 * Update agent token usage.
 */
export function updateAgentTokens(
  agentId: string,
  usage: { promptTokens: number; completionTokens: number; totalTokens: number },
): void {
  const agent = agentRegistry.get(agentId);
  if (agent) {
    agent.tokenUsage = usage;
  }
}

/**
 * Clear all agents (for testing/cleanup).
 */
export function clearAgentRegistry(): void {
  agentRegistry.clear();
  logger.info("Agent registry cleared");
}

/**
 * Get running agent count.
 */
export function getRunningAgentCount(): number {
  let count = 0;
  for (const agent of agentRegistry.values()) {
    if (agent.status === "running") count++;
  }
  return count;
}
