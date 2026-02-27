/**
 * Agent Registry - Agent 注册表
 * 支持动态注册、发现和管理 Agent 类型
 */

import { getLogger } from '../monitoring/logger.js';
import { promises as fs } from 'fs';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { AgentCapability, AgentTypeClass } from '../state/models.js';

const logger = getLogger('AgentRegistry');

/**
 * Agent 能力描述接口
 */
export interface AgentProfile {
  agentType: string;
  description: string;
  strengths: string[];
  weaknesses: string[];
  idealTasks: string[];
  requiredSkills: string[];
  examples: string[];
  version: string;
  author?: string;
}

/**
 * Agent 注册表 - 管理所有 Agent 类型和能力
 */
export class AgentRegistry {
  private capabilities: Map<string, AgentCapability> = new Map();
  private agentClasses: Map<string, AgentTypeClass> = new Map();
  private profiles: Map<string, AgentProfile> = new Map();
  private initialized: boolean = false;

  constructor() {}

  /**
   * 初始化注册表，加载内置 Agent 和自定义 Agent
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 1. 注册内置 Agent
    await this.registerBuiltinAgents();

    // 2. 加载自定义 Agent
    await this.loadCustomAgents();

    this.initialized = true;
    logger.info({ count: this.capabilities.size }, 'AgentRegistry initialized');
  }

  /**
   * 注册一个 Agent 类型
   */
  registerAgent(
    agentType: string,
    agentClass: AgentTypeClass,
    profile: AgentProfile
  ): void {
    this.agentClasses.set(agentType, agentClass);
    this.profiles.set(agentType, profile);

    // 同时存储能力描述
    this.capabilities.set(agentType, {
      agentType,
      description: profile.description,
      strengths: profile.strengths,
      weaknesses: profile.weaknesses,
      idealTasks: profile.idealTasks,
      requiredSkills: profile.requiredSkills,
      examples: profile.examples,
    });

    logger.info({ agentType, version: profile.version }, 'Agent registered');
  }

  /**
   * 批量注册 Agents
   */
  registerAgents(agents: Array<{
    type: string;
    class: AgentTypeClass;
    profile: AgentProfile;
  }>): void {
    for (const agent of agents) {
      this.registerAgent(agent.type, agent.class, agent.profile);
    }
  }

  /**
   * 获取 Agent 类
   */
  getAgentClass(agentType: string): AgentTypeClass | undefined {
    return this.agentClasses.get(agentType);
  }

  /**
   * 获取 Agent 能力描述
   */
  getCapability(agentType: string): AgentCapability | undefined {
    return this.capabilities.get(agentType);
  }

  /**
   * 获取 Agent Profile
   */
  getProfile(agentType: string): AgentProfile | undefined {
    return this.profiles.get(agentType);
  }

  /**
   * 获取所有能力描述
   */
  getAllCapabilities(): AgentCapability[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * 获取所有已注册的 Agent 类型
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.agentClasses.keys());
  }

  /**
   * 检查 Agent 是否已注册
   */
  isRegistered(agentType: string): boolean {
    return this.agentClasses.has(agentType);
  }

  /**
   * 注销一个 Agent
   */
  unregister(agentType: string): boolean {
    const deleted = this.agentClasses.delete(agentType) &&
                   this.capabilities.delete(agentType) &&
                   this.profiles.delete(agentType);

    if (deleted) {
      logger.info({ agentType }, 'Agent unregistered');
    }
    return deleted;
  }

  /**
   * 根据 Skill 查找 capable Agents
   */
  findAgentsBySkill(skillName: string): string[] {
    return Array.from(this.capabilities.values())
      .filter(cap => cap.requiredSkills?.includes(skillName))
      .map(cap => cap.agentType);
  }

  /**
   * 根据任务描述查找最合适的 Agents
   */
  findAgentsForTask(taskDescription: string): Array<{
    agentType: string;
    matchScore: number;
  }> {
    const desc = taskDescription.toLowerCase();
    const keywords = desc.split(/\s+/);

    return Array.from(this.capabilities.values()).map(cap => {
      let score = 0;

      // 检查 idealTasks 匹配
      for (const idealTask of cap.idealTasks || []) {
        if (desc.includes(idealTask.toLowerCase())) {
          score += 2;
        }
      }

      // 检查 strengths 匹配
      for (const strength of cap.strengths || []) {
        if (desc.includes(strength.toLowerCase())) {
          score += 1;
        }
      }

      // 检查描述匹配
      const descWords = cap.description.toLowerCase().split(/\s+/);
      for (const keyword of keywords) {
        if (descWords.includes(keyword)) {
          score += 0.5;
        }
      }

      return { agentType: cap.agentType, matchScore: score };
    }).sort((a, b) => b.matchScore - a.matchScore);
  }

  /**
   * 注册内置 Agents
   */
  private async registerBuiltinAgents(): Promise<void> {
    // 动态导入内置 Agents
    const { CodeAgent } = await import('../agents/CodeAgent.js');
    const { DataAgent } = await import('../agents/DataAgent.js');
    const { AutomationAgent } = await import('../agents/AutomationAgent.js');
    const { AnalysisAgent } = await import('../agents/AnalysisAgent.js');
    const { GenericAgent } = await import('../agents/GenericAgent.js');

    // 注册内置 Agents
    this.registerAgent('CodeAgent', CodeAgent, {
      agentType: 'CodeAgent',
      description: '专业的软件开发 Agent，负责代码生成、重构、API 设计等开发任务',
      strengths: [
        '代码生成',
        '代码重构',
        'API 设计',
        '单元测试编写',
        '技术方案设计'
      ],
      weaknesses: [
        '不适合纯数据分析任务',
        '不擅长非技术性文档编写'
      ],
      idealTasks: [
        'generate code',
        'refactor code',
        'create API',
        'write tests',
        'implement feature',
        'code review',
        'debug'
      ],
      requiredSkills: ['code-generation', 'code-review', 'file-ops'],
      examples: [
        '生成一个用户认证 API',
        '重构支付模块代码',
        '为现有代码添加单元测试'
      ],
      version: '1.0.0',
      author: 'NexusAgent Team'
    });

    this.registerAgent('DataAgent', DataAgent, {
      agentType: 'DataAgent',
      description: '专业的数据处理 Agent，负责数据分析、数据清洗、可视化等任务',
      strengths: [
        '数据分析',
        '数据清洗',
        '数据可视化',
        '统计计算',
        '格式转换'
      ],
      weaknesses: [
        '不适合复杂业务逻辑开发',
        '不擅长前端 UI 开发'
      ],
      idealTasks: [
        'analyze data',
        'process data',
        'clean data',
        'transform data',
        'calculate statistics',
        'generate chart',
        'data visualization'
      ],
      requiredSkills: ['data-analysis', 'file-ops'],
      examples: [
        '分析销售数据并生成报告',
        '清洗 CSV 文件中的异常值',
        '将 JSON 数据转换为 Excel'
      ],
      version: '1.0.0',
      author: 'NexusAgent Team'
    });

    this.registerAgent('AutomationAgent', AutomationAgent, {
      agentType: 'AutomationAgent',
      description: '专业的自动化 Agent，负责工作流自动化、部署、批量操作等任务',
      strengths: [
        '工作流自动化',
        'CI/CD 部署',
        '批量文件操作',
        '脚本执行',
        '系统监控'
      ],
      weaknesses: [
        '不适合创造性开发任务',
        '不擅长复杂算法实现'
      ],
      idealTasks: [
        'deploy',
        'automate workflow',
        'run script',
        'batch operation',
        'CI/CD',
        'monitor',
        'schedule task'
      ],
      requiredSkills: ['terminal-exec', 'file-ops'],
      examples: [
        '部署应用到生产环境',
        '批量重命名文件',
        '设置定时任务监控服务器'
      ],
      version: '1.0.0',
      author: 'NexusAgent Team'
    });

    this.registerAgent('AnalysisAgent', AnalysisAgent, {
      agentType: 'AnalysisAgent',
      description: '专业的分析 Agent，负责代码审查、问题诊断、技术调研等任务',
      strengths: [
        '代码审查',
        '问题诊断',
        '性能分析',
        '技术调研',
        '安全审计'
      ],
      weaknesses: [
        '不适合直接修改代码',
        '不擅长从零开发功能'
      ],
      idealTasks: [
        'review code',
        'analyze problem',
        'diagnose issue',
        'performance analysis',
        'security audit',
        'research technology',
        'compare solutions'
      ],
      requiredSkills: ['code-review', 'data-analysis'],
      examples: [
        '审查代码中的安全漏洞',
        '分析系统性能瓶颈',
        '调研微服务架构方案'
      ],
      version: '1.0.0',
      author: 'NexusAgent Team'
    });

    this.registerAgent('GenericAgent', GenericAgent, {
      agentType: 'GenericAgent',
      description: '通用 Agent，可处理各类任务，作为其他 Agent 的补充',
      strengths: [
        '任务灵活性高',
        '适应性强',
        '可作为后备方案'
      ],
      weaknesses: [
        '专业性不如特定 Agent',
        '可能需要更多上下文'
      ],
      idealTasks: [
        'general task',
        'documentation',
        'planning',
        'coordination'
      ],
      requiredSkills: [],
      examples: [
        '编写项目文档',
        '制定开发计划',
        '协调多任务执行'
      ],
      version: '1.0.0',
      author: 'NexusAgent Team'
    });

    logger.info('Built-in agents registered');
  }

  /**
   * 加载自定义 Agents
   */
  private async loadCustomAgents(): Promise<void> {
    const customAgentDirs = [
      resolve(process.cwd(), 'src/agents/custom'),
      resolve(process.cwd(), 'agents'),
    ];

    for (const agentDir of customAgentDirs) {
      if (!existsSync(agentDir)) continue;

      try {
        await this.loadAgentsFromDirectory(agentDir);
      } catch (error: any) {
        logger.warn({ dir: agentDir, error: error.message }, 'Failed to load custom agents');
      }
    }
  }

  /**
   * 从目录加载自定义 Agents
   */
  private async loadAgentsFromDirectory(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // 检查是否有 agent.config.json
        const configPath = join(directory, entry.name, 'agent.config.json');
        if (existsSync(configPath)) {
          await this.loadCustomAgent(directory, entry.name);
        }
      }
    }
  }

  /**
   * 加载单个自定义 Agent
   */
  private async loadCustomAgent(baseDir: string, agentName: string): Promise<void> {
    const agentDir = join(baseDir, agentName);
    const configPath = join(agentDir, 'agent.config.json');
    const entryPath = join(agentDir, 'index.ts');

    if (!existsSync(configPath) || !existsSync(entryPath)) {
      logger.warn({ agentName }, 'Custom agent missing required files');
      return;
    }

    try {
      // 读取配置
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      // 动态导入 Agent 类
      const module = await import(`file:///${entryPath.replace(/\\/g, '/')}`);

      const agentClass = module.default || module[agentName];
      if (!agentClass) {
        logger.warn({ agentName }, 'Agent class not found in module');
        return;
      }

      // 注册 Agent
      this.registerAgent(agentName, agentClass, {
        agentType: agentName,
        description: config.description || `Custom agent: ${agentName}`,
        strengths: config.strengths || [],
        weaknesses: config.weaknesses || [],
        idealTasks: config.idealTasks || [],
        requiredSkills: config.requiredSkills || [],
        examples: config.examples || [],
        version: config.version || '1.0.0',
        author: config.author,
      });

      logger.info({ agentName }, 'Custom agent loaded');
    } catch (error: any) {
      logger.error({ agentName, error: error.message }, 'Failed to load custom agent');
    }
  }

  /**
   * 获取注册表统计信息
   */
  getStats(): {
    totalAgents: number;
    builtinAgents: number;
    customAgents: number;
    totalSkills: number;
    agentsBySkill: Record<string, string[]>;
  } {
    const skillMap: Record<string, string[]> = {};

    for (const [agentType, cap] of this.capabilities) {
      for (const skill of cap.requiredSkills || []) {
        if (!skillMap[skill]) {
          skillMap[skill] = [];
        }
        skillMap[skill].push(agentType);
      }
    }

    return {
      totalAgents: this.agentClasses.size,
      builtinAgents: Array.from(this.profiles.values())
        .filter(p => p.author === 'NexusAgent Team').length,
      customAgents: Array.from(this.profiles.values())
        .filter(p => p.author !== 'NexusAgent Team').length,
      totalSkills: Object.keys(skillMap).length,
      agentsBySkill: skillMap,
    };
  }
}

// Singleton instance
let registry: AgentRegistry | null = null;

export function getAgentRegistry(): AgentRegistry {
  if (!registry) {
    registry = new AgentRegistry();
  }
  return registry;
}

export function createAgentRegistry(): AgentRegistry {
  return new AgentRegistry();
}
