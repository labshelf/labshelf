// Serves a writing project's decks to an MCP client over stdio (`labshelf mcp`).
import type { ILogger } from "@labshelf/core";
import { createDeckTools } from "@labshelf/core/decks/node";
import { createMcpServer } from "@labshelf/core/mcp";
import { runStdioServer } from "@labshelf/core/mcp/node";

import { findProject } from "./build/index.js";
import { UsageError } from "./usage.js";

export interface McpCommandOptions { libraryRoot: string; project?: string; cwd: string; input: NodeJS.ReadableStream; output: NodeJS.WritableStream; logger: ILogger; version: string }

const LOG_MODULE = "terminal.mcp";

/** @returns the exit code: 0 when the input ended, 2 when no project is found, 1 for any other failure; the output stays empty on failure */
export async function runMcp(options: McpCommandOptions): Promise<number> {
  const { logger } = options;
  try {
    const project = await findProject(options.libraryRoot, logger, options.project, options.cwd);
    const server = createMcpServer({
      name: "labshelf",
      version: options.version,
      tools: createDeckTools(project, { logger }),
      instructions: "Call deck_rules before writing a deck.",
      logger,
    });
    await runStdioServer(server, options.input, options.output, logger);
    return 0;
  } catch (error) {
    await logger.error(LOG_MODULE, error);
    return error instanceof UsageError ? 2 : 1;
  }
}
