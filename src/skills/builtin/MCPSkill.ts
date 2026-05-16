/**
 * MCPSkill
 * MCP (Model Context Protocol) bridge: list servers, call tools, manage connections.
 */
import { Skill, SkillCategory, SkillContext, SkillResult } from "../types.js";
import { getLogger } from "../../monitoring/logger.js";
import { MCPClient } from "../../mcp/client.js";

const logger = getLogger("MCPSkill");

const serverRegistry = new Map<string, { client: MCPClient; config: any }>();

export const MCPSkill: Skill = {
  name: "mcp",
  description: "MCP bridge: list_servers, call_tool, connect_server, disconnect_server",
  category: SkillCategory.AUTOMATION,
  version: "1.0.0",
  enabled: true,
  builtin: true,
  parameters: {
    required: ["operation"],
    optional: ["serverName", "toolName", "toolArgs", "command", "args", "url"],
  },

  async execute(_context: SkillContext, params: any): Promise<SkillResult> {
    try {
      let result: any;
      switch (params.operation) {
        case "list_servers":
          result = listMCPServers();
          break;
        case "connect_server":
          result = await connectMCPServer(params);
          break;
        case "disconnect_server":
          result = await disconnectMCPServer(params);
          break;
        case "call_tool":
          result = await callMCPTool(params);
          break;
        default:
          return { success: false, error: `Unknown MCP operation: ${params.operation}`, result: null };
      }
      return { success: true, result };
    } catch (error: any) {
      return { success: false, error: error.message, result: null };
    }
  },

  validate(params: any): boolean {
    return !!params.operation;
  },
};

function listMCPServers() {
  const servers: Array<{ name: string; transport: string; tools: string[]; connected: boolean }> = [];
  for (const [name, entry] of serverRegistry) {
    servers.push({
      name,
      transport: entry.config.transport || "stdio",
      tools: entry.client.getTools().map((t: any) => t.name),
      connected: true,
    });
  }
  return { servers, total: servers.length };
}

async function connectMCPServer(params: any) {
  const { serverName, command, args = [], url, transport = "stdio" } = params;
  if (!serverName) throw new Error("serverName required");
  if (serverRegistry.has(serverName)) throw new Error(`Server already connected: ${serverName}`);

  const config: any = { transport, name: serverName };
  if (transport === "stdio") {
    if (!command) throw new Error("command required for stdio transport");
    config.command = command;
    config.args = args;
  } else {
    if (!url) throw new Error("url required for http transport");
    config.url = url;
  }

  const client = new MCPClient(config);
  await client.connect();
  serverRegistry.set(serverName, { client, config });
  logger.info({ serverName, toolCount: client.getTools().length }, "MCP server connected");
  return { serverName, tools: client.getTools(), connected: true };
}

async function disconnectMCPServer(params: any) {
  const { serverName } = params;
  if (!serverName) throw new Error("serverName required");
  const entry = serverRegistry.get(serverName);
  if (!entry) throw new Error(`Server not found: ${serverName}`);
  await entry.client.disconnect();
  serverRegistry.delete(serverName);
  return { serverName, disconnected: true };
}

async function callMCPTool(params: any) {
  const { serverName, toolName, toolArgs = {} } = params;
  if (!serverName || !toolName) throw new Error("serverName and toolName required");
  const entry = serverRegistry.get(serverName);
  if (!entry) throw new Error(`Server not connected: ${serverName}. Use connect_server first.`);
  const result = await entry.client.callTool(toolName, toolArgs);
  return { serverName, toolName, result };
}
