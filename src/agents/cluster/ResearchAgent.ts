import { BaseAgent } from "../BaseAgent.js";
import { AgentStatus } from "../../state/models.js";
import type { LLMClient } from "../../llm/LLMClient.js";
import type { SkillManager } from "../../skills/SkillManager.js";
import type { RepoContextArtifact } from "../../orchestrator/AgentHandoff.js";

interface FileSample {
  path: string;
  content: string;
  size: number;
}

export class ResearchAgent extends BaseAgent {
  constructor(llm: LLMClient, skillManager: SkillManager) {
    super(llm, skillManager, "ResearchAgent");
  }

  async execute(task: any): Promise<any> {
    this.setStatus(AgentStatus.BUSY);

    try {
      const target = this.resolveTarget(task);
      const toolEvidence = await this.collectFileSamples(target);

      const response = await this.callLLM(
        `You are a ResearchAgent running on deepseek-v4-flash for low-cost parallel exploration.
Your role: use file tools to scan directories, read files, and produce grounded structured file summaries.

Task: ${task.description || task.name}
Target directory: ${target}

Tool evidence:
${JSON.stringify(toolEvidence, null, 2).substring(0, 6000)}

Produce a structured summary with:
1. Key files found and their purposes
2. Dependencies and imports
3. Notable patterns or potential issues`,
        { temperature: 0.2, maxTokens: 1500 }
      );

      this.tasksCompleted++;
      this.totalExecutionTime += task.estimatedDuration || 45;
      this.setStatus(AgentStatus.IDLE);

      const artifact: RepoContextArtifact = {
        repoPath: target,
        fileTree: toolEvidence.files.map(f => f.path).join("\n"),
        keyFiles: toolEvidence.files.map(f => ({
          path: f.path,
          purpose: this.inferPurpose(f.path, f.content),
          complexity: this.inferComplexity(f.content),
        })),
        dependencies: this.extractDependencies(toolEvidence.files),
        architectureNotes: response,
      };

      return {
        taskId: task.id,
        result: artifact,
        artifact,
        agentType: "ResearchAgent",
        outputArtifact: task.outputArtifact || "repo_context",
        toolEvidence: {
          target,
          listedDirectories: toolEvidence.listedDirectories,
          sampledFiles: toolEvidence.files.map(f => f.path),
          errors: toolEvidence.errors,
        },
      };
    } catch (error: any) {
      this.setStatus(AgentStatus.IDLE);
      throw error;
    }
  }

  private resolveTarget(task: any): string {
    if (typeof task.target === "string" && task.target.trim()) return task.target.trim();
    const text = `${task.name || ""} ${task.description || ""}`;
    const match = text.match(/\b(src|tests|config|docs|scripts|eval|web)\/?/i);
    return match ? `${match[1]}/` : ".";
  }

  private async collectFileSamples(target: string): Promise<{
    listedDirectories: string[];
    files: FileSample[];
    errors: string[];
  }> {
    const listedDirectories: string[] = [];
    const errors: string[] = [];
    const files: FileSample[] = [];
    const queue: Array<{ path: string; depth: number }> = [{ path: target === "all" ? "." : target, depth: 0 }];
    const candidates: string[] = [];
    const maxDepth = 2;
    const maxCandidates = 24;
    const maxSamples = 8;

    while (queue.length > 0 && candidates.length < maxCandidates) {
      const current = queue.shift()!;
      const listResult = await this.useSkill("file-ops", { operation: "list", path: current.path });
      if (!listResult.success) {
        errors.push(`${current.path}: ${listResult.error}`);
        continue;
      }

      listedDirectories.push(current.path);
      const items = listResult.result?.items || [];
      for (const item of items) {
        const childPath = `${current.path.replace(/[\\/]$/, "")}/${item.name}`.replace(/^\.\//, "");
        if (item.isDirectory && current.depth < maxDepth && !this.shouldSkipDirectory(item.name)) {
          queue.push({ path: childPath, depth: current.depth + 1 });
        } else if (item.isFile && this.isResearchableFile(item.name)) {
          candidates.push(childPath);
          if (candidates.length >= maxCandidates) break;
        }
      }
    }

    for (const path of candidates.slice(0, maxSamples)) {
      const readResult = await this.useSkill("file-ops", { operation: "read", path });
      if (!readResult.success) {
        errors.push(`${path}: ${readResult.error}`);
        continue;
      }
      const content = String(readResult.result?.content || "");
      files.push({
        path,
        content: content.substring(0, 2000),
        size: Number(readResult.result?.size || content.length),
      });
    }

    return { listedDirectories, files, errors };
  }

  private shouldSkipDirectory(name: string): boolean {
    return ["node_modules", ".git", "dist", "coverage", ".next", ".turbo"].includes(name);
  }

  private isResearchableFile(name: string): boolean {
    return /\.(ts|tsx|js|jsx|json|md|yml|yaml|toml|css|html)$/i.test(name);
  }

  private inferPurpose(path: string, content: string): string {
    if (/test|spec/i.test(path)) return "test coverage";
    if (/package\.json$/i.test(path)) return "package manifest";
    if (/config|\.config\./i.test(path)) return "configuration";
    if (/class\s+\w+Agent|extends BaseAgent/.test(content)) return "agent implementation";
    if (/export\s+(class|function|const|interface|type)/.test(content)) return "source module";
    return "project file";
  }

  private inferComplexity(content: string): "simple" | "moderate" | "complex" {
    const lines = content.split("\n").length;
    if (lines > 220) return "complex";
    if (lines > 80) return "moderate";
    return "simple";
  }

  private extractDependencies(files: FileSample[]): Record<string, string> {
    const dependencies: Record<string, string> = {};
    for (const file of files) {
      const imports = Array.from(file.content.matchAll(/from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g))
        .map(match => match[1] || match[2])
        .filter(Boolean);
      if (imports.length > 0) {
        dependencies[file.path] = imports.slice(0, 12).join(", ");
      }
    }
    return dependencies;
  }
}
