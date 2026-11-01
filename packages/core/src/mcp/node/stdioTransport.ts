// Serves an MCP server over newline-delimited stdio streams, writing nothing but JSON-RPC lines to the output.
import { StringDecoder } from "node:string_decoder";
import type { ILogger } from "../../ports/hostPorts.js";
import type { McpServer } from "../mcpServer.js";

const LOG_MODULE = "mcp/stdio";

function writeLine(output: NodeJS.WritableStream, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    output.write(`${line}\n`, (error) => (error ? reject(error) : resolve()));
  });
}

/** Reads input line by line, answers each line in order and resolves after input ends and every reply is written. */
export function runStdioServer(
  server: McpServer,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  logger: ILogger,
): Promise<void> {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let queue: Promise<void> = Promise.resolve();

  function enqueue(rawLine: string): void {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    queue = queue.then(async () => {
      try {
        for (const replyLine of await server.handle(line)) await writeLine(output, replyLine);
      } catch (error) {
        await logger.error(LOG_MODULE, error);
      }
    });
  }

  function take(text: string): void {
    pending += text;
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      enqueue(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  }

  return new Promise((resolve, reject) => {
    input.on("data", (chunk: Buffer | string) => {
      take(typeof chunk === "string" ? chunk : decoder.write(chunk));
    });
    input.on("end", () => {
      take(decoder.end());
      if (pending !== "") enqueue(pending);
      pending = "";
      queue.then(resolve, reject);
    });
    input.on("error", (error: Error) => {
      void logger.error(LOG_MODULE, error);
      queue.then(() => reject(error), reject);
    });
  });
}
