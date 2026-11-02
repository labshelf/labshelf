// Hidden tests of spec 2.2: the newline-delimited stdio transport of the MCP server.
import { PassThrough } from "node:stream";
import { createMcpServer, type McpServer } from "../../../src/mcp/mcpServer";
import { runStdioServer } from "../../../src/mcp/node/stdioTransport";
import type { ILogger } from "../../../src/ports/hostPorts";

function makeLogger(): ILogger & { log: jest.Mock; error: jest.Mock } {
  return {
    log: jest.fn(async () => undefined),
    error: jest.fn(async () => undefined),
  };
}

function streams() {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer | string) => {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
  });
  return { input, output, text: () => Buffer.concat(chunks).toString("utf8") };
}

function realServer(logger: ILogger): McpServer {
  return createMcpServer({
    name: "stdio-test",
    version: "1.0.0",
    tools: [
      {
        name: "echo",
        description: "Echoes text.",
        inputSchema: { type: "object" },
        call: async (args) => ({ content: [{ type: "text", text: String(args["text"]) }] }),
      },
      {
        name: "boom",
        description: "Fails.",
        inputSchema: { type: "object" },
        call: async () => {
          throw new Error("tool failed");
        },
      },
    ],
    logger,
  });
}

function rpc(id: number | string, method: string, params?: unknown): string {
  const message: Record<string, unknown> = { jsonrpc: "2.0", id, method };
  if (params !== undefined) message["params"] = params;
  return JSON.stringify(message);
}

/** Splits the output into lines, checking it ends with \n and that every line is one JSON-RPC object. */
function jsonLines(text: string): Record<string, unknown>[] {
  if (text === "") return [];
  expect(text.endsWith("\n")).toBe(true);
  const lines = text.slice(0, -1).split("\n");
  return lines.map((line) => {
    expect(line).not.toBe("");
    expect(line.endsWith("\r")).toBe(false);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(typeof parsed).toBe("object");
    expect(parsed["jsonrpc"]).toBe("2.0");
    return parsed;
  });
}

/** A fake server that records the lines it gets and answers each with `[line]` after a delay. */
function recordingServer(delays: Record<string, number> = {}) {
  const events: string[] = [];
  const server: McpServer = {
    handle: async (line: string) => {
      events.push(`start:${line}`);
      await new Promise((resolve) => setTimeout(resolve, delays[line] ?? 0));
      events.push(`end:${line}`);
      return [JSON.stringify({ jsonrpc: "2.0", id: line, result: {} })];
    },
  };
  return { server, events };
}

describe("runStdioServer", () => {
  it("2.2d answers newline-delimited requests in order", async () => {
    const logger = makeLogger();
    const { input, output, text } = streams();
    const done = runStdioServer(realServer(logger), input, output, logger);
    input.write(`${rpc(1, "initialize", { protocolVersion: "2025-06-18" })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    input.write(`${rpc(2, "ping")}\n${rpc("three", "tools/list")}\n`);
    input.write(`${rpc(4, "tools/call", { name: "echo", arguments: { text: "hey" } })}\n`);
    input.end();
    await done;
    const replies = jsonLines(text());
    expect(replies.map((r) => r["id"])).toEqual([1, 2, "three", 4]);
    expect((replies[0]?.["result"] as Record<string, unknown>)["protocolVersion"]).toBe("2025-06-18");
    expect(replies[1]?.["result"]).toEqual({});
    expect(replies[3]?.["result"]).toEqual({ content: [{ type: "text", text: "hey" }] });
  });

  it("2.2d waits for each reply before handling the next line", async () => {
    const logger = makeLogger();
    const { input, output, text } = streams();
    const { server, events } = recordingServer({ a: 30, b: 0, c: 10 });
    const done = runStdioServer(server, input, output, logger);
    input.end("a\nb\nc\n");
    await done;
    expect(events).toEqual(["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
    expect(jsonLines(text()).map((r) => r["id"])).toEqual(["a", "b", "c"]);
  });

  it("2.2d drops a trailing \\r from \\r\\n-terminated lines", async () => {
    const logger = makeLogger();
    const { input, output, text } = streams();
    const { server, events } = recordingServer();
    const done = runStdioServer(server, input, output, logger);
    input.end("x\r\ny\r\n");
    await done;
    expect(events.filter((e) => e.startsWith("start:"))).toEqual(["start:x", "start:y"]);
    expect(jsonLines(text()).map((r) => r["id"])).toEqual(["x", "y"]);
  });

  it("2.2d answers \\r\\n-terminated JSON-RPC requests", async () => {
    const logger = makeLogger();
    const { input, output, text } = streams();
    const done = runStdioServer(realServer(logger), input, output, logger);
    input.end(`${rpc(1, "ping")}\r\n${rpc(2, "ping")}\r\n`);
    await done;
    expect(jsonLines(text())).toEqual([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: 2, result: {} },
    ]);
  });

  it("2.2d handles a final line without \\n at the end of input", async () => {
    const logger = makeLogger();
    const { input, output, text } = streams();
    const done = runStdioServer(realServer(logger), input, output, logger);
    input.write(`${rpc(1, "ping")}\n`);
    input.end(rpc(2, "ping"));
    await done;
    expect(jsonLines(text()).map((r) => r["id"])).toEqual([1, 2]);
  });

  it("2.2d joins a line split across chunks, including a split UTF-8 character", async () => {
    const logger = makeLogger();
    const { input, output, text } = streams();
    const done = runStdioServer(realServer(logger), input, output, logger);
    const bytes = Buffer.from(`${rpc(1, "tools/call", { name: "echo", arguments: { text: "café ✓" } })}\n`, "utf8");
    const accent = bytes.indexOf(Buffer.from("é", "utf8"));
    const parts = [bytes.subarray(0, 5), bytes.subarray(5, accent + 1), bytes.subarray(accent + 1)];
    for (const part of parts) {
      input.write(part);
      await new Promise((resolve) => setImmediate(resolve));
    }
    input.end();
    await done;
    const replies = jsonLines(text());
    expect(replies).toHaveLength(1);
    expect(replies[0]?.["result"]).toEqual({ content: [{ type: "text", text: "café ✓" }] });
  });

  it("2.2d writes only JSON lines: notifications, blank lines and tool errors add nothing else", async () => {
    const logger = makeLogger();
    const { input, output, text } = streams();
    const done = runStdioServer(realServer(logger), input, output, logger);
    input.write("\n   \n");
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    input.write("not json at all\n");
    input.write(`${rpc(5, "tools/call", { name: "boom", arguments: {} })}\n`);
    input.end();
    await done;
    const replies = jsonLines(text());
    expect(replies).toHaveLength(2);
    expect((replies[0]?.["error"] as { code: number }).code).toBe(-32700);
    expect(replies[0]?.["id"]).toBeNull();
    expect(replies[1]?.["id"]).toBe(5);
    expect(replies[1]?.["result"]).toEqual({ content: [{ type: "text", text: "tool failed" }], isError: true });
  });

  it("2.2d writes nothing to process.stdout", async () => {
    const logger = makeLogger();
    const { input, output } = streams();
    const spy = jest.spyOn(process.stdout, "write");
    try {
      const done = runStdioServer(realServer(logger), input, output, logger);
      input.end(`${rpc(1, "ping")}\n${rpc(2, "tools/call", { name: "boom", arguments: {} })}\n`);
      await done;
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("2.2d writes each reply line of a multi-line reply followed by \\n", async () => {
    const logger = makeLogger();
    const { input, output, text } = streams();
    const server: McpServer = {
      handle: async (line: string) =>
        line === ""
          ? []
          : [JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} })],
    };
    const done = runStdioServer(server, input, output, logger);
    input.end("go\n");
    await done;
    expect(text()).toBe(`${JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} })}\n`);
  });

  it("2.2d resolves at end of input after every reply is written", async () => {
    const logger = makeLogger();
    const { input, output, text } = streams();
    const { server } = recordingServer({ slow: 40 });
    let resolved = false;
    const done = runStdioServer(server, input, output, logger).then(() => {
      resolved = true;
    });
    input.write("slow\n");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(resolved).toBe(false);
    input.end();
    await done;
    expect(resolved).toBe(true);
    expect(jsonLines(text()).map((r) => r["id"])).toEqual(["slow"]);
  });

  it("2.2d resolves on an empty input with no output", async () => {
    const logger = makeLogger();
    const { input, output, text } = streams();
    const done = runStdioServer(realServer(logger), input, output, logger);
    input.end();
    await done;
    expect(text()).toBe("");
  });
});
