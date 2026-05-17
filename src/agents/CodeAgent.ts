/**
 * Code Agent
 * Specialized agent for code generation and modification tasks
 */

import { BaseAgent } from './BaseAgent.js';
import { AgentStatus, ExecutionContext } from '../state/models.js';
import type { PatchArtifact } from '../orchestrator/AgentHandoff.js';

/**
 * Code Agent - Handles code-related tasks
 */
export class CodeAgent extends BaseAgent {
  constructor(llm: any, skillManager: any) {
    super(llm, skillManager, 'CodeAgent');
  }

  async execute(task: any): Promise<any> {
    const startTime = Date.now();
    this.setStatus(AgentStatus.BUSY);

    try {
      if (task.outputArtifact === 'patch' || /patch|diff/i.test(`${task.name || ''} ${task.description || ''}`)) {
        return await this.executePatchGeneration(task);
      }

      if (task.type === 'generate' || task.description?.includes('生成') || task.description?.includes('实现')) {
        return await this.executeGeneration(task);
      }

      if (task.type === 'review' || task.description?.includes('审查')) {
        return await this.executeReview(task);
      }

      if (task.type === 'refactor' || task.description?.includes('重构')) {
        return await this.executeRefactor(task);
      }

      // Default to generation
      return await this.executeGeneration(task);
    } finally {
      this.setStatus(AgentStatus.IDLE);
      this.tasksCompleted++;
      this.totalExecutionTime += Date.now() - startTime;
    }
  }

  private async executeGeneration(task: any): Promise<any> {
    const { language = 'typescript', requirements, framework } = task;

    // Fallback to task description if requirements not provided
    const codeRequirements = requirements ?? task.description;
    const codeFramework = framework ?? '';

    const result = await this.useSkill(
      'code-generation',
      { language, requirements: codeRequirements, framework: codeFramework },
      {} as ExecutionContext
    );

    if (result.success && task.filePath) {
      await this.useSkill(
        'file-ops',
        { operation: 'write', path: task.filePath, content: result.result?.code || '' },
        {} as ExecutionContext
      );
    }

    // If skill failed, fallback to LLM
    if (!result.success) {
      const prompt = `请生成代码：

编程语言：${language}
${codeFramework ? `框架：${codeFramework}` : ''}
需求：
${codeRequirements}

请提供完整的代码实现。`;

      const response = await this.callLLM(prompt);

      return {
        taskId: task.id,
        success: true,
        result: { code: response },
      };
    }

    return result;
  }

  private async executePatchGeneration(task: any): Promise<any> {
    const prompt = `You are CodeAgent in a DeepSeek cluster run.
Produce a structured patch artifact for the requested code change.

Task: ${task.description || task.name}

Return JSON only with this shape:
{
  "files": [
    {
      "path": "relative/path.ts",
      "operation": "create|modify|delete",
      "diff": "unified diff or concise textual diff",
      "newContent": "full new content when available"
    }
  ],
  "summary": "what changed",
  "breakingChanges": false,
  "fileCount": 0,
  "linesAdded": 0,
  "linesRemoved": 0
}`;

    const response = await this.callLLM(prompt, {
      temperature: 0.2,
      maxTokens: 4000,
      responseFormat: 'json',
    });

    const artifact = this.parsePatchArtifact(response);

    // Validate: if no file changes parsed, mark as partial failure
    if (artifact.files.length === 0) {
      return {
        taskId: task.id,
        success: false,
        result: artifact,
        artifact,
        agentType: 'CodeAgent',
        outputArtifact: task.outputArtifact || 'patch',
        error: 'No file changes produced — LLM returned no parseable files',
      };
    }

    // Auto-apply patch unless explicitly disabled (e.g., dry-run)
    const shouldApply = task.applyPatch !== false && !task.dryRun;
    const patchMeta: any = {};
    if (shouldApply) {
      try {
        const applyResult = await this.useSkill('apply-patch', {
          files: artifact.files.map(file => ({
            path: file.path,
            operation: file.operation,
            content: file.newContent,
          })),
        }, {} as ExecutionContext);

        patchMeta.applied = applyResult.success === true;
        if (patchMeta.applied) {
          // Record git diff as evidence
          try {
            const gitDiff = await this.useSkill('git-ops', {
              operation: 'diff',
              path: '.',
            }, {} as ExecutionContext);
            patchMeta.diffStat = (gitDiff as any).result?.diffStat || (gitDiff as any).result?.diff || '';
          } catch { /* git evidence is best-effort */ }
        } else {
          patchMeta.applyError = applyResult.error || 'apply-patch returned failure';
        }
      } catch (err: any) {
        patchMeta.applyError = err.message || 'apply-patch exception';
      }
    }

    return {
      taskId: task.id,
      success: shouldApply ? (patchMeta.applied ?? true) : true,
      result: artifact,
      artifact: { ...artifact, ...patchMeta } as any,
      agentType: 'CodeAgent',
      outputArtifact: task.outputArtifact || 'patch',
      ...patchMeta,
      ...(patchMeta.applyError ? { error: patchMeta.applyError } : {}),
    };
  }

  private parsePatchArtifact(response: string): PatchArtifact {
    const raw = this.extractJsonObject(response);
    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    const files = Array.isArray(parsed?.files)
      ? parsed.files
        .filter((file: any) => file && typeof file.path === 'string')
        .map((file: any) => ({
          path: file.path,
          operation: this.normalizePatchOperation(file.operation),
          diff: String(file.diff || ''),
          newContent: String(file.newContent || ''),
        }))
      : [];

    return {
      files,
      summary: String(parsed?.summary || response.substring(0, 500)),
      breakingChanges: Boolean(parsed?.breakingChanges),
      fileCount: Number(parsed?.fileCount ?? files.length),
      linesAdded: Number(parsed?.linesAdded ?? this.countDiffLines(files, '+')),
      linesRemoved: Number(parsed?.linesRemoved ?? this.countDiffLines(files, '-')),
    };
  }

  private extractJsonObject(response: string): string {
    const block = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (block) return block[1].trim();
    const start = response.indexOf('{');
    const end = response.lastIndexOf('}');
    if (start >= 0 && end > start) return response.slice(start, end + 1);
    return response;
  }

  private normalizePatchOperation(operation: unknown): 'create' | 'modify' | 'delete' {
    return operation === 'create' || operation === 'delete' || operation === 'modify'
      ? operation
      : 'modify';
  }

  private countDiffLines(files: PatchArtifact['files'], prefix: '+' | '-'): number {
    return files.reduce((sum, file) => {
      const count = file.diff
        .split('\n')
        .filter(line => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`))
        .length;
      return sum + count;
    }, 0);
  }

  private async executeReview(task: any): Promise<any> {
    const { code, language = 'typescript' } = task;

    // Fallback to task description if code not provided
    const reviewCode = code ?? task.description;

    const result = await this.useSkill(
      'code-review',
      { code: reviewCode, language },
      {} as ExecutionContext
    );

    // If skill failed, fallback to LLM
    if (!result.success) {
      const prompt = `请审查以下代码：

语言：${language}
代码：
\`\`\`${language}
${reviewCode}
\`\`\`

请提供详细的审查意见和改进建议。`;

      const response = await this.callLLM(prompt, { temperature: 0.5 });

      return {
        taskId: task.id,
        success: true,
        result: { review: response },
      };
    }

    return result;
  }

  private async executeRefactor(task: any): Promise<any> {
    const { code, language = 'typescript', goals } = task;

    // Fallback to task description if code/goals not provided
    const refactorCode = code ?? task.description;
    const refactorGoals = goals ?? task.name;

    const prompt = `请重构以下${language}代码：

目标：${refactorGoals}

代码：
\`\`\`${language}
${refactorCode}
\`\`\`

请返回重构后的代码和改进说明。`;

    const response = await this.callLLM(prompt, { temperature: 0.3 });

    return {
      taskId: task.id,
      originalCode: refactorCode,
      refactoredCode: response,
    };
  }
}
