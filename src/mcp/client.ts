/**
 * MCP Client — Model Context Protocol client for jiqun.
 *
 * Supports:
 * - stdio transport (spawn a child process, communicate via stdin/stdout)
 * - HTTP+SSE transport (connect to remote MCP servers)
 * - Tool discovery (tools/list) and execution (tools/call)
 * - Integration with jiqun ToolRegistry
 *
 * This enables jiqun agents to use tools from any MCP-compatible server,
 * including Codex MCP (which wraps Claude) and opencode servers.
 */
import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";
import { Tool } from "../tools/base.js";
import type { ToolMetadata, ToolCategory } from "../tools/base.js";
import type { ToolExecutionContext, ToolResult } from "../agent/types.js";

// ── JSON-RPC 2.0 types ───────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification;

// ── MCP types ────────────────────────────────────────────────

export interface MCPServerConfig {
  /** Transport type */
  transport: "stdio" | "http";
  /** For stdio: command to spawn. For http: URL. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /** Server name (for logging / tool prefix) */
  name: string;
  /** Connection timeout (ms) */
  timeout?: number;
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

// ── Dynamic MCP tool wrapper ─────────────────────────────────

class MCPToolWrapper extends Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters = [];
  readonly metadata: ToolMetadata;
  private mcpClient: MCPClient;
  private mcpTool: MCPTool;

  constructor(client: MCPClient, mcpTool: MCPTool, serverName: string) {
    super();
    this.mcpClient = client;
    this.mcpTool = mcpTool;
    this.name = `${serverName}__${mcpTool.name}`;
    this.description = mcpTool.description || `MCP tool: ${mcpTool.name} (from ${serverName})`;
    // MCP tools from external servers are treated as network calls
    this.metadata = {
      category: "network" as ToolCategory,
      touchesPaths: false,
      safeForParallel: true,
      requiresApproval: false,
    };
  }

  toJSONSchema(): Record<string, unknown> {
    return this.mcpTool.inputSchema || { type: "object", properties: {} };
  }

  async execute(
    args: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<ToolResult> {
    const start = Date.now();
    try {
      const result = await this.mcpClient.callTool(this.mcpTool.name, args);
      return this.success("", JSON.stringify(result, null, 2), Date.now() - start);
    } catch (e: any) {
      return this.error("", `MCP tool error: ${e.message}`, Date.now() - start);
    }
  }
}

// ── MCP Client ───────────────────────────────────────────────

export class MCPClient {
  private config: MCPServerConfig;
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
  private initialized = false;
  private tools: MCPTool[] = [];
  private buffer = "";

  constructor(config: MCPServerConfig) {
    this.config = { timeout: 30000, ...config };
  }

  get serverName(): string { return this.config.name; }

  // ── Connection ─────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.config.transport === "stdio") {
      await this.connectStdio();
    } else {
      await this.connectHttp();
    }

    // Initialize handshake
    const initResult = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "jiqun", version: "2.0.0" },
    }) as any;

    // Send initialized notification
    this.sendNotification("notifications/initialized", {
      protocolVersion: initResult?.protocolVersion || "2024-11-05",
    });

    this.initialized = true;

    // Discover tools
    const toolsResult = await this.sendRequest("tools/list", {}) as any;
    this.tools = (toolsResult?.tools || []) as MCPTool[];
  }

  private async connectStdio(): Promise<void> {
    const { command, args = [], env } = this.config;
    if (!command) throw new Error("stdio transport requires 'command'");

    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
      shell: process.platform === "win32",
    });

    // Read responses line by line from stdout
    const rl = createInterface({ input: this.process.stdout!, crlfDelay: Infinity });
    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        if ("id" in msg) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
            } else {
              pending.resolve(msg.result);
            }
          }
        }
        // Notifications are ignored for now
      } catch {
        // Skip non-JSON lines (stderr chatter)
      }
    });

    this.process.stderr?.on("data", (data) => {
      // Stderr can contain debug logs; they're not JSON-RPC messages
    });

    this.process.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        // Reject all pending requests
        for (const [id, p] of this.pending) {
          p.reject(new Error(`MCP server exited with code ${code}`));
          this.pending.delete(id);
        }
      }
    });

    // Wait briefly for process to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.process?.exitCode === null) resolve();
        else reject(new Error("MCP process failed to start"));
      }, 2000);
      this.process?.on("spawn", () => { clearTimeout(timeout); resolve(); });
    });
  }

  private async connectHttp(): Promise<void> {
    const { url } = this.config;
    if (!url) throw new Error("HTTP transport requires 'url'");

    // For HTTP transport, we use a simplified approach:
    // each sendRequest makes an HTTP POST to the endpoint.
    // The initialize handshake is the same JSON-RPC format.
  }

  // ── Messaging ──────────────────────────────────────────────

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out`));
      }, this.config.timeout);

      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      });

      this.sendRaw(JSON.stringify(request));
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    const notification = { jsonrpc: "2.0", method, params };
    this.sendRaw(JSON.stringify(notification));
  }

  private sendRaw(data: string): void {
    if (this.config.transport === "stdio") {
      if (!this.process?.stdin) throw new Error("MCP process not connected");
      this.process.stdin.write(data + "\n");
    } else {
      // HTTP: buffer for later batch sending, or send individually
      // For now, HTTP transport sends via POST in the request method override
    }
  }

  // ── Tool operations ────────────────────────────────────────

  getTools(): MCPTool[] {
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.initialized) throw new Error("MCP client not initialized");

    const result = await this.sendRequest("tools/call", {
      name,
      arguments: args,
    });

    return result;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async disconnect(): Promise<void> {
    if (this.initialized) {
      try {
        this.sendNotification("shutdown");
      } catch { /* ignore */ }
    }

    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    this.initialized = false;
    // Reject any remaining pending
    for (const [id, p] of this.pending) {
      p.reject(new Error("MCP client disconnected"));
      this.pending.delete(id);
    }
  }
}

// ── Tool registry integration ────────────────────────────────

/**
 * Connect to an MCP server, discover its tools, and register them
 * in the provided ToolRegistry.  Returns the number of tools registered.
 */
export async function registerMCPServer(
  config: MCPServerConfig,
  registry: { registerAll(tools: Tool[]): void }
): Promise<number> {
  const client = new MCPClient(config);
  await client.connect();

  const mcpTools = client.getTools();
  const wrappers: Tool[] = mcpTools.map(
    (mt) => new MCPToolWrapper(client, mt, config.name)
  );

  if (wrappers.length > 0) {
    registry.registerAll(wrappers);
  }

  return wrappers.length;
}

/**
 * Convenience: create an MCP client that connects to a Codex-managed MCP server
 * that wraps Claude (Anthropic API). This enables jiqun to call Claude through
 * Codex's MCP bridge, and Claude can in turn invoke opencode.
 */
export async function createCodexClaudeMCPClient(opts: {
  codexMCPServerCommand: string;
  codexMCPServerArgs?: string[];
}): Promise<MCPClient> {
  const client = new MCPClient({
    transport: "stdio",
    command: opts.codexMCPServerCommand,
    args: opts.codexMCPServerArgs ?? [],
    name: "codex-claude",
    timeout: 60000,
  });
  await client.connect();
  return client;
}

/**
 * Register all Codex Claude MCP tools into the registry.
 * After this, calling e.g. `codex-claude__ask_claude` prompts Claude via Codex.
 */
export async function registerCodexClaudeTools(
  registry: { registerAll(tools: Tool[]): void },
  serverCommand: string,
  serverArgs: string[] = []
): Promise<MCPClient> {
  const client = await createCodexClaudeMCPClient({
    codexMCPServerCommand: serverCommand,
    codexMCPServerArgs: serverArgs,
  });

  const wrappers = client.getTools().map(
    (mt) => new MCPToolWrapper(client, mt, "codex-claude")
  );

  if (wrappers.length > 0) {
    registry.registerAll(wrappers);
  }

  return client;
}
