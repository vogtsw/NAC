/**
 * Configuration Management
 * Loads and manages application configuration from environment variables
 */

import dotenv from 'dotenv';

// Load .env file
dotenv.config();

export interface LLMConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ClusterConfig {
  name: string;
  maxParallelAgents: number;
  taskTimeout: number;
  agentIdleTimeout: number;
}

export interface OrchestratorConfig {
  llmProvider: string;
  llmConfig: LLMConfig;
  enableDAGOptimization: boolean;
  maxTaskRetries: number;
}

export interface AgentsConfig {
  defaultAgentType: string;
  maxContextLength: number;
}

export interface StorageConfig {
  redisUrl: string;
  redisDb: number;
  artifactsPath: string;
}

export interface APIConfig {
  host: string;
  port: number;
  enableDocs: boolean;
  corsOrigins: string[];
}

export interface MonitoringConfig {
  enabled: boolean;
  prometheusPort: number;
  logLevel: string;
  logPretty: boolean;
}

export interface Config {
  cluster: ClusterConfig;
  orchestrator: OrchestratorConfig;
  agents: AgentsConfig;
  storage: StorageConfig;
  api: APIConfig;
  monitoring: MonitoringConfig;
}

/**
 * Get configuration from environment variables
 */
export function getConfig(): Config {
  // Get LLM provider from environment
  const llmProvider = process.env.LLM_PROVIDER || 'zhipu';

  // Get LLM config based on provider
  let llmConfig: LLMConfig;

  switch (llmProvider) {
    case 'zhipu':
      llmConfig = {
        apiKey: process.env.ZHIPU_API_KEY || '',
        baseURL: process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/',
        model: process.env.ZHIPU_MODEL || 'glm-4-flash',
        temperature: 0.7,
        maxTokens: 2000,
      };
      break;

    case 'deepseek':
      llmConfig = {
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0.7,
        maxTokens: 2000,
      };
      break;

    case 'openai':
      llmConfig = {
        apiKey: process.env.OPENAI_API_KEY || '',
        baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        temperature: 0.7,
        maxTokens: 2000,
      };
      break;

    case 'qwen':
      llmConfig = {
        apiKey: process.env.QWEN_API_KEY || '',
        baseURL: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: process.env.QWEN_MODEL || 'qwen-max',
        temperature: 0.7,
        maxTokens: 2000,
      };
      break;

    default:
      // Default to zhipu
      llmConfig = {
        apiKey: process.env.ZHIPU_API_KEY || '',
        baseURL: process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/',
        model: process.env.ZHIPU_MODEL || 'glm-4-flash',
        temperature: 0.7,
        maxTokens: 2000,
      };
  }

  return {
    cluster: {
      name: 'nexus-agent-cluster',
      maxParallelAgents: parseInt(process.env.MAX_PARALLEL_AGENTS || '10', 10),
      taskTimeout: parseInt(process.env.TASK_TIMEOUT || '300000', 10),
      agentIdleTimeout: parseInt(process.env.AGENT_IDLE_TIMEOUT || '300000', 10),
    },
    orchestrator: {
      llmProvider,
      llmConfig,
      enableDAGOptimization: process.env.ENABLE_DAG_OPTIMIZATION === 'true',
      maxTaskRetries: parseInt(process.env.MAX_TASK_RETRIES || '3', 10),
    },
    agents: {
      defaultAgentType: process.env.DEFAULT_AGENT_TYPE || 'GenericAgent',
      maxContextLength: 8000,
    },
    storage: {
      redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
      redisDb: parseInt(process.env.REDIS_DB || '0', 10),
      artifactsPath: process.env.ARTIFACTS_PATH || './data/artifacts',
    },
    api: {
      host: process.env.API_HOST || '0.0.0.0',
      port: parseInt(process.env.API_PORT || '3000', 10),
      enableDocs: true,
      corsOrigins: (process.env.API_CORS_ORIGINS || '*').split(','),
    },
    monitoring: {
      enabled: process.env.ENABLE_METRICS === 'true',
      prometheusPort: parseInt(process.env.METRICS_PORT || '9090', 10),
      logLevel: process.env.LOG_LEVEL || 'info',
      logPretty: process.env.LOG_PRETTY !== 'false',
    },
  };
}

// Singleton instance
let config: Config | null = null;

export function loadConfig(): Config {
  if (!config) {
    config = getConfig();
  }
  return config;
}
