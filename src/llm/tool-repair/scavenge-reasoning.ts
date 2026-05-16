/**
 * scavengeReasoningContent — Reclaim tool calls that DeepSeek mistakenly
 * placed inside reasoning_content instead of content/tool_calls.
 *
 * Known DeepSeek bug: function call JSON sometimes appears in the reasoning
 * stream rather than as proper tool_calls. This scavenger parses reasoning
 * text for JSON tool call patterns and extracts them.
 */
export interface ScavengedCall {
  name: string;
  arguments: Record<string, unknown>;
  confidence: number;
}

export interface ScavengeResult {
  found: ScavengedCall[];
  cleanedReasoning: string;
  count: number;
}

const TOOL_CALL_PATTERNS = [
  // Pattern: {"name": "tool_name", "arguments": {...}}
  /\{\s*"name"\s*:\s*"([a-zA-Z_][a-zA-Z0-9_-]*)"\s*,\s*"arguments"\s*:\s*(\{[^}]+\})\s*\}/g,
  // Pattern: tool_name({...})  — DeepSeek sometimes writes calls as pseudo-code
  /([a-zA-Z_][a-zA-Z0-9_-]*)\((\{[^}]*\})\)/g,
  // Pattern: ```json\n{"tool": "x"...}\n```
  /```json\s*\n?(\{[^`]*"tool"\s*:\s*"[^"]*"[^`]*\})\s*```/g,
];

export function scavengeReasoningContent(reasoningContent: string): ScavengeResult {
  if (!reasoningContent || reasoningContent.length < 10) {
    return { found: [], cleanedReasoning: reasoningContent || "", count: 0 };
  }

  const found: ScavengedCall[] = [];
  let cleaned = reasoningContent;

  for (const pattern of TOOL_CALL_PATTERNS) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(reasoningContent)) !== null) {
      try {
        if (pattern === TOOL_CALL_PATTERNS[0]) {
          // {"name": "x", "arguments": {...}}
          const name = match[1];
          const argsStr = match[2];
          const args = JSON.parse(argsStr);
          found.push({ name, arguments: args, confidence: 0.8 });
          cleaned = cleaned.replace(match[0], "");
        } else if (pattern === TOOL_CALL_PATTERNS[1]) {
          // tool_name({...})
          const name = match[1];
          const argsStr = match[2];
          const args = JSON.parse(argsStr);
          found.push({ name, arguments: args, confidence: 0.6 });
        } else if (pattern === TOOL_CALL_PATTERNS[2]) {
          // ```json ... ```
          const jsonStr = match[1];
          const parsed = JSON.parse(jsonStr);
          if (parsed.tool) {
            found.push({
              name: parsed.tool,
              arguments: parsed.args || parsed.arguments || {},
              confidence: 0.7,
            });
          }
          cleaned = cleaned.replace(match[0], "");
        }
      } catch {
        // Skip malformed matches
      }
    }
  }

  return { found, cleanedReasoning: cleaned.trim(), count: found.length };
}
