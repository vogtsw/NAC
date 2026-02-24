/**
 * Agent Factory
 * Dynamic agent creation and management
 */

import { BaseAgent } from './BaseAgent.js';
import { GenericAgent } from './GenericAgent.js';
import { CodeAgent } from './CodeAgent.js';
import { DataAgent } from './DataAgent.js';
import { AutomationAgent } from './AutomationAgent.js';
import { AnalysisAgent } from './AnalysisAgent.js';
import { AgentConfig, AgentInfo, AgentStatus } from '../state/models.js';
import { SkillManager, getSkillManager } from '../skills/SkillManager.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('AgentFactory');

/**
 * Agent registry mapping
 */
const AGENT_REGISTRY: Record<string, new (llm: any, skillManager: any) => BaseAgent> = {
  GenericAgent,
  CodeAgent,
  DataAgent,
  AutomationAgent,
  AnalysisAgent,
};

/**
 * Agent Factory - Create and manage agents
 */
export class AgentFactory {
  private activeAgents: Map<string, BaseAgent> = new Map();
  private skillManager: SkillManager;

  constructor(llm: any) {
    this.skillManager = getSkillManager();
    logger.info('AgentFactory created');
  }

  /**
   * Create an agent instance
   */
  async create(agentType: string, config: AgentConfig): Promise<BaseAgent> {
    logger.info({ agentType, taskId: config.taskId }, 'Creating agent');

    const AgentClass = AGENT_REGISTRY[agentType] || GenericAgent;

    // Create a simple wrapper for the llm parameter
    const llmWrapper = { complete: async () => '' };
    const agent = new AgentClass(llmWrapper, this.skillManager);

    this.activeAgents.set(config.taskId, agent);

    return agent;
  }

  /**
   * Recycle an agent
   */
  async recycle(taskId: string): Promise<boolean> {
    const deleted = this.activeAgents.delete(taskId);
    if (deleted) {
      logger.info({ taskId }, 'Agent recycled');
    }
    return deleted;
  }

  /**
   * Get all active agents
   */
  async getActiveAgents(): Promise<AgentInfo[]> {
    const agents: AgentInfo[] = [];

    for (const [taskId, agent] of this.activeAgents.entries()) {
      const stats = agent.getStats();
      agents.push({
        agentId: taskId,
        agentType: stats.agentType,
        status: stats.status as AgentStatus,
        capabilities: [],
        tasksCompleted: stats.tasksCompleted,
        totalExecutionTime: stats.totalExecutionTime,
        createdAt: new Date(),
      });
    }

    return agents;
  }

  /**
   * Get agent by task ID
   */
  getAgent(taskId: string): BaseAgent | undefined {
    return this.activeAgents.get(taskId);
  }

  /**
   * Get skill manager
   */
  getSkillManager(): SkillManager {
    return this.skillManager;
  }

  /**
   * Clean up idle agents
   */
  async cleanupIdleAgents(timeout: number = 300000): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [taskId, agent] of this.activeAgents.entries()) {
      if (agent.getStatus() === AgentStatus.IDLE) {
        const stats = agent.getStats();
        // Simple heuristic: if agent hasn't completed tasks recently
        if (stats.tasksCompleted === 0) {
          this.activeAgents.delete(taskId);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned up idle agents');
    }

    return cleaned;
  }
}

/**
 * Factory function
 */
export function createAgentFactory(llm: any): AgentFactory {
  return new AgentFactory(llm);
}
