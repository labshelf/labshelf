// Runs one helper session: the native hello on stdio, then project, build and TeX messages on the loopback socket.
// CONTRACT: documents/contracts/helper.md#transport
import { spawn } from "node:child_process";
import * as os from "node:os";

import type { HelperHost } from "../index.js";
import { createManagedTinymist } from "../../typst/toolchain/node/index.js";
import { createSharedTexProvider } from "../../latex/toolchain/node/managed/index.js";
import type { HelperLogger } from "./log/index.js";
import { createBuildHandlers } from "./build/index.js";
import { createLspHandler, createLspServers } from "./lsp/index.js";
import { answerHello, createDispatcher, runHelperLoop, type HelloAnswer } from "./dispatch/index.js";
import { createLibraryProjects, createProjectHandlers } from "./projectHandlers/index.js";
import type { HelperSocket } from "./socket/index.js";
import { createFrameWriter } from "./stdio/index.js";
import { createTexInstallHandlers } from "./tex/index.js";

export interface HelperHostOptions {
  dataDir: string;
  logger: HelperLogger;
  helperVersion: string;
  /** The program running the loop, which `ready` names. */
  host: HelperHost;
  /** The process's command-line arguments; Chrome passes the caller's origin among them, Firefox the manifest path. */
  args: readonly string[];
  /** Runs after the hello opened the session. */
  afterHello?: () => void;
  input?: AsyncIterable<Uint8Array>;
  output?: NodeJS.WritableStream;
}

const callerOriginIn = (args: readonly string[]) => args.find((arg) => arg.startsWith("chrome-extension://"));

export async function runHelperHost(options: HelperHostOptions): Promise<void> {
  const { dataDir, logger, helperVersion, host } = options;
  // INVARIANT: stdout carries frames only, so nothing in the helper may call console.log.
  const send = createFrameWriter(options.output ?? process.stdout, logger);
  const tex = createSharedTexProvider({ env: process.env, platform: process.platform, homeDir: os.homedir(), logger, fetchImpl: fetch });
  const projects = createLibraryProjects({ logger });
  const tinymist = createManagedTinymist({ logger });
  const servers = createLspServers({ dataDir, logger, tinymist, projects, spawn });
  const builds = createBuildHandlers({ dataDir, logger, projects, tex, tinymist, servers });
  const dispatcher = createDispatcher(
    {
      ...createProjectHandlers({ dataDir, projects, forgetBuilds: builds.forget, edited: servers.edited, stopServer: servers.stop }),
      compile: builds.compile, cancel: builds.cancel, lsp: createLspHandler(servers),
      ...createTexInstallHandlers({ tex, helperVersion, host, logger }),
    },
    logger,
  );
  let socket: HelperSocket | undefined;
  const hello: HelloAnswer = async (message, reply) => {
    socket = await answerHello(message, reply, {
      helperVersion, host, texStatus: () => tex.status(), callerOrigin: callerOriginIn(options.args), logger, handle: dispatcher.handle,
    });
    if (socket) { options.afterHello?.(); }
    return socket !== undefined;
  };
  await logger.log("INFO", "helper", "Helper started", { version: helperVersion, host, dataDir });
  try {
    await runHelperLoop(options.input ?? process.stdin, hello, send, logger);
  } finally {
    builds.cancelAll();
    await socket?.close();
    await dispatcher.drain();
    await servers.stopAll();
    await projects.closeAll();
    await logger.log("INFO", "helper", "Input closed; helper exits");
  }
}
