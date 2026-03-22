/**
 * Output Validator
 * Lightweight validation to ensure task outputs are usable and aligned to intent.
 */

export interface ValidationResult {
  isValid: boolean;
  score: number; // 0-100
  issues: string[];
  suggestions: string[];
  shouldRetry: boolean;
}

export interface OutputValidationConfig {
  minQualityScore?: number;
  minLength?: number;
}

const PLACEHOLDER_PATTERNS = [
  /TODO/gi,
  /TBD/gi,
  /\[.*?placeholder.*?\]/gi,
  /step\s*\d+\s*name/gi,
  /待补充|占位符|稍后完善/gi,
];

export class OutputValidator {
  private minQualityScore: number;
  private minLength: number;

  constructor(config: OutputValidationConfig = {}) {
    this.minQualityScore = config.minQualityScore ?? 60;
    this.minLength = config.minLength ?? 40;
  }

  async validate(
    userIntent: string,
    agentOutput: string,
    _context?: Record<string, any>
  ): Promise<ValidationResult> {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 100;

    const output = (agentOutput || '').trim();
    const intent = (userIntent || '').trim();

    if (!output) {
      return {
        isValid: false,
        score: 0,
        issues: ['输出为空'],
        suggestions: ['提供可执行的结果内容，而不是空响应'],
        shouldRetry: true,
      };
    }

    if (output.length < this.minLength) {
      score -= 25;
      issues.push(`输出过短（<${this.minLength}字符）`);
      suggestions.push('补充关键步骤、结论或可执行细节');
    }

    const hasPlaceholder = PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(output));
    if (hasPlaceholder) {
      score -= 35;
      issues.push('输出包含模板占位内容');
      suggestions.push('替换模板词并给出真实执行结果');
    }

    const overlapScore = this.calculateIntentOverlap(intent, output);
    if (overlapScore < 0.2) {
      score -= 25;
      issues.push('输出与用户意图相关性偏低');
      suggestions.push('围绕用户目标重写结果，减少泛化叙述');
    } else if (overlapScore < 0.4) {
      score -= 10;
      suggestions.push('可进一步增强与用户目标的关键词对齐');
    }

    if (!this.hasStructuredContent(output)) {
      score -= 10;
      suggestions.push('建议增加结构化内容（分点、步骤、代码块或表格）');
    }

    score = Math.max(0, Math.min(100, score));
    const isValid = score >= this.minQualityScore;

    return {
      isValid,
      score,
      issues,
      suggestions,
      shouldRetry: !isValid,
    };
  }

  private calculateIntentOverlap(intent: string, output: string): number {
    const intentTokens = this.tokenize(intent);
    if (intentTokens.length === 0) return 1;

    const outputSet = new Set(this.tokenize(output));
    const hit = intentTokens.filter((token) => outputSet.has(token)).length;
    return hit / intentTokens.length;
  }

  private tokenize(text: string): string[] {
    const normalized = text
      .toLowerCase()
      .replace(/[`~!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) return [];

    const terms = normalized.split(' ').filter((t) => t.length > 1);
    return Array.from(new Set(terms));
  }

  private hasStructuredContent(output: string): boolean {
    return (
      output.includes('\n- ') ||
      output.includes('\n1. ') ||
      output.includes('```') ||
      output.includes('|')
    );
  }
}
