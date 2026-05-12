export { BashTool } from "./bash.js";
export { FileReadTool } from "./file-read.js";
export { FileWriteTool } from "./file-write.js";
export { FileEditTool } from "./file-edit.js";
export { GlobTool } from "./glob.js";
export { GrepTool } from "./grep.js";
export { TaskCompleteTool } from "./task-complete.js";
export { DelegateTool } from "./delegate.js";

import { BashTool } from "./bash.js";
import { FileReadTool } from "./file-read.js";
import { FileWriteTool } from "./file-write.js";
import { FileEditTool } from "./file-edit.js";
import { GlobTool } from "./glob.js";
import { GrepTool } from "./grep.js";
import { TaskCompleteTool } from "./task-complete.js";
import { DelegateTool } from "./delegate.js";
import type { Tool } from "../base.js";

/**
 * Get all built-in tools.
 */
export function getBuiltinTools(): Tool[] {
  return [
    new FileReadTool(),
    new GlobTool(),
    new GrepTool(),
    new FileEditTool(),
    new FileWriteTool(),
    new BashTool(),
    new DelegateTool(),
    new TaskCompleteTool(),
  ];
}
