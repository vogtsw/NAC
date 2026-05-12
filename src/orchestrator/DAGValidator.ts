/**
 * DAG 验证器 - 确保 DAG 生成的任务质量
 *
 * 检查：
 * 1. 任务名称是否具体（非占位符）
 * 2. 任务描述是否完整
 * 3. 技能配置是否正确
 */

import { DAG } from './DAGBuilder.js';
import type { Task } from '../state/models.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('DAGValidator');

export interface ValidationResult {
  isValid: boolean;
  issues: string[];
  fixes: Map<string, Partial<Task>>;
}

export class DAGValidator {
  /**
   * 占位符列表 - 这些内容表明任务没有被正确生成
   */
  private readonly PLACEHOLDERS = [
    '步骤名称（使用中文）',
    '步骤名称',
    '步骤 1',
    '步骤 2',
    '步骤 3',
    'Step 1',
    'Step 2',
    'TODO',
    '待填写',
    'TBD',
    '任务名称',
    'Task name',
    '[插入',
    '步骤名称',
    '步骤（',
  ];

  /**
   * 验证 DAG 是否包含空洞/占位符任务
   */
  validate(dag: DAG, userIntent: string): ValidationResult {
    const issues: string[] = [];
    const fixes = new Map<string, Partial<Task>>();

    const tasks = dag.getAllTasks();

    for (const task of tasks) {
      // 检查1: 任务名称是否是占位符
      if (this.isPlaceholder(task.name)) {
        issues.push(`任务 ${task.id} 名称是占位符: "${task.name}"`);

        // 生成具体的任务名称
        const fixedName = this.generateConcreteName(task, userIntent);
        fixes.set(task.id, { name: fixedName });
      }

      // 检查2: 任务描述是否为空或太短
      if (!task.description || task.description.length < 20) {
        issues.push(`任务 ${task.id} 描述过短或为空`);

        // 生成具体的任务描述
        const fixedDescription = this.generateConcreteDescription(task, userIntent);
        fixes.set(task.id, {
          ...fixes.get(task.id),
          description: fixedDescription
        });
      }

      // 检查3: 任务描述是否包含占位符
      if (this.hasPlaceholderInDescription(task.description)) {
        issues.push(`任务 ${task.id} 描述包含占位符`);

        const fixedDescription = this.removePlaceholders(task.description);
        fixes.set(task.id, {
          ...fixes.get(task.id),
          description: fixedDescription
        });
      }

      // 检查4: 技能配置
      if (!task.requiredSkills || task.requiredSkills.length === 0) {
        const inferredSkills = this.inferRequiredSkills(task, userIntent);
        if (inferredSkills.length > 0) {
          fixes.set(task.id, {
            ...fixes.get(task.id),
            requiredSkills: inferredSkills
          });
        }
      }
    }

    const isValid = issues.length === 0;

    if (!isValid) {
      logger.warn({ issueCount: issues.length }, 'DAG validation failed');
    }

    return { isValid, issues, fixes };
  }

  /**
   * 检查文本是否是占位符
   */
  private isPlaceholder(text: string): boolean {
    if (!text) return true;

    return this.PLACEHOLDERS.some(placeholder =>
      text.includes(placeholder) || text === placeholder
    );
  }

  /**
   * 检查描述中是否包含占位符
   */
  private hasPlaceholderInDescription(description: string): boolean {
    if (!description) return true;

    return this.PLACEHOLDERS.some(placeholder =>
      description.includes(placeholder)
    );
  }

  /**
   * 生成具体的任务名称
   */
  private generateConcreteName(task: Task, userIntent: string): string {
    const agentType = task.agentType || 'Agent';

    // 从用户意图中提取关键信息
    const intentLower = userIntent.toLowerCase();

    if (intentLower.includes('github') && intentLower.includes('热搜')) {
      return `搜索GitHub热门AI项目`;
    }

    if (intentLower.includes('搜索') || intentLower.includes('search')) {
      return `执行网络搜索`;
    }

    if (intentLower.includes('分析') || intentLower.includes('analyze')) {
      return `分析数据内容`;
    }

    if (intentLower.includes('总结') || intentLower.includes('摘要')) {
      return `生成内容摘要`;
    }

    if (intentLower.includes('代码') || intentLower.includes('code')) {
      return `生成代码实现`;
    }

    // 基于Agent类型的默认名称
    const defaultNames: Record<string, string> = {
      'DataAgent': '数据收集与处理',
      'AnalysisAgent': '数据分析与评估',
      'AutomationAgent': '自动化任务执行',
      'CodeAgent': '代码开发',
      'GenericAgent': '通用任务处理',
    };

    return defaultNames[agentType] || '执行任务';
  }

  /**
   * 生成具体的任务描述
   */
  private generateConcreteDescription(task: Task, userIntent: string): string {
    const agentType = task.agentType || 'Agent';

    const intentLower = userIntent.toLowerCase();

    if (intentLower.includes('github') && intentLower.includes('前10')) {
      return `搜索GitHub上前10个最热门的AI相关项目，获取项目名称、star数、描述等关键信息`;
    }

    if (intentLower.includes('搜索')) {
      return `使用web-search技能搜索相关信息，收集完整的数据`;
    }

    if (intentLower.includes('总结') || intentLower.includes('摘要')) {
      return `对收集到的信息进行总结，生成简洁的摘要`;
    }

    // 基于Agent类型的默认描述
    const defaultDescriptions: Record<string, string> = {
      'DataAgent': `收集和处理数据，使用适当的技能获取信息`,
      'AnalysisAgent': `分析收集到的数据，提取关键信息和洞察`,
      'AutomationAgent': `执行自动化任务，确保所有步骤正确完成`,
      'CodeAgent': `编写高质量的代码实现`,
      'GenericAgent': `处理通用任务，提供清晰的输出`,
    };

    return defaultDescriptions[agentType] || `完成指定的任务`;
  }

  /**
   * 移除描述中的占位符
   */
  private removePlaceholders(description: string): string {
    let cleaned = description;

    for (const placeholder of this.PLACEHOLDERS) {
      cleaned = cleaned.replace(new RegExp(placeholder, 'g'), '');
    }

    // 清理多余的空白
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
  }

  /**
   * 推断需要的技能
   */
  private inferRequiredSkills(task: Task, userIntent: string): string[] {
    const skills: string[] = [];
    const intentLower = userIntent.toLowerCase();
    const descLower = (task.description || '').toLowerCase();

    // 搜索相关
    if (intentLower.includes('搜索') || intentLower.includes('search') ||
        intentLower.includes('github') || intentLower.includes('google')) {
      skills.push('web-search');
    }

    // 代码相关
    if (intentLower.includes('代码') || intentLower.includes('code') ||
        descLower.includes('代码') || descLower.includes('api')) {
      skills.push('code-generation');
    }

    // 数据分析
    if (intentLower.includes('分析') || intentLower.includes('analyze') ||
        intentLower.includes('数据')) {
      skills.push('data-analysis');
    }

    // 文件操作
    if (intentLower.includes('文件') || intentLower.includes('保存') ||
        intentLower.includes('write') || intentLower.includes('save')) {
      skills.push('file-ops');
    }

    // 终端命令
    if (intentLower.includes('执行') || intentLower.includes('run') ||
        intentLower.includes('命令')) {
      skills.push('terminal-exec');
    }

    return skills;
  }

  /**
   * 应用修复到 DAG
   */
  applyFixes(dag: DAG, fixes: Map<string, Partial<Task>>): DAG {
    // 创建新的 DAG
    const newDag = new DAG();

    for (const originalTask of dag.getAllTasks()) {
      const fix = fixes.get(originalTask.id);

      const updatedTask: Task = fix
        ? { ...originalTask, ...fix }
        : originalTask;

      newDag.addTask(updatedTask);
    }

    return newDag;
  }
}
