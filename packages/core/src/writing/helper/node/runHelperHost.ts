// Runs one helper session: the native hello on stdio, then project, build and TeX messages on the loopback socket.
// CONTRACT: documents/contracts/helper.md#transport
import * as os from "node:os";
import * as path from "node:path";

import type { HelperHost } from "../index.js";
import { TypstCompilerHost } from "../../typst/node/index.js";
import { createSharedTexProvider } from "../../latex/toolchain/node/managed/index.js";
import type { HelperLogger } from "./log/index.js";
import { createBuildHandlers } from "./build/index.js";
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
  /** The typst.ts compiler's WASM, which each composition root locates in its own bundle. */
  typstWasm(): Promise<Uint8Array>;
  /** Runs after the hello opened the session. */
  afterHello?: () => void;
  /** Runs once when the page's `hello` is refused for its protocol version; the host waits for it before exiting. */
  afterVersionRejected?: () => Promise<void>;
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
  const packageDirs = { data: path.join(dataDir, "typst-packages", "local"), cache: path.join(dataDir, "typst-packages", "cache") };
  const openTypst = (withFontDownload: <T>(run: () => Promise<T>) => Promise<T>): TypstCompilerHost =>
    new TypstCompilerHost({ wasm: options.typstWasm, fontsDir: path.join(dataDir, "typst-fonts"), packageDirs, withFontDownload });
  const builds = createBuildHandlers({ dataDir, logger, projects, tex, openTypst });
  const dispatcher = createDispatcher(
    {
      ...createProjectHandlers({ dataDir, projects, forgetBuilds: builds.forget }),
      compile: builds.compile, cancel: builds.cancel,
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
  let versionRejected: Promise<void> | undefined;
  const onVersionRejected = () => {
    versionRejected ??= (options.afterVersionRejected?.() ?? Promise.resolve()).catch((error: unknown) => logger.error("helper", error, { step: "afterVersionRejected" }));
  };
  await logger.log("INFO", "helper", "Helper started", { version: helperVersion, host, dataDir });
  try {
    await runHelperLoop(options.input ?? process.stdin, hello, send, logger, onVersionRejected);
  } finally {
    builds.cancelAll();
    await socket?.close();
    await dispatcher.drain();
    await versionRejected;
    await projects.closeAll();
    await logger.log("INFO", "helper", "Input closed; helper exits");
  }
}
