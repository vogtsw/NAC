/**
 * repairTruncatedJson — Fix malformed JSON from DeepSeek tool call arguments.
 * DeepSeek can produce truncated JSON when output is cut off mid-generation.
 * This attempts common repairs: closing brackets/braces, adding missing quotes.
 */
export interface JsonRepairResult {
  repaired: string;
  changed: boolean;
  repairCount: number;
}

export function repairTruncatedJson(jsonStr: string): JsonRepairResult {
  if (!jsonStr || jsonStr.trim().length === 0) {
    return { repaired: "{}", changed: true, repairCount: 1 };
  }

  let repaired = jsonStr.trim();
  let repairCount = 0;

  // Try parsing first — if it works, no repair needed
  try {
    JSON.parse(repaired);
    return { repaired, changed: false, repairCount: 0 };
  } catch {
    // Needs repair
  }

  // Repair 1: Close unbalanced braces
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  if (openBraces > closeBraces) {
    repaired += "}".repeat(openBraces - closeBraces);
    repairCount++;
  }

  // Repair 2: Close unbalanced brackets
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    repaired += "]".repeat(openBrackets - closeBrackets);
    repairCount++;
  }

  // Repair 3: Close unclosed strings (trailing quote)
  const inString = (repaired.match(/(?<!\\)"/g) || []).length % 2 !== 0;
  if (inString) {
    repaired += '"';
    repairCount++;
  }

  // Repair 4: Remove trailing comma before closing brace/bracket
  repaired = repaired.replace(/,(\s*[}\]])/g, "$1");

  // Repair 5: Fix single-quoted strings (common DeepSeek error)
  if (repaired.includes("'") && !repaired.includes('"')) {
    repaired = repaired.replace(/'/g, '"');
    repairCount++;
  }

  // Verify repair
  try {
    JSON.parse(repaired);
    return { repaired, changed: true, repairCount };
  } catch (e: any) {
    // Partial success: return best effort
    return {
      repaired: repaired || "{}",
      changed: true,
      repairCount,
    };
  }
}
