/**
 * flattenSchema — DeepSeek tool definition schema flattener.
 * DeepSeek can fail when schemas are too deep or too wide.
 * This reduces nesting and leaf count to keep tools callable.
 */
const MAX_DEPTH = 4;
const MAX_LEAVES = 30;

export interface FlattenedSchema {
  original: Record<string, unknown>;
  flattened: Record<string, unknown>;
  depthReduced: number;
  leavesReduced: number;
  changed: boolean;
}

export function flattenSchema(schema: Record<string, unknown>): FlattenedSchema {
  const depth = computeDepth(schema);
  const leaves = countLeaves(schema);
  let flattened = JSON.parse(JSON.stringify(schema));
  let depthReduced = 0;
  let leavesReduced = 0;

  // Reduce excessive depth by collapsing nested objects
  if (depth > MAX_DEPTH) {
    flattened = collapseDepth(flattened as any, MAX_DEPTH);
    depthReduced = depth - MAX_DEPTH;
  }

  // Reduce excessive leaves by pruning optional properties
  const props = (flattened as any)?.properties;
  if (props && typeof props === "object" && leaves > MAX_LEAVES) {
    const keys = Object.keys(props);
    const toRemove = keys.slice(MAX_LEAVES);
    for (const key of toRemove) {
      delete props[key];
    }
    leavesReduced = toRemove.length;
  }

  return {
    original: schema,
    flattened,
    depthReduced,
    leavesReduced,
    changed: depthReduced > 0 || leavesReduced > 0,
  };
}

function computeDepth(obj: unknown, depth = 0): number {
  if (!obj || typeof obj !== "object") return depth;
  if (Array.isArray(obj)) {
    return Math.max(0, ...obj.map(item => computeDepth(item, depth)));
  }
  const vals = Object.values(obj as Record<string, unknown>);
  if (vals.length === 0) return depth;
  return Math.max(...vals.map(v => computeDepth(v, depth + 1)));
}

function countLeaves(obj: unknown): number {
  if (!obj || typeof obj !== "object") return 1;
  if (Array.isArray(obj)) {
    return obj.reduce((sum, item) => sum + countLeaves(item), 0);
  }
  const properties = (obj as any)?.properties;
  if (properties && typeof properties === "object") {
    return Object.keys(properties).length;
  }
  return Object.keys(obj as object).length;
}

function collapseDepth(obj: Record<string, unknown>, maxDepth: number, depth = 0): any {
  if (depth >= maxDepth) {
    if (typeof obj === "object" && obj !== null) {
      return { _collapsed: true, _description: JSON.stringify(obj).substring(0, 200) };
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => collapseDepth(item as any, maxDepth, depth));
  }
  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = collapseDepth(val as any, maxDepth, depth + 1);
    }
    return result;
  }
  return obj;
}
