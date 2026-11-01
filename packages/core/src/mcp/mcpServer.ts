// Answers one MCP JSON-RPC 2.0 line (protocol 2025-06-18): initialize, ping, tools/list and tools/call.
import { formatError } from "../errors/index.js";
import { isRecord } from "../guards/index.js";
import type { ILogger } from "../ports/hostPorts.js";

export interface McpToolResult { content: { type: "text"; text: string }[]; isError?: boolean }

export interface McpTool { name: string; description: string; inputSchema: Record<string, unknown>; call(args: Record<string, unknown>): Promise<McpToolResult> }

export interface McpServerOptions { name: string; version: string; tools: readonly McpTool[]; instructions?: string; logger?: ILogger }

export interface McpServer { handle(line: string): Promise<string[]> }

const PROTOCOL_VERSION = "2025-06-18";
const LOG_MODULE = "mcp";

type RpcId = number | string | null;

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function reply(id: RpcId, body: { result: unknown } | { error: { code: number; message: string } }): string {
  return JSON.stringify({ jsonrpc: "2.0", id, ...body });
}

function errorReply(id: RpcId, code: number, message: string): string {
  return reply(id, { error: { code, message } });
}

function requestId(value: unknown): RpcId {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

/** Creates a server whose handle() turns one input line into the reply lines (none for notifications and blank lines). */
export function createMcpServer(options: McpServerOptions): McpServer {
  const toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]));

  function initialize(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: options.name, version: options.version },
    };
    if (options.instructions !== undefined) result["instructions"] = options.instructions;
    return result;
  }

  async function callTool(params: unknown): Promise<McpToolResult> {
    if (!isRecord(params)) throw new RpcError(-32602, "The tools/call params must be an object.");
    const name = params["name"];
    if (typeof name !== "string") throw new RpcError(-32602, "The tools/call params need a string name.");
    const tool = toolsByName.get(name);
    if (!tool) throw new RpcError(-32602, `Unknown tool: ${name}`);
    const args = params["arguments"];
    if (args !== undefined && !isRecord(args)) {
      throw new RpcError(-32602, "The tools/call arguments must be an object.");
    }
    try {
      return await tool.call(args ?? {});
    } catch (error) {
      await options.logger?.error(LOG_MODULE, error, { tool: name });
      return { content: [{ type: "text", text: formatError(error) }], isError: true };
    }
  }

  async function dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "initialize":
        return initialize();
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        };
      case "tools/call":
        return callTool(params);
      default:
        throw new RpcError(-32601, "Method not found");
    }
  }

  async function handle(line: string): Promise<string[]> {
    if (line.trim() === "") return [];
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return [errorReply(null, -32700, "Parse error")];
    }
    if (!isRecord(message)) return [errorReply(null, -32600, "Invalid Request")];
    const id = requestId(message["id"]);
    if (message["jsonrpc"] !== "2.0" || typeof message["method"] !== "string") {
      return [errorReply(id, -32600, "Invalid Request")];
    }
    const method = message["method"];
    if (!("id" in message)) return [];
    try {
      return [reply(id, { result: await dispatch(method, message["params"]) })];
    } catch (error) {
      if (error instanceof RpcError) return [errorReply(id, error.code, error.message)];
      await options.logger?.error(LOG_MODULE, error, { method });
      return [errorReply(id, -32603, "Internal error")];
    }
  }

  return { handle };
}
