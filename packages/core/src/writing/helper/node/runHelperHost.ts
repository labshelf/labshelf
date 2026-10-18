// Runs the helper's message loop: wires the mirror, the build handlers and the TeX provider to the frames on stdio.
// CONTRACT: documents/contracts/helper.md#transport
import * as os from "node:os";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import type { HelperHost } from "../index.js";
import { createSharedTexProvider } from "../../latex/toolchain/node/managed/index.js";
import { createBuildHandlers } from "./build/index.js";
import { createDispatcher, createHelloHandler, runHelperLoop } from "./dispatch/index.js";
import { createProjectMirror } from "./mirror/index.js";
import { createFrameWriter } from "./stdio/index.js";
import { createTexInstallHandlers } from "./tex/index.js";

export interface HelperHostOptions {
  dataDir: string;
  logger: ILogger;
  helperVersion: string;
  /** The program running the loop, which `ready` names. */
  host: HelperHost;
  /** Runs after each `hello` is answered. */
  afterHello?: () => void;
  input?: AsyncIterable<Uint8Array>;
  output?: NodeJS.WritableStream;
}

export async function runHelperHost(options: HelperHostOptions): Promise<void> {
  const { dataDir, logger, helperVersion, host } = options;
  const send = createFrameWriter(options.output ?? process.stdout, logger);
  // INVARIANT: stdout carries frames only, so nothing in the helper may call console.log.
  const projectsRoot = path.join(dataDir, "projects");
  const tex = createSharedTexProvider({ env: process.env, platform: process.platform, homeDir: os.homedir(), logger, fetchImpl: fetch });
  const mirror = createProjectMirror({ projectsRoot, logger });
  const builds = createBuildHandlers({ projectsRoot, sourceDir: (projectId) => mirror.sourceDir(projectId), tex, logger });
  const dispatcher = createDispatcher(
    {
      // An install changes ready.tex, so hello reads the status on every request.
      hello: async (message, reply) => {
        await createHelloHandler({ helperVersion, host, tex: await tex.status() })(message, reply);
        options.afterHello?.();
      },
      sync: mirror.sync, file: mirror.file, delete: mirror.delete, build: builds.build, cancel: builds.cancel,
      ...createTexInstallHandlers({ tex, helperVersion, host, logger }),
    },
    send,
    logger,
  );
  await logger.log("INFO", "helper", "Helper started", { version: helperVersion, host, dataDir });
  await runHelperLoop(options.input ?? process.stdin, dispatcher, logger);
  await logger.log("INFO", "helper", "Input closed; helper exits");
}
