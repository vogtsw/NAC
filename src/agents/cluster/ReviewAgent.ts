import { BaseAgent } from "../BaseAgent.js";
import { AgentStatus } from "../../state/models.js";
import type { LLMClient } from "../../llm/LLMClient.js";
import type { SkillManager } from "../../skills/SkillManager.js";
import { getBlackboard } from "../../state/Blackboard.js";

export interface ReviewArtifact {
  approved: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  issues: Array<{ severity: string; description: string; suggestion: string }>;
  summary: string;
  evidenceReviewed: string[];
}

export class ReviewAgent extends BaseAgent {
  constructor(llm: LLMClient, skillManager: SkillManager) {
    super(llm, skillManager, "ReviewAgent");
  }

  async execute(task: any): Promise<any> {
    this.setStatus(AgentStatus.BUSY);

    try {
      // Read patch and test report artifacts from Blackboard when available
      const evidenceReviewed: string[] = [];
      let patchEvidence = task.patch || '';
      let testEvidence = task.testReport || '';

      if (task.patchArtifactId || task.runId) {
        try {
          const blackboard = getBlackboard();
          const artifacts = await blackboard.listArtifacts?.(task.runId || task.sessionId);
          if (artifacts) {
            for (const a of artifacts) {
              if (a.type === 'patch') {
                patchEvidence = typeof a.content === 'string' ? a.content : JSON.stringify(a.content);
                evidenceReviewed.push(`patch:${a.id}`);
              }
              if (a.type === 'test_report') {
                testEvidence = typeof a.content === 'string' ? a.content : JSON.stringify(a.content);
                evidenceReviewed.push(`test_report:${a.id}`);
              }
            }
          }
        } catch { /* Blackboard read is best-effort; fall back to task params */ }
      }

      const response = await this.callLLM(
        `You are the ReviewAgent for a DeepSeek cluster run, using Pro with max reasoning effort.
Your role: Final review of diffs, security analysis, edge case detection, and correctness verification.

Task: ${task.description || task.name}

PATCH EVIDENCE:
${String(patchEvidence).substring(0, 3000) || 'no patch provided'}

TEST EVIDENCE:
${String(testEvidence).substring(0, 2000) || 'no test report provided'}

Review for:
1. SECURITY: injection vectors, auth bypasses, data exposure
2. CORRECTNESS: logic errors, edge cases, race conditions
3. PERFORMANCE: resource leaks, algorithmic issues
4. STYLE: consistency with project conventions

Return JSON only with this shape:
{
  "approved": true or false,
  "riskLevel": "low|medium|high|critical",
  "issues": [
    { "severity": "critical|major|minor|info", "description": "...", "suggestion": "..." }
  ],
  "summary": "one paragraph summary of findings"
}`,
        { temperature: 0.2, maxTokens: 2500, responseFormat: 'json' }
      );

      const artifact: ReviewArtifact = this.parseReviewArtifact(response, evidenceReviewed);

      this.tasksCompleted++;
      this.totalExecutionTime += task.estimatedDuration || 60;
      this.setStatus(AgentStatus.IDLE);

      return {
        taskId: task.id,
        result: response,
        artifact,
        agentType: "ReviewAgent",
        outputArtifact: task.outputArtifact || "review",
      };
    } catch (error: any) {
      this.setStatus(AgentStatus.IDLE);
      throw error;
    }
  }

  private parseReviewArtifact(response: string, evidenceReviewed: string[]): ReviewArtifact {
    try {
      // Extract JSON from response
      const blockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const jsonStr = blockMatch ? blockMatch[1].trim() : response;
      const start = jsonStr.indexOf('{');
      const end = jsonStr.lastIndexOf('}');
      const clean = start >= 0 && end > start ? jsonStr.slice(start, end + 1) : jsonStr;
      const parsed = JSON.parse(clean);

      return {
        approved: Boolean(parsed.approved),
        riskLevel: ['low', 'medium', 'high', 'critical'].includes(parsed.riskLevel) ? parsed.riskLevel : 'medium',
        issues: Array.isArray(parsed.issues) ? parsed.issues.map((i: any) => ({
          severity: String(i.severity || 'minor'),
          description: String(i.description || ''),
          suggestion: String(i.suggestion || ''),
        })) : [],
        summary: String(parsed.summary || ''),
        evidenceReviewed: evidenceReviewed.length > 0 ? evidenceReviewed : ['task-params'],
      };
    } catch {
      return {
        approved: !response.toLowerCase().includes('critical') && !response.toLowerCase().includes('reject'),
        riskLevel: response.toLowerCase().includes('critical') ? 'high' : 'medium',
        issues: [],
        summary: response.substring(0, 500),
        evidenceReviewed: evidenceReviewed.length > 0 ? evidenceReviewed : ['task-params'],
      };
    }
  }
}
