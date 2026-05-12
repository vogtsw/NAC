/**
 * Agent System Exports
 */

import { BaseAgent } from './BaseAgent.js';
import { GenericAgent } from './GenericAgent.js';
import { CodeAgent } from './CodeAgent.js';
import { DataAgent } from './DataAgent.js';
import { AutomationAgent } from './AutomationAgent.js';
import { AnalysisAgent } from './AnalysisAgent.js';
import { AgentFactory } from './AgentFactory.js';
import { AgentConfig } from '../state/models.js';
import { getLLMClient } from '../llm/LLMClient.js';

// Re-export classes
export { BaseAgent, GenericAgent, CodeAgent, DataAgent, AutomationAgent, AnalysisAgent, AgentFactory };

/**
 * Singleton factory instance
 */
let factory: AgentFactory | null = null;

function getFactory(): AgentFactory {
  if (!factory) {
    const llm = getLLMClient();
    factory = new AgentFactory(llm);
  }
  return factory;
}

/**
 * Helper function to create a CodeAgent
 */
export async function getCodeAgent(config?: Partial<AgentConfig>): Promise<BaseAgent> {
  const fullConfig: AgentConfig = {
    skills: [],
    ...config,
    taskId: config?.taskId || `code-${Date.now()}`,
  };
  return getFactory().create('CodeAgent', fullConfig);
}

/**
 * Helper function to create a DataAgent
 */
export async function getDataAgent(config?: Partial<AgentConfig>): Promise<BaseAgent> {
  const fullConfig: AgentConfig = {
    skills: [],
    ...config,
    taskId: config?.taskId || `data-${Date.now()}`,
  };
  return getFactory().create('DataAgent', fullConfig);
}

/**
 * Helper function to create an AutomationAgent
 */
export async function getAutomationAgent(config?: Partial<AgentConfig>): Promise<BaseAgent> {
  const fullConfig: AgentConfig = {
    skills: [],
    ...config,
    taskId: config?.taskId || `automation-${Date.now()}`,
  };
  return getFactory().create('AutomationAgent', fullConfig);
}

/**
 * Helper function to create an AnalysisAgent
 */
export async function getAnalysisAgent(config?: Partial<AgentConfig>): Promise<BaseAgent> {
  const fullConfig: AgentConfig = {
    skills: [],
    ...config,
    taskId: config?.taskId || `analysis-${Date.now()}`,
  };
  return getFactory().create('AnalysisAgent', fullConfig);
}

/**
 * Helper function to create a GenericAgent
 */
export async function getGenericAgent(config?: Partial<AgentConfig>): Promise<BaseAgent> {
  const fullConfig: AgentConfig = {
    skills: [],
    ...config,
    taskId: config?.taskId || `generic-${Date.now()}`,
  };
  return getFactory().create('GenericAgent', fullConfig);
}

/**
 * Get the shared AgentFactory instance
 */
export function getAgentFactory(): AgentFactory {
  return getFactory();
}
