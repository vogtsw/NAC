/**
 * repair-log — Records repair events for eval metrics and Pro escalation tracking.
 *
 * Metrics:
 * - toolRepair.count
 * - toolRepair.kind
 * - toolRepair.recovered
 * - toolStorm.suppressed
 * - repairTriggeredProEscalation
 */
export enum RepairEventType {
  SCHEMA_FLATTENED = "schema_flattened",
  REASONING_SCAVENGED = "reasoning_scavenged",
  JSON_REPAIRED = "json_repaired",
  STORM_DETECTED = "storm_detected",
  STORM_SUPPRESSED = "storm_suppressed",
  PRO_ESCALATED = "pro_escalated",
}

export interface RepairEvent {
  type: RepairEventType;
  timestamp: number;
  detail: string;
  recovered: boolean;
}

const repairEvents: RepairEvent[] = [];

export function recordRepairEvent(
  type: RepairEventType,
  detail: string,
  recovered = false,
): void {
  repairEvents.push({
    type,
    timestamp: Date.now(),
    detail: detail.substring(0, 500),
    recovered,
  });

  // Keep log bounded
  if (repairEvents.length > 1000) {
    repairEvents.splice(0, repairEvents.length - 1000);
  }
}

export interface RepairStats {
  total: number;
  byType: Record<string, number>;
  recovered: number;
  proEscalations: number;
  stormsSuppressed: number;
}

export function getRepairStats(): RepairStats {
  const byType: Record<string, number> = {};
  let recovered = 0;
  let proEscalations = 0;
  let stormsSuppressed = 0;

  for (const event of repairEvents) {
    byType[event.type] = (byType[event.type] || 0) + 1;
    if (event.recovered) recovered++;
    if (event.type === RepairEventType.PRO_ESCALATED) proEscalations++;
    if (event.type === RepairEventType.STORM_SUPPRESSED) stormsSuppressed++;
  }

  return {
    total: repairEvents.length,
    byType,
    recovered,
    proEscalations,
    stormsSuppressed,
  };
}

/** Clear repair log (for testing). */
export function clearRepairLog(): void {
  repairEvents.length = 0;
}
