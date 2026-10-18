// Installs Tinymist if needed, syncs the project's working copy and starts the server on it.
import * as path from "node:path";

import { PROTOCOL_VERSION } from "../../../index.js";
import type { HelperSend } from "../../dispatch/index.js";
import { ensureTinymistBinary } from "../ensureTinymistBinary.js";
import type { LspServersOptions } from "../lspServers.js";
import { tinymistEnv } from "../tinymistEnv.js";
import { startTinymistProcess, type TinymistProcess } from "../tinymistProcess.js";
import { MODULE, type Server } from "./server.js";

export interface SpawnServerRequest {
  options: LspServersOptions;
  projectId: string;
  requestId: string;
  send: HelperSend;
  /** Handles a message the server wrote; `reply` writes an answer back to it. */
  onMessage(rootDir: string, message: unknown, reply: (message: unknown) => void): void;
  onUnexpectedExit(): void;
}

export async function spawnServer({ options, projectId, requestId, send, onMessage, onUnexpectedExit }: SpawnServerRequest): Promise<Server> {
  const binary = await ensureTinymistBinary(options.tinymist, (message, fraction) => {
    send({ v: PROTOCOL_VERSION, id: requestId, type: "progress", phase: "installing-tinymist", message, ...(fraction !== undefined && { fraction }) });
  });
  const rootDir = path.join(options.dataDir, "projects", projectId, "src");
  await options.projects.syncWorkingCopy(projectId, rootDir);
  const child: TinymistProcess = startTinymistProcess({
    binary, cwd: rootDir, env: tinymistEnv(options.dataDir), projectId, spawn: options.spawn, logger: options.logger,
    onMessage: (message) => onMessage(rootDir, message, child.write),
    onUnexpectedExit,
  });
  await options.logger.log("INFO", MODULE, "Language server started", { projectId });
  return { process: child, rootDir, opened: new Set() };
}
