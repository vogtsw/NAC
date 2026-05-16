/**
 * repairToolCalls — Full DeepSeek tool call repair pipeline.
 * Runs: flatten → scavenge → repair → detect storm → record events.
 *
 * Called on every LLM response before the tool executor runs.
 */
import { flattenSchema } from "./flatten-schema.js";
import { scavengeReasoningContent } from "./scavenge-reasoning.js";
import { repairTruncatedJson } from "./repair-json.js";
import { detectToolStorm } from "./detect-storm.js";
import { recordRepairEvent, RepairEventType } from "./repair-log.js";

export interface RepairedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  source: "original" | "scavenged";
  repaired: boolean;
}

export interface RepairResult {
  calls: RepairedToolCall[];
  stormDetected: boolean;
  stormAction?: string;
  stormMessage?: string;
  repairSummary: {
    schemaFlattened: boolean;
    reasoningScavenged: number;
    jsonRepaired: number;
    totalRepaired: number;
  };
}

export function repairToolCalls(args: {
  rawToolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  reasoningContent?: string;
  toolSchemas?: Record<string, unknown>[];
}): RepairResult {
  const calls: RepairedToolCall[] = [];
  let jsonRepaired = 0;
  let reasoningScavenged = 0;

  // 1. Flatten schemas (pre-processing, done once)
  if (args.toolSchemas) {
    for (const schema of args.toolSchemas) {
      const result = flattenSchema(schema);
      if (result.changed) {
        recordRepairEvent(
          RepairEventType.SCHEMA_FLATTENED,
          `Depth: ${result.depthReduced}, Leaves: ${result.leavesReduced}`,
          true,
        );
      }
    }
  }

  // 2. Process raw tool calls from message.tool_calls
  if (args.rawToolCalls) {
    for (const tc of args.rawToolCalls) {
      // Repair truncated JSON arguments
      if (typeof tc.arguments === "string") {
        const repairResult = repairTruncatedJson(tc.arguments as string);
        if (repairResult.changed) {
          jsonRepaired++;
          recordRepairEvent(
            RepairEventType.JSON_REPAIRED,
            `Tool: ${tc.name}, Repairs: ${repairResult.repairCount}`,
            true,
          );
          try {
            tc.arguments = JSON.parse(repairResult.repaired);
          } catch {
            tc.arguments = {};
          }
        }
      }

      // Detect tool storm
      const stormResult = detectToolStorm(tc.name, tc.arguments as Record<string, unknown>);
      if (stormResult.isStorm) {
        recordRepairEvent(
          RepairEventType.STORM_DETECTED,
          `${tc.name} x${stormResult.callCount}, action: ${stormResult.action}`,
          stormResult.action === "reflect",
        );
        if (stormResult.action === "stop" || stormResult.action === "escalate") {
          if (stormResult.action === "escalate") {
            recordRepairEvent(RepairEventType.PRO_ESCALATED, `Storm on ${tc.name}`, false);
          }
          return {
            calls: [],
            stormDetected: true,
            stormAction: stormResult.action,
            stormMessage: stormResult.message,
            repairSummary: { schemaFlattened: false, reasoningScavenged, jsonRepaired, totalRepaired: jsonRepaired + reasoningScavenged },
          };
        }
      }

      calls.push({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments as Record<string, unknown>,
        source: "original",
        repaired: jsonRepaired > 0,
      });
    }
  }

  // 3. Scavenge reasoning_content for misplaced tool calls
  if (args.reasoningContent) {
    const scavengeResult = scavengeReasoningContent(args.reasoningContent);
    if (scavengeResult.count > 0) {
      reasoningScavenged = scavengeResult.count;
      recordRepairEvent(
        RepairEventType.REASONING_SCAVENGED,
        `Found ${scavengeResult.count} calls in reasoning_content`,
        true,
      );
      for (const sc of scavengeResult.found) {
        calls.push({
          id: `scavenged_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: sc.name,
          arguments: sc.arguments,
          source: "scavenged",
          repaired: true,
        });
      }
    }
  }

  return {
    calls,
    stormDetected: false,
    repairSummary: {
      schemaFlattened: false,
      reasoningScavenged,
      jsonRepaired,
      totalRepaired: jsonRepaired + reasoningScavenged,
    },
  };
}
