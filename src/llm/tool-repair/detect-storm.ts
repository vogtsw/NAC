/**
 * detectToolStorm — Detects repeated identical tool calls (tool storms)
 * and injects reflection or triggers escalation to Pro.
 *
 * A tool storm is defined as the same tool + same args called 3+ times
 * in a row without progress. This is a known DeepSeek failure mode.
 */
export interface StormDetection {
  isStorm: boolean;
  toolName: string;
  callCount: number;
  argsHash: string;
  action: "continue" | "reflect" | "escalate" | "stop";
  message: string;
}

const STORM_THRESHOLD = 3;
const STORM_WINDOW = 10; // last N calls to check

interface CallRecord {
  name: string;
  argsHash: string;
  timestamp: number;
}

const callHistory: CallRecord[] = [];

function hashArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, Object.keys(args || {}).sort());
}

export function detectToolStorm(
  toolName: string,
  args: Record<string, unknown>,
): StormDetection {
  const argsHash = hashArgs(args);
  const now = Date.now();

  // Record this call
  callHistory.push({ name: toolName, argsHash, timestamp: now });

  // Trim history to window
  while (callHistory.length > STORM_WINDOW) {
    callHistory.shift();
  }

  // Count consecutive identical calls in the window
  let consecutiveCount = 0;
  for (let i = callHistory.length - 1; i >= 0; i--) {
    if (callHistory[i].name === toolName && callHistory[i].argsHash === argsHash) {
      consecutiveCount++;
    } else {
      break;
    }
  }

  if (consecutiveCount < STORM_THRESHOLD) {
    return {
      isStorm: false,
      toolName,
      callCount: consecutiveCount,
      argsHash,
      action: "continue",
      message: "",
    };
  }

  // Determine action based on severity
  const action = consecutiveCount >= 5 ? "stop" : consecutiveCount >= 4 ? "escalate" : "reflect";

  const messages: Record<string, string> = {
    reflect: `You have called \`${toolName}\` with the same arguments ${consecutiveCount} times. The previous calls did not resolve the issue. Try a different approach or tool.`,
    escalate: `Tool storm detected: \`${toolName}\` called ${consecutiveCount} times with same args. Escalating to Pro with max reasoning.`,
    stop: `CRITICAL: Tool storm detected. \`${toolName}\` called ${consecutiveCount} times. Stopping to prevent infinite loop.`,
  };

  return {
    isStorm: true,
    toolName,
    callCount: consecutiveCount,
    argsHash,
    action,
    message: messages[action] || messages.reflect,
  };
}

/** Clear call history (for testing). */
export function clearStormHistory(): void {
  callHistory.length = 0;
}
