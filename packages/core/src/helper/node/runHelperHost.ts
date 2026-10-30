// Runs one helper session: the native hello on stdio, then project, build and TeX messages on the loopback socket.
// CONTRACT: documents/contracts/helper.md#transport
import * as os from "node:os";
import * as path from "node:path";

import { formatError } from "../../errors/index.js";
import type { ILogger } from "../../ports/index.js";
import type { ICellRunner } from "../../qmd/compute/index.js";
import { PROTOCOL_VERSION, type HelperHost, type TexToolchain } from "../helperMessages.js";
import { TypstCompilerHost } from "../../typst/node/index.js";
import { createSharedTexProvider } from "../../latex/node/index.js";
import { bundledCellDrivers, createNodeCellRunner, createSharedPythonProvider, locateTool, type PythonProvider } from "../../qmd/compute/node/index.js";
import type { HelperLogger } from "./helperPrivacy.js";
import { createProjectHandlers, createTemplatePublishHandlers, createTexInstallHandlers } from "./projectHandlers.js";
import { createBuildHandlers } from "./helperBuild.js";
import { answerHello, createHelperAnswerer, runHelperLoop, type HelloAnswer, type HelperHandler } from "./helperHandlers.js";
import { createLibraryProjects } from "./helperProjects.js";
import { createFrameWriter, type HelperServer } from "./helperConnection.js";

const MODULE = "helper-python";

const CELL_MODULE = "helper-cells";

export interface CellHandlersOptions {
  runner: ICellRunner;
  /** The folder a cwd scope (a project id or `paper:<id>`) names, or undefined for one the helper does not know. */
  resolveCwd(scope: string): string | undefined;
  logger: ILogger;
}

/** Runs, cancels and restarts code cells for the page: runCell answers cellResult under the request id, cancelCell aborts a run by that id, and restartCell drops a note's session for a language and sends no reply. */
export function createCellHandlers(options: CellHandlersOptions): { runCell: HelperHandler; cancelCell: HelperHandler; restartCell: HelperHandler } {
  const { runner, resolveCwd, logger } = options;
  const running = new Map<string, AbortController>();

  // INVARIANT: the controller is registered before any await, because the dispatcher runs a `cancelCell` without waiting for this run.
  const runCell: HelperHandler = async (message, send) => {
    if (message.type !== "runCell") { throw new Error(`runCell handler received ${message.type}`); }
    const { id } = message;
    const cwd = resolveCwd(message.cwd);
    if (cwd === undefined) {
      void logger.log("WARN", CELL_MODULE, "Cell refused: unknown cwd scope", { id, scope: message.cwd });
      send({ v: PROTOCOL_VERSION, id, type: "error", code: "project-id", message: `cwd "${message.cwd}" is not a project that is open or a known paper` });
      return;
    }
    const controller = new AbortController();
    running.set(id, controller);
    try {
      const result = await runner.run({ code: message.code, language: message.language, noteKey: message.noteKey }, { cwd, signal: controller.signal, timeoutMs: message.timeoutMs });
      const { status, language, restarted, latex, text, error, durationMs } = result;
      send({
        v: PROTOCOL_VERSION, id, type: "cellResult", status, language, ...(restarted !== undefined && { restarted }),
        ...(latex !== undefined && { latex }), ...(text !== undefined && { text }), ...(error !== undefined && { error }), durationMs,
      });
    } finally {
      running.delete(id);
    }
  };

  const cancelCell: HelperHandler = (message) => {
    if (message.type !== "cancelCell") { throw new Error(`cancelCell handler received ${message.type}`); }
    const controller = running.get(message.requestId);
    void logger.log("INFO", CELL_MODULE, controller ? "Cancelling the running cell" : "Cancel with no running cell", { requestId: message.requestId });
    controller?.abort();
    return Promise.resolve();
  };

  // The dispatcher runs this one ahead of the queue, so a restart lands while a run is still pending.
  const restartCell: HelperHandler = async (message) => {
    if (message.type !== "restartCell") { throw new Error(`restartCell handler received ${message.type}`); }
    void logger.log("INFO", CELL_MODULE, "Restarting the note's cell session", { language: message.language });
    await runner.restart(message.noteKey, message.language);
  };

  return { runCell, cancelCell, restartCell };
}

export interface PythonHandlersOptions { python: PythonProvider; texStatus(): Promise<TexToolchain>; helperVersion: string; host: HelperHost; logger: ILogger }

export function createPythonHandlers(options: PythonHandlersOptions): { installPython: HelperHandler } {
  const { python, logger } = options;
  const installPython: HelperHandler = async (message, send) => {
    if (message.type !== "installPython") { throw new Error(`installPython handler received ${message.type}`); }
    const { id } = message;
    const onProgress = (_text: string, fraction?: number) =>
      send({ v: PROTOCOL_VERSION, id, type: "progress", phase: "python", message: "Installing Python", ...(fraction === undefined ? {} : { fraction }) });
    try {
      const status = await python.install(onProgress);
      send({
        v: PROTOCOL_VERSION, id, type: "ready", protocol: PROTOCOL_VERSION, helperVersion: options.helperVersion, host: options.host,
        tex: await options.texStatus(), python: status.state,
      });
    } catch (error) {
      await logger.error(MODULE, error, { step: "python", id });
      send({ v: PROTOCOL_VERSION, id, type: "error", code: "python-install-failed", message: formatError(error) });
    }
  };
  return { installPython };
}

/** The `--install-python` mode of the helper binary: installs Python through `provider` and returns the process exit code; failures are reported through `write`, never thrown. */
export async function runInstallPython(provider: PythonProvider, write: (message: string) => void): Promise<number> {
  try {
    const status = await provider.install((message) => write(message));
    if (status.state !== "installed") {
      write("Python install failed: the install finished without a usable Python");
      return 1;
    }
    write(`Python ${status.version} installed`);
    return 0;
  } catch (error) {
    write(`Python install failed: ${formatError(error)}`);
    return 1;
  }
}

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
  /** The program and arguments that start this helper's `--biber` mode; latexmk then runs biber's WASM build through it. Native biber when absent. */
  biber?: readonly string[];
  /** The managed Python the helper installs and reports; the shared one when absent. */
  python?: PythonProvider;
  /** Runs after the hello opened the session. */
  afterHello?: () => void;
  /** Runs once when the page's `hello` is refused for its protocol version; the host waits for it before exiting. */
  afterVersionRejected?: () => Promise<void>;
  input?: AsyncIterable<Uint8Array>;
  output?: NodeJS.WritableStream;
}

const callerOriginIn = (args: readonly string[]) => args.find((arg) => arg.startsWith("chrome-extension://"));

/** Starts `task` on the first `run` only, logs its failure through `onError`, and lets the caller await it. */
function runOnce(task: (() => Promise<void>) | undefined, onError: (error: unknown) => Promise<void> | void) {
  let started: Promise<void> | undefined;
  return {
    run: () => { started ??= (task?.() ?? Promise.resolve()).catch(onError); },
    settled: async () => { await started; },
  };
}

/** A project id resolves to the folder of the open project, `paper:<id>` to the temp folder; anything else is unknown. */
function resolveCellCwd(scope: string, rootOf: (projectId: string) => string | undefined): string | undefined {
  return scope.startsWith("paper:") ? os.tmpdir() : rootOf(scope);
}

export async function runHelperHost(options: HelperHostOptions): Promise<void> {
  const { dataDir, logger, helperVersion, host } = options;
  // INVARIANT: stdout carries frames only, so nothing in the helper may call console.log.
  const send = createFrameWriter(options.output ?? process.stdout, logger);
  const tex = createSharedTexProvider({ env: process.env, platform: process.platform, homeDir: os.homedir(), logger, fetchImpl: fetch });
  const python = options.python ?? createSharedPythonProvider({ env: process.env, platform: process.platform, homeDir: os.homedir(), logger, fetchImpl: fetch });
  const projects = createLibraryProjects({ logger });
  const packageDirs = { data: path.join(dataDir, "typst-packages", "local"), cache: path.join(dataDir, "typst-packages", "cache") };
  const openTypst = (withFontDownload: <T>(run: () => Promise<T>) => Promise<T>): TypstCompilerHost =>
    new TypstCompilerHost({ wasm: options.typstWasm, fontsDir: path.join(dataDir, "typst-fonts"), packageDirs, withFontDownload });
  // PLATFORM: latexmk runs `$biber` through cmd.exe on Windows, which the POSIX-quoted command does not suit, so Windows keeps native biber.
  const biber = process.platform === "win32" ? undefined : options.biber;
  const builds = createBuildHandlers({ dataDir, logger, projects, tex, openTypst, ...(biber && { biber }) });
  const publishing = createTemplatePublishHandlers({ dataDir, logger, fetch, build: {
    logger, tex, typst: openTypst((run) => run()), ...(biber && { biber }),
  } });
  const runner = createNodeCellRunner({
    python, drivers: bundledCellDrivers(), logger,
    locate: (language) => locateTool(language === "mathematica" ? "wolframscript" : "Rscript"),
  });
  const cells = createCellHandlers({ runner, resolveCwd: (scope) => resolveCellCwd(scope, projects.rootOf), logger });
  const dispatcher = createHelperAnswerer(
    {
      ...createProjectHandlers({ dataDir, projects, forgetBuilds: builds.forget }),
      compile: builds.compile, cancel: builds.cancel,
      ...publishing.handlers,
      ...createTexInstallHandlers({ tex, helperVersion, host, logger }),
      runCell: cells.runCell, cancelCell: cells.cancelCell, restartCell: cells.restartCell,
      ...createPythonHandlers({ python, texStatus: () => tex.status(), helperVersion, host, logger }),
    },
    logger,
  );
  let socket: HelperServer | undefined;
  const hello: HelloAnswer = async (message, reply) => {
    socket = await answerHello(message, reply, {
      helperVersion, host, texStatus: () => tex.status(), pythonStatus: () => python.status(), callerOrigin: callerOriginIn(options.args), logger, handle: dispatcher.handle,
    });
    if (socket) { options.afterHello?.(); }
    return socket !== undefined;
  };
  const rejection = runOnce(options.afterVersionRejected, (error) => logger.error("helper", error, { step: "afterVersionRejected" }));
  await logger.log("INFO", "helper", "Helper started", { version: helperVersion, host, dataDir });
  try {
    await runHelperLoop(options.input ?? process.stdin, hello, send, logger, rejection.run);
  } finally {
    builds.cancelAll();
    publishing.dispose();
    await socket?.close();
    await dispatcher.drain();
    await runner.dispose();
    await rejection.settled();
    await projects.closeAll();
    await logger.log("INFO", "helper", "Input closed; helper exits");
  }
}
