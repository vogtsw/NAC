/**
 * Document Agent - 专业的文档处理 Agent
 *
 * 功能：
 * - Word 文档 (.docx) 读写
 * - 内容分析和重写
 * - 格式转换
 * - 文档摘要生成
 */

import { BaseAgent } from '../../BaseAgent.js';
import { ExecutionContext } from '../../../state/models.js';
import { promises as fs } from 'fs';
import { resolve } from 'path';

/**
 * Document Agent 实现类
 */
export class DocumentAgent extends BaseAgent {
  constructor(llm: any, skillManager: any) {
    super(llm, skillManager, 'DocumentAgent');
  }

  /**
   * 执行文档处理任务
   */
  async execute(task: {
    description: string;
    input?: string;
    output?: string;
    options?: Record<string, any>;
  }): Promise<any> {
    this.setStatus('busy');
    const startTime = Date.now();

    try {
      this.logger.info({ task }, 'Executing document task');

      // 解析任务类型
      const taskType = this.parseTaskType(task.description);

      // 根据任务类型执行相应操作
      let result: any;

      switch (taskType) {
        case 'rewrite':
          result = await this.rewriteDocument(task);
          break;
        case 'analyze':
          result = await this.analyzeDocument(task);
          break;
        case 'convert':
          result = await this.convertDocument(task);
          break;
        case 'summarize':
          result = await this.summarizeDocument(task);
          break;
        default:
          // 使用 LLM 处理通用文档任务
          result = await this.handleGenericDocumentTask(task);
      }

      this.tasksCompleted++;
      this.totalExecutionTime += Date.now() - startTime;
      this.setStatus('idle');

      return {
        success: true,
        result,
        metadata: {
          taskType,
          duration: Date.now() - startTime,
        },
      };
    } catch (error: any) {
      this.setStatus('error');
      this.logger.error({ error: error.message }, 'Document task failed');

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 解析任务类型
   */
  private parseTaskType(description: string): string {
    const desc = description.toLowerCase();

    if (desc.includes('重写') || desc.includes('rewrite') || desc.includes('改写')) {
      return 'rewrite';
    }
    if (desc.includes('分析') || desc.includes('analyze')) {
      return 'analyze';
    }
    if (desc.includes('转换') || desc.includes('convert')) {
      return 'convert';
    }
    if (desc.includes('摘要') || desc.includes('summarize') || desc.includes('总结')) {
      return 'summarize';
    }

    return 'generic';
  }

  /**
   * 重写文档
   */
  private async rewriteDocument(task: {
    input?: string;
    output?: string;
    description: string;
    options?: Record<string, any>;
  }): Promise<any> {
    const inputPath = task.input || this.extractPath(task.description);
    const outputPath = task.output || this.generateOutputPath(inputPath, '_rewritten');

    this.logger.info({ inputPath, outputPath }, 'Rewriting document');

    // 1. 读取文档内容
    const content = await this.readDocument(inputPath);

    // 2. 使用 LLM 重写内容
    const rewritePrompt = this.buildRewritePrompt(task.description, content);
    const rewritten = await this.callLLMWithContext({
      userInput: rewritePrompt,
      includeSessionHistory: false,
      includeSkills: false,
    });

    // 3. 写入新文档
    await this.writeDocument(outputPath, rewritten);

    return {
      action: 'rewrite',
      input: inputPath,
      output: outputPath,
      originalLength: content.length,
      rewrittenLength: rewritten.length,
    };
  }

  /**
   * 分析文档
   */
  private async analyzeDocument(task: {
    input?: string;
    description: string;
  }): Promise<any> {
    const inputPath = task.input || this.extractPath(task.description);
    const content = await this.readDocument(inputPath);

    const analysisPrompt = `请分析以下文档内容，提供结构化的分析报告：

文档路径：${inputPath}

内容：
${content.substring(0, 10000)}

请提供：
1. 文档主题
2. 关键要点
3. 结构分析
4. 改进建议`;

    const analysis = await this.callLLMWithContext({
      userInput: analysisPrompt,
      includeSessionHistory: false,
    });

    return {
      action: 'analyze',
      path: inputPath,
      contentLength: content.length,
      analysis,
    };
  }

  /**
   * 转换文档格式
   */
  private async convertDocument(task: {
    input?: string;
    output?: string;
    description: string;
  }): Promise<any> {
    // 这里可以扩展支持不同格式转换
    // 目前作为示例，返回提示信息
    return {
      action: 'convert',
      message: '文档转换功能需要安装额外的库（如 mammoth、pdfkit 等）',
      supportedFormats: ['docx -> md', 'md -> pdf', 'txt -> docx'],
    };
  }

  /**
   * 生成文档摘要
   */
  private async summarizeDocument(task: {
    input?: string;
    description: string;
    options?: { maxLength?: number };
  }): Promise<any> {
    const inputPath = task.input || this.extractPath(task.description);
    const content = await this.readDocument(inputPath);

    const maxLength = task.options?.maxLength || 500;

    const summaryPrompt = `请为以下文档生成简洁的摘要（不超过 ${maxLength} 字）：

${content}

摘要：`;

    const summary = await this.callLLMWithContext({
      userInput: summaryPrompt,
      includeSessionHistory: false,
    });

    return {
      action: 'summarize',
      path: inputPath,
      originalLength: content.length,
      summary,
      summaryLength: summary.length,
    };
  }

  /**
   * 处理通用文档任务
   */
  private async handleGenericDocumentTask(task: {
    description: string;
    input?: string;
  }): Promise<any> {
    const prompt = `这是一个文档处理任务：${task.description}

${task.input ? `文档路径：${task.input}` : ''}

请使用你可用的技能来处理这个任务。如果需要读取文档内容，请先告诉我。`;

    const response = await this.callLLMWithContext({
      userInput: prompt,
      includeSessionHistory: true,
    });

    return {
      action: 'generic',
      response,
    };
  }

  /**
   * 读取文档内容
   */
  private async readDocument(filePath: string): Promise<string> {
    const resolvedPath = resolve(filePath);

    try {
      let content: string;

      if (filePath.endsWith('.docx')) {
        // 对于 .docx 文件，提示需要安装处理库
        throw new Error(
          '读取 .docx 文件需要安装 mammoth 库。运行: pnpm add mammoth'
        );
      } else if (filePath.endsWith('.txt') || filePath.endsWith('.md')) {
        content = await fs.readFile(resolvedPath, 'utf-8');
      } else {
        throw new Error(`Unsupported file format: ${filePath}`);
      }

      return content;
    } catch (error: any) {
      this.logger.error({ path: filePath, error: error.message }, 'Failed to read document');
      throw error;
    }
  }

  /**
   * 写入文档
   */
  private async writeDocument(filePath: string, content: string): Promise<void> {
    const resolvedPath = resolve(filePath);

    try {
      if (filePath.endsWith('.txt') || filePath.endsWith('.md')) {
        await fs.writeFile(resolvedPath, content, 'utf-8');
      } else if (filePath.endsWith('.docx')) {
        throw new Error(
          '写入 .docx 文件需要安装 docx 库。运行: pnpm add docx'
        );
      } else {
        await fs.writeFile(resolvedPath, content, 'utf-8');
      }

      this.logger.info({ path: filePath, size: content.length }, 'Document written');
    } catch (error: any) {
      this.logger.error({ path: filePath, error: error.message }, 'Failed to write document');
      throw error;
    }
  }

  /**
   * 从描述中提取文件路径
   */
  private extractPath(description: string): string {
    // 尝试匹配 Windows 路径
    const windowsPathMatch = description.match(/[A-Z]:\\[^:\s"']+/);
    if (windowsPathMatch) {
      return windowsPathMatch[0];
    }

    // 尝试匹配 Unix 路径
    const unixPathMatch = description.match(/\/[^\s"']+/);
    if (unixPathMatch) {
      return unixPathMatch[0];
    }

    throw new Error('无法从描述中提取文件路径，请明确提供 input 参数');
  }

  /**
   * 生成输出文件路径
   */
  private generateOutputPath(inputPath: string, suffix: string): string {
    const parts = inputPath.split('.');
    const ext = parts.pop();
    const base = parts.join('.');

    return `${base}${suffix}.${ext}`;
  }

  /**
   * 构建重写提示词
   */
  private buildRewritePrompt(instruction: string, content: string): string {
    return `任务：${instruction}

原始内容：
${content}

请根据任务要求重写内容，保持原意的同时改进表达。只返回重写后的内容，不要有额外说明。`;
  }
}

// 默认导出
export default DocumentAgent;
