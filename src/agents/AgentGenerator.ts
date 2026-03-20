/**
 * Agent 自动生成器
 * 基于任务特征自动生成新的 Agent 配置文件
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import type { LLMClient } from '../llm/LLMClient.js';
import type { Intent } from '../state/models.js';
import type { AgentRegistry } from '../orchestrator/AgentRegistry.js';

/**
 * 任务特征分析结果
 */
export interface TaskFeatures {
  taskType: string;              // 任务类型（如 'blockchain', 'ai-model'）
  capabilities: string[];         // 所需能力列表
  skills: string[];              // 所需技能列表
  complexity: 'simple' | 'medium' | 'complex';
  requiresNewAgent: boolean;     // 是否需要新 Agent
  suggestedAgentName?: string;   // 建议的 Agent 名称
  description?: string;          // Agent 描述
  strengths?: string[];          // 擅长的能力
  weaknesses?: string[];         // 不擅长的能力
  idealTasks?: string[];         // 适合的任务
  requiredSkills?: string[];     // 所需技能
  systemPrompt?: string;         // 系统提示词
}

/**
 * Agent 配置文件
 */
export interface AgentConfig {
  agentType: string;             // Agent 类型名称
  description: string;           // 功能描述
  version: string;              // 版本号
  author?: string;              // 作者
  capabilities: {
    strengths: string[];        // 擅长的能力
    weaknesses: string[];       // 不擅长的能力
    idealTasks: string[];       // 适合的任务
    requiredSkills: string[];   // 所需技能
  };
  systemPrompt: string;          // 系统提示词内容
}

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Agent 生成记录
 */
export interface AgentGenerationRecord {
  agentType: string;
  taskId: string;
  configPath: string;
  timestamp: Date;
}

/**
 * Agent 自动生成器类
 */
export class AgentGenerator {
  private llm: LLMClient;
  private agentRegistry: AgentRegistry;
  private agentsDir: string;
  private templatesDir: string;

  constructor(llm: LLMClient, agentRegistry: AgentRegistry) {
    this.llm = llm;
    this.agentRegistry = agentRegistry;
    this.agentsDir = join(process.cwd(), 'config', 'agents');
    this.templatesDir = join(process.cwd(), 'config', 'agents', 'templates');
  }

  /**
   * 分析任务特征，判断是否需要新 Agent
   */
  async analyzeTaskFeatures(intent: Intent): Promise<TaskFeatures> {
    const existingAgents = this.agentRegistry.getRegisteredTypes();

    // 首先进行快速检查：如果任务可以被现有 Agent 处理，直接返回
    const quickCheck = this.quickAgentCheck(intent);
    if (quickCheck.canHandle) {
      console.log(`[AgentGenerator] ✅ 现有 ${quickCheck.suggestedAgent} 可以处理此任务，无需生成新 Agent`);
      return {
        taskType: intent.type,
        capabilities: intent.capabilities,
        skills: [],
        complexity: intent.complexity as any,
        requiresNewAgent: false
      };
    }

    const prompt = `你是一个任务分析专家。请分析以下任务的特征：

任务描述：${intent.primaryGoal}
任务类型：${intent.type}
所需能力：${intent.capabilities.join(', ')}
复杂度：${intent.complexity}

现有 Agent 类型：${existingAgents.join(', ')}

**重要提示**：请严格按照以下标准判断是否需要新 Agent：
- 如果任务是软件开发、代码生成、系统设计，使用 CodeAgent + AnalysisAgent 即可
- 如果任务是数据分析、处理、可视化，使用 DataAgent 即可
- 如果任务是自动化、脚本编写、工作流，使用 AutomationAgent 即可
- 只有当任务涉及高度专业化的领域（如区块链、特定行业知识、特殊协议）且现有 Agent 无法处理时，才建议创建新 Agent

请判断：
1. 这个任务是否需要一个新的 Agent 类型？（现有 Agent 无法有效处理）
2. 如果需要，新 Agent 应该叫什么名字？（请使用 PascalCase，以 "Agent" 结尾，如 BlockchainAgent）
3. 新 Agent 应该具备什么能力？（列出 3-5 项）
4. 新 Agent 需要哪些技能？（从现有技能中选择或建议新技能）
5. 新 Agent 的系统提示词应该包含什么内容？

请以 JSON 格式返回，不要有任何其他文字：
{
  "requiresNewAgent": true/false,
  "taskType": "任务类型",
  "suggestedAgentName": "AgentName",
  "description": "Agent 功能描述（一句话）",
  "strengths": ["擅长1", "擅长2", "擅长3"],
  "weaknesses": ["不擅长1"],
  "idealTasks": ["任务关键词1", "任务关键词2", "任务关键词3"],
  "requiredSkills": ["skill1", "skill2"],
  "systemPrompt": "完整的系统提示词内容，包含 Agent 的角色定义、工作原则、输出格式等"
}`;

    try {
      const response = await this.llm.complete(prompt);

      // 尝试解析 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log('[AgentGenerator] LLM 返回的内容不是有效的 JSON');
        return {
          taskType: intent.type,
          capabilities: intent.capabilities,
          skills: [],
          complexity: intent.complexity as any,
          requiresNewAgent: false
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        taskType: parsed.taskType || intent.type,
        capabilities: intent.capabilities,
        skills: parsed.requiredSkills || [],
        complexity: intent.complexity as any,
        requiresNewAgent: parsed.requiresNewAgent || false,
        suggestedAgentName: parsed.suggestedAgentName,
        description: parsed.description,
        strengths: parsed.strengths,
        weaknesses: parsed.weaknesses,
        idealTasks: parsed.idealTasks,
        requiredSkills: parsed.requiredSkills,
        systemPrompt: parsed.systemPrompt
      };
    } catch (error) {
      console.error('[AgentGenerator] 分析任务特征失败:', error);
      return {
        taskType: intent.type,
        capabilities: intent.capabilities,
        skills: [],
        complexity: intent.complexity as any,
        requiresNewAgent: false
      };
    }
  }

  /**
   * 快速检查：判断任务是否可以被现有 Agent 处理
   * 避免不必要的 LLM 调用和 Agent 生成
   */
  private quickAgentCheck(intent: Intent): { canHandle: boolean; suggestedAgent?: string } {
    const goal = intent.primaryGoal.toLowerCase();
    const type = intent.type;

    // 代码/开发相关任务 - CodeAgent + AnalysisAgent
    const codeKeywords = [
      '代码', 'code', '开发', 'develop', '软件', 'software',
      '应用', 'application', 'app', '系统', 'system',
      '实现', 'implement', '编程', 'program', '函数', 'function',
      'api', '接口', 'interface', '组件', 'component'
    ];

    // 数据相关任务 - DataAgent
    const dataKeywords = [
      '数据', 'data', '分析', 'analyze', '统计', 'statistics',
      '图表', 'chart', '可视化', 'visualize', '报表', 'report',
      '数据库', 'database', '数据集', 'dataset'
    ];

    // 自动化相关任务 - AutomationAgent
    const automationKeywords = [
      '自动', 'auto', '自动化', 'automation', '脚本', 'script',
      '批量', 'batch', '工作流', 'workflow', '定时', 'schedule'
    ];

    // 检查是否是代码开发任务
    if (type === 'code' || type === 'other' || codeKeywords.some(k => goal.includes(k))) {
      // 排除需要高度专业化的领域
      const specializedDomains = [
        'blockchain', '智能合约', 'smart contract', 'solidity', '区块链',
        '机器学习', 'machine learning', 'ml', '深度学习', 'deep learning',
        '游戏', 'game', '游戏引擎', 'game engine'
      ];

      if (!specializedDomains.some(d => goal.includes(d))) {
        return { canHandle: true, suggestedAgent: 'CodeAgent + AnalysisAgent' };
      }
    }

    // 检查是否是数据分析任务
    if (type === 'data' || dataKeywords.some(k => goal.includes(k))) {
      return { canHandle: true, suggestedAgent: 'DataAgent' };
    }

    // 检查是否是自动化任务
    if (type === 'automation' || automationKeywords.some(k => goal.includes(k))) {
      return { canHandle: true, suggestedAgent: 'AutomationAgent' };
    }

    // 默认情况下，表示现有 Agent 可能无法处理
    return { canHandle: false };
  }

  /**
   * 生成 Agent 配置
   */
  async generateAgentConfig(features: TaskFeatures): Promise<AgentConfig> {
    // 1. 生成 Agent 类型名称
    const agentType = features.suggestedAgentName || `CustomAgent_${Date.now()}`;

    // 2. 如果没有系统提示词，使用 LLM 生成
    let systemPrompt = features.systemPrompt;
    if (!systemPrompt) {
      systemPrompt = await this.generateSystemPrompt(features);
    }

    // 3. 构建配置对象
    const config: AgentConfig = {
      agentType,
      description: features.description || `Auto-generated ${agentType} for ${features.taskType} tasks`,
      version: '1.0.0',
      author: 'NAC Auto-Generator',
      capabilities: {
        strengths: features.strengths || [
          `Handle ${features.taskType} related tasks`,
          'Provide specialized expertise',
          'Deliver high-quality results'
        ],
        weaknesses: features.weaknesses || [
          'May not be suitable for general tasks',
          'Requires specific domain knowledge'
        ],
        idealTasks: features.idealTasks || [
          features.taskType,
          `${features.taskType} development`,
          `${features.taskType} analysis`
        ],
        requiredSkills: features.requiredSkills || []
      },
      systemPrompt
    };

    return config;
  }

  /**
   * 使用 LLM 生成系统提示词
   */
  private async generateSystemPrompt(features: TaskFeatures): Promise<string> {
    const prompt = `请为以下 Agent 生成一个专业的系统提示词：

Agent 名称：${features.suggestedAgentName}
描述：${features.description}
擅长的能力：${features.strengths?.join(', ') || 'N/A'}
适合的任务：${features.idealTasks?.join(', ') || 'N/A'}

系统提示词应包含：
1. Agent 的角色定义和身份
2. 核心职责和工作原则
3. 输出格式和质量要求
4. 与其他 Agent 的协作方式

请直接输出系统提示词内容，不要有任何解释性文字。`;

    try {
      const response = await this.llm.complete(prompt);
      return response.trim();
    } catch (error) {
      console.error('[AgentGenerator] 生成系统提示词失败:', error);
      return this.getDefaultSystemPrompt(features);
    }
  }

  /**
   * 获取默认系统提示词
   */
  private getDefaultSystemPrompt(features: TaskFeatures): string {
    return `# ${features.suggestedAgentName}

You are a specialized AI agent designed to handle ${features.taskType} tasks.

## Your Role
You are an expert in ${features.taskType} with deep knowledge and practical experience.

## Your Responsibilities
- Provide accurate and professional solutions for ${features.taskType} tasks
- Follow best practices and industry standards
- Deliver high-quality, well-structured outputs

## Your Strengths
${features.strengths?.map(s => `- ${s}`).join('\n') || '- Specialized expertise'}

## Your Constraints
${features.weaknesses?.map(w => `- ${w}`).join('\n') || '- Focus on ${features.taskType} tasks only'}

## Output Format
Provide clear, structured, and actionable responses. Use markdown formatting when appropriate.

## Collaboration
Work effectively with other agents when tasks require multiple areas of expertise.`;
  }

  /**
   * 验证 Agent 配置
   */
  async validateAgentConfig(config: AgentConfig): Promise<ValidationResult> {
    const errors: string[] = [];

    // 1. 检查必需字段
    if (!config.agentType) errors.push('agentType is required');
    if (!config.description) errors.push('description is required');
    if (!config.systemPrompt) errors.push('systemPrompt is required');

    // 2. 检查命名规范
    if (config.agentType && !/^[A-Z][a-zA-Z0-9]*Agent$/.test(config.agentType)) {
      errors.push('agentType must follow PascalCase + "Agent" pattern');
    }

    // 3. 检查文件是否已存在
    const existingPath = join(this.agentsDir, `${config.agentType}.system.md`);
    if (existsSync(existingPath)) {
      errors.push(`Agent ${config.agentType} already exists at ${existingPath}`);
    }

    // 4. 验证系统提示词质量
    if (config.systemPrompt && config.systemPrompt.length < 100) {
      errors.push('systemPrompt is too short (minimum 100 characters)');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 保存 Agent 配置到文件
   */
  async saveAgentConfig(config: AgentConfig): Promise<string> {
    // 1. 验证配置
    const validation = await this.validateAgentConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid Agent config: ${validation.errors.join(', ')}`);
    }

    // 2. 确保目录存在
    await fs.mkdir(this.agentsDir, { recursive: true });

    // 3. 生成文件路径
    const fileName = `${config.agentType}.system.md`;
    const filePath = join(this.agentsDir, fileName);

    // 4. 格式化为 Markdown
    const content = this.formatAgentConfigAsMarkdown(config);

    // 5. 保存文件
    await fs.writeFile(filePath, content, 'utf-8');

    console.log(`[AgentGenerator] ✅ 新 Agent 配置已生成: ${filePath}`);

    return filePath;
  }

  /**
   * 将 Agent 配置格式化为 Markdown
   */
  private formatAgentConfigAsMarkdown(config: AgentConfig): string {
    const timestamp = new Date().toISOString();

    return `# ${config.agentType}

> **Version**: ${config.version}
> **Author**: ${config.author || 'NAC Auto-Generator'}
> **Generated**: ${timestamp}

## Description

${config.description}

## Capabilities

### Strengths

${config.capabilities.strengths.map(s => `- ${s}`).join('\n')}

### Weaknesses

${config.capabilities.weaknesses.map(w => `- ${w}`).join('\n')}

### Ideal Tasks

${config.capabilities.idealTasks.map(t => `- ${t}`).join('\n')}

### Required Skills

${config.capabilities.requiredSkills.length > 0
  ? config.capabilities.requiredSkills.map(s => `- ${s}`).join('\n')
  : '- None specified'}

## System Prompt

${config.systemPrompt}
`;
  }

  /**
   * 重新加载 AgentRegistry
   */
  async reloadAgentRegistry(): Promise<void> {
    try {
      await this.agentRegistry.reloadCustomAgents();
      const agentCount = this.agentRegistry.getRegisteredTypes().length;
      console.log(`[AgentGenerator] ✅ AgentRegistry 已重新加载，可用 Agent 数量: ${agentCount}`);
    } catch (error) {
      console.error('[AgentGenerator] 重新加载 AgentRegistry 失败:', error);
    }
  }

  /**
   * 完整的 Agent 生成流程
   */
  async generateAgent(intent: Intent): Promise<AgentGenerationRecord | null> {
    try {
      // 1. 分析任务特征
      console.log('[AgentGenerator] 🔍 分析任务特征...');
      const features = await this.analyzeTaskFeatures(intent);

      // 2. 检查是否需要新 Agent
      if (!features.requiresNewAgent) {
        console.log('[AgentGenerator] ℹ️  现有 Agent 可以处理此任务');
        return null;
      }

      console.log(`[AgentGenerator] 📝 检测到需要新 Agent 类型: ${features.suggestedAgentName}`);
      console.log(`[AgentGenerator]    - 任务类型: ${features.taskType}`);
      console.log(`[AgentGenerator]    - 所需技能: ${features.requiredSkills?.join(', ') || 'N/A'}`);

      // 3. 生成 Agent 配置
      console.log('[AgentGenerator] ⚙️  生成 Agent 配置...');
      const config = await this.generateAgentConfig(features);

      // 4. 保存配置
      console.log('[AgentGenerator] 💾 保存 Agent 配置...');
      const configPath = await this.saveAgentConfig(config);

      // 5. 重新加载 AgentRegistry
      console.log('[AgentGenerator] 🔄 重新加载 AgentRegistry...');
      await this.reloadAgentRegistry();

      // 6. 返回生成记录
      const record: AgentGenerationRecord = {
        agentType: config.agentType,
        taskId: intent.primaryGoal,
        configPath,
        timestamp: new Date()
      };

      console.log(`[AgentGenerator] ✅ Agent 生成完成: ${config.agentType}`);

      return record;
    } catch (error) {
      console.error('[AgentGenerator] ❌ Agent 生成失败:', error);
      return null;
    }
  }

  /**
   * 列出所有已生成的 Agent
   */
  async listGeneratedAgents(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.agentsDir);
      return files
        .filter(f => f.endsWith('.system.md'))
        .map(f => f.replace('.system.md', ''));
    } catch (error) {
      console.error('[AgentGenerator] 读取 Agent 目录失败:', error);
      return [];
    }
  }
}

export default AgentGenerator;
