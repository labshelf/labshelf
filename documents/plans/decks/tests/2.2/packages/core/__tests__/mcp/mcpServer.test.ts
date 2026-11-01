// Hidden tests of spec 2.2: JSON-RPC 2.0 message handling of the hand-rolled MCP server.
import { createMcpServer, type McpServer, type McpTool, type McpToolResult } from "../../src/mcp/mcpServer";
import type { ILogger } from "../../src/ports/hostPorts";

function makeLogger(): ILogger & { log: jest.Mock; error: jest.Mock } {
  return {
    log: jest.fn(async () => undefined),
    error: jest.fn(async () => undefined),
  };
}

const echoSchema = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
};

function echoTool(): McpTool & { call: jest.Mock } {
  return {
    name: "echo",
    description: "Echoes its text argument.",
    inputSchema: echoSchema,
    call: jest.fn(async (args: Record<string, unknown>): Promise<McpToolResult> => ({
      content: [{ type: "text", text: `echo:${String(args["text"])}` }],
    })),
  };
}

function throwingTool(): McpTool {
  return {
    name: "boom",
    description: "Always fails.",
    inputSchema: { type: "object", properties: {} },
    call: async () => {
      throw new Error("kaboom happened");
    },
  };
}

function setup(extra: Partial<Parameters<typeof createMcpServer>[0]> = {}) {
  const logger = makeLogger();
  const echo = echoTool();
  const server = createMcpServer({
    name: "labshelf-test",
    version: "9.8.7",
    tools: [echo, throwingTool()],
    logger,
    ...extra,
  });
  return { server, logger, echo };
}

async function ask(server: McpServer, message: unknown): Promise<Record<string, unknown>> {
  const lines = await server.handle(typeof message === "string" ? message : JSON.stringify(message));
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain("\n");
  return JSON.parse(lines[0] as string) as Record<string, unknown>;
}

function req(id: number | string, method: string, params?: unknown): Record<string, unknown> {
  const message: Record<string, unknown> = { jsonrpc: "2.0", id, method };
  if (params !== undefined) message["params"] = params;
  return message;
}

describe("lifecycle", () => {
  it("2.2a initialize returns protocol 2025-06-18, tools capability and serverInfo", async () => {
    const { server } = setup();
    const reply = await ask(
      server,
      req(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } }),
    );
    expect(reply["jsonrpc"]).toBe("2.0");
    expect(reply["id"]).toBe(1);
    expect(reply["error"]).toBeUndefined();
    const result = reply["result"] as Record<string, unknown>;
    expect(result["protocolVersion"]).toBe("2025-06-18");
    expect(result["capabilities"]).toEqual({ tools: { listChanged: false } });
    expect(result["serverInfo"]).toEqual({ name: "labshelf-test", version: "9.8.7" });
    expect(result["instructions"]).toBeUndefined();
  });

  it("2.2a initialize answers 2025-06-18 whatever protocolVersion the client asks for", async () => {
    const { server } = setup();
    const reply = await ask(server, req("init-a", "initialize", { protocolVersion: "2024-11-05" }));
    expect(reply["id"]).toBe("init-a");
    expect((reply["result"] as Record<string, unknown>)["protocolVersion"]).toBe("2025-06-18");
  });

  it("2.2a initialize accepts missing params", async () => {
    const { server } = setup();
    const reply = await ask(server, req(2, "initialize"));
    expect((reply["result"] as Record<string, unknown>)["protocolVersion"]).toBe("2025-06-18");
  });

  it("2.2a initialize includes instructions when given", async () => {
    const { server } = setup({ instructions: "Use the echo tool." });
    const reply = await ask(server, req(3, "initialize", {}));
    expect((reply["result"] as Record<string, unknown>)["instructions"]).toBe("Use the echo tool.");
  });

  it("2.2a notifications/initialized gives no reply", async () => {
    const { server } = setup();
    await ask(server, req(1, "initialize", {}));
    expect(await server.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))).toEqual([]);
  });

  it("2.2a any notification gives no reply, even an unknown one", async () => {
    const { server } = setup();
    expect(await server.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: {} }))).toEqual(
      [],
    );
    expect(await server.handle(JSON.stringify({ jsonrpc: "2.0", method: "no/such/method" }))).toEqual([]);
  });

  it("2.2a empty and whitespace-only lines give no reply", async () => {
    const { server } = setup();
    expect(await server.handle("")).toEqual([]);
    expect(await server.handle("   \t ")).toEqual([]);
  });

  it("2.2a ping gives {}", async () => {
    const { server } = setup();
    const reply = await ask(server, req(7, "ping"));
    expect(reply).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
  });

  it("2.2a requests before initialize are served", async () => {
    const { server } = setup();
    const reply = await ask(server, req("early", "tools/list"));
    expect(reply["id"]).toBe("early");
    expect(Array.isArray((reply["result"] as Record<string, unknown>)["tools"])).toBe(true);
  });
});

describe("tools", () => {
  it("2.2b tools/list lists the tools in order with their schemas", async () => {
    const { server } = setup();
    const reply = await ask(server, req(4, "tools/list", {}));
    expect(reply["id"]).toBe(4);
    expect(reply["result"]).toEqual({
      tools: [
        { name: "echo", description: "Echoes its text argument.", inputSchema: echoSchema },
        { name: "boom", description: "Always fails.", inputSchema: { type: "object", properties: {} } },
      ],
    });
  });

  it("2.2b tools/list ignores a cursor", async () => {
    const { server } = setup();
    const reply = await ask(server, req(5, "tools/list", { cursor: "page-2" }));
    const tools = (reply["result"] as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toEqual(["echo", "boom"]);
  });

  it("2.2b tools/call returns the tool result as returned", async () => {
    const { server, echo } = setup();
    const reply = await ask(server, req("c1", "tools/call", { name: "echo", arguments: { text: "hi" } }));
    expect(reply["id"]).toBe("c1");
    expect(reply["error"]).toBeUndefined();
    expect(reply["result"]).toEqual({ content: [{ type: "text", text: "echo:hi" }] });
    expect(echo.call).toHaveBeenCalledTimes(1);
    expect(echo.call.mock.calls[0][0]).toEqual({ text: "hi" });
  });

  it("2.2b tools/call passes an isError result through unchanged", async () => {
    const result: McpToolResult = { content: [{ type: "text", text: "nope" }], isError: true };
    const tool: McpTool = { name: "soft", description: "d", inputSchema: {}, call: async () => result };
    const server = createMcpServer({ name: "n", version: "1", tools: [tool], logger: makeLogger() });
    const reply = await ask(server, req(1, "tools/call", { name: "soft", arguments: {} }));
    expect(reply["result"]).toEqual(result);
  });

  it("2.2b tools/call without arguments calls the tool", async () => {
    const { server, echo } = setup();
    const reply = await ask(server, req(9, "tools/call", { name: "echo" }));
    expect(reply["error"]).toBeUndefined();
    expect(echo.call).toHaveBeenCalledTimes(1);
  });

  it("2.2b a throwing tool gives isError true with its message, logged at level error", async () => {
    const { server, logger } = setup();
    const reply = await ask(server, req(10, "tools/call", { name: "boom", arguments: {} }));
    expect(reply["id"]).toBe(10);
    expect(reply["error"]).toBeUndefined();
    expect(reply["result"]).toEqual({ content: [{ type: "text", text: "kaboom happened" }], isError: true });
    const errorLogs =
      logger.error.mock.calls.length + logger.log.mock.calls.filter((call: unknown[]) => call[0] === "error").length;
    expect(errorLogs).toBeGreaterThanOrEqual(1);
  });

  it("2.2b a rejecting tool gives isError true", async () => {
    const tool: McpTool = {
      name: "rejects",
      description: "d",
      inputSchema: {},
      call: () => Promise.reject(new Error("went wrong")),
    };
    const server = createMcpServer({ name: "n", version: "1", tools: [tool], logger: makeLogger() });
    const reply = await ask(server, req(11, "tools/call", { name: "rejects", arguments: {} }));
    expect(reply["result"]).toEqual({ content: [{ type: "text", text: "went wrong" }], isError: true });
  });
});

describe("errors", () => {
  function expectError(reply: Record<string, unknown>, id: unknown, code: number, message?: string): void {
    expect(reply["jsonrpc"]).toBe("2.0");
    expect(reply["id"]).toBe(id);
    expect(reply["result"]).toBeUndefined();
    const error = reply["error"] as { code: number; message: string };
    expect(error.code).toBe(code);
    expect(typeof error.message).toBe("string");
    expect(error.message.length).toBeGreaterThan(0);
    if (message !== undefined) expect(error.message).toBe(message);
  }

  it("2.2c text that is not JSON gives -32700 Parse error with id null", async () => {
    const { server } = setup();
    expectError(await ask(server, "{not json"), null, -32700, "Parse error");
    expectError(await ask(server, '{"jsonrpc":"2.0","id":1,'), null, -32700, "Parse error");
  });

  it("2.2c a batch array gives -32600 Invalid Request with id null", async () => {
    const { server } = setup();
    expectError(await ask(server, [req(1, "ping"), req(2, "ping")]), null, -32600, "Invalid Request");
    expectError(await ask(server, []), null, -32600, "Invalid Request");
  });

  it("2.2c JSON that is not an object gives -32600 with id null", async () => {
    const { server } = setup();
    expectError(await ask(server, "42"), null, -32600, "Invalid Request");
    expectError(await ask(server, '"ping"'), null, -32600, "Invalid Request");
    expectError(await ask(server, "null"), null, -32600, "Invalid Request");
  });

  it("2.2c a wrong jsonrpc version gives -32600 with the request id", async () => {
    const { server } = setup();
    expectError(await ask(server, { jsonrpc: "1.0", id: 5, method: "ping" }), 5, -32600, "Invalid Request");
    expectError(await ask(server, { id: "x", method: "ping" }), "x", -32600, "Invalid Request");
  });

  it("2.2c a missing or non-string method gives -32600 with the request id", async () => {
    const { server } = setup();
    expectError(await ask(server, { jsonrpc: "2.0", id: 6 }), 6, -32600, "Invalid Request");
    expectError(await ask(server, { jsonrpc: "2.0", id: "m", method: 12 }), "m", -32600, "Invalid Request");
  });

  it("2.2c an invalid request with an id that is not a number or string replies with id null", async () => {
    const { server } = setup();
    expectError(await ask(server, { jsonrpc: "2.0", id: { a: 1 }, method: 3 }), null, -32600, "Invalid Request");
    expectError(await ask(server, { jsonrpc: "1.0", id: [1], method: "ping" }), null, -32600, "Invalid Request");
  });

  it("2.2c an unknown method gives -32601 Method not found with the request id", async () => {
    const { server } = setup();
    expectError(await ask(server, req(8, "resources/list")), 8, -32601, "Method not found");
    expectError(await ask(server, req("s", "nope")), "s", -32601, "Method not found");
  });

  it("2.2c tools/call with bad params gives -32602 with the request id", async () => {
    const { server, echo } = setup();
    expectError(await ask(server, req(20, "tools/call")), 20, -32602);
    expectError(await ask(server, req(21, "tools/call", [])), 21, -32602);
    expectError(await ask(server, req(22, "tools/call", { arguments: {} })), 22, -32602);
    expectError(await ask(server, req(23, "tools/call", { name: 5 })), 23, -32602);
    expectError(await ask(server, req("a", "tools/call", { name: "echo", arguments: [1] })), "a", -32602);
    expectError(await ask(server, req("b", "tools/call", { name: "echo", arguments: "text" })), "b", -32602);
    expect(echo.call).not.toHaveBeenCalled();
  });

  it("2.2c tools/call with an unknown tool name gives -32602 Unknown tool", async () => {
    const { server } = setup();
    expectError(await ask(server, req(30, "tools/call", { name: "missing", arguments: {} })), 30, -32602, "Unknown tool: missing");
  });

  it("2.2c replies keep string and number ids unchanged", async () => {
    const { server } = setup();
    expect((await ask(server, req(0, "ping")))["id"]).toBe(0);
    expect((await ask(server, req("0", "ping")))["id"]).toBe("0");
    expect((await ask(server, req("abc-123", "nope")))["id"]).toBe("abc-123");
  });
});
