// Runs one helper session: the native hello on stdio, then project, build and TeX messages on the loopback socket.
// CONTRACT: documents/contracts/helper.md#transport
import { spawn } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";

import { formatError } from "../../errors/index.js";
import type { ILogger } from "../../ports/index.js";
import type { ICellRunner } from "../../qmd/compute/index.js";
import { MAX_PRINT_HTML_BYTES, MAX_SOCKET_MESSAGE_BYTES, PROTOCOL_VERSION, type HelperHost, type HelperPrintFailure, type TexToolchain } from "../helperMessages.js";
import { parseDeckSize, type DeckSize } from "../../decks/index.js";
import { createSharedChromiumProvider, findSystemChromium, printDeckPdf } from "../../decks/node/index.js";
import { TypstCompilerHost } from "../../typst/node/index.js";
import { createSharedTexProvider, downloadVerified, resolveSharedToolsDir, runCancellable } from "../../latex/node/index.js";
import { createManagedPix2texProvider, createPix2texRunner, type Pix2texProvider, type Pix2texRunner } from "../../equations/node/index.js";
import { bundledCellDrivers, createNodeCellRunner, createSharedPythonProvider, locateTool, type NodeCellRunnerOptions, type PythonProvider } from "../../qmd/compute/node/index.js";
import type { HelperLogger } from "./helperPrivacy.js";
import { createProjectHandlers, createTemplatePublishHandlers, createTexInstallHandlers } from "./projectHandlers.js";
import { createBuildHandlers } from "./helperBuild.js";
import { answerHello, createHelperAnswerer, HELPER_CAPABILITIES, runHelperLoop, type HelloAnswer, type HelperHandler, type HelperSend } from "./helperHandlers.js";
import { createLibraryProjects } from "./helperProjects.js";
import { createFrameWriter, type HelperServer } from "./helperConnection.js";
import { createOcrHandlers } from "./ocrHandlers.js";

const MODULE = "helper-python";

const CELL_MODULE = "helper-cells";

// Answers the socket's deck print messages: printPdf prints the payload HTML through Chromium and replies pdfPrinted (the PDF
// as payload) or printFailed; cancelPrint aborts a run by its request id.
// CONTRACT: documents/contracts/helper.md#messages
export interface PrintHandlerDeps { print: (html: string, size: DeckSize, signal: AbortSignal) => Promise<Uint8Array | { error: "noChromium" | "failed"; message: string }> }

const SILENT: ILogger = { log: async () => undefined, error: async () => undefined };
const NO_CHROMIUM = "No Chromium-based browser was found. Install Chrome or Chromium to export PDFs.";

/** Prints through the system Chromium, else the managed one when installed; the Helper never installs it. The page size comes from the HTML's @page rule. */
async function printWithChromium(html: string, _size: DeckSize, signal: AbortSignal): ReturnType<PrintHandlerDeps["print"]> {
  const managed = async () => {
    // status() only reads the tools folder, so the provider downloads nothing and logs nothing worth keeping.
    const status = await createSharedChromiumProvider({ env: process.env, platform: process.platform, homeDir: os.homedir(), logger: SILENT, fetchImpl: fetch }).status();
    return status.installed ? status.executable : undefined;
  };
  const chromium = await findSystemChromium(managed);
  if (!chromium) { return { error: "noChromium", message: NO_CHROMIUM }; }
  try {
    return await printDeckPdf(html, { chromium: chromium.path, signal });
  } catch (error) {
    return { error: "failed", message: formatError(error) };
  }
}

const failed = (send: HelperSend, id: string, reason: HelperPrintFailure, message: string) => send({ v: PROTOCOL_VERSION, id, type: "printFailed", reason, message });

/** printPdf and cancelPrint over one map of running prints; `deps.print` replaces the Chromium printer. */
export function createPrintHandlers(deps?: Partial<PrintHandlerDeps>): Record<"printPdf" | "cancelPrint", HelperHandler> {
  const print = deps?.print ?? printWithChromium;
  const running = new Map<string, AbortController>();
  // INVARIANT: the controller is registered before any await, because the dispatcher runs a cancelPrint without waiting for this run.
  const printPdf: HelperHandler = async (message, send, payload) => {
    if (message.type !== "printPdf") { throw new Error(`printPdf handler received ${message.type}`); }
    const { id } = message;
    const html = payload ?? new Uint8Array();
    if (html.length > MAX_PRINT_HTML_BYTES) { failed(send, id, "limit", "The deck is too large to print through LabShelf Helper."); return; }
    const size = parseDeckSize(message.size);
    if (!size) { failed(send, id, "failed", `"${message.size}" is not a deck size.`); return; }
    const controller = new AbortController();
    running.set(id, controller);
    try {
      const result = await print(new TextDecoder().decode(html), size, controller.signal).catch((error: unknown) => ({ error: "failed" as const, message: formatError(error) }));
      if (controller.signal.aborted) { failed(send, id, "failed", "Cancelled."); return; }
      if (!(result instanceof Uint8Array)) { failed(send, id, result.error, result.message); return; }
      if (result.length > MAX_SOCKET_MESSAGE_BYTES) { failed(send, id, "limit", "The PDF is too large to send through LabShelf Helper."); return; }
      send({ v: PROTOCOL_VERSION, id, type: "pdfPrinted", bytes: result.length }, result);
    } finally {
      running.delete(id);
    }
  };
  const cancelPrint: HelperHandler = (message) => {
    if (message.type !== "cancelPrint") { throw new Error(`cancelPrint handler received ${message.type}`); }
    running.get(message.requestId)?.abort();
    return Promise.resolve();
  };
  return { printPdf, cancelPrint };
}

export interface CellHandlersOptions {
  runner: ICellRunner;
  /** The folder a cwd scope (a project id or `paper:<id>`) names, or undefined for one the helper does not know. */
  resolveCwd(scope: string): string | undefined;
  logger: ILogger;
}

/** Runs one code cell and answers cellResult under the request id. */
// INVARIANT: the controller is registered before any await, because the dispatcher runs a `cancelCell` without waiting for this run.
function createRunCell(options: CellHandlersOptions, running: Map<string, AbortController>): HelperHandler {
  const { runner, resolveCwd, logger } = options;
  return async (message, send) => {
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
      const result = await runner.run({ code: message.code, language: message.language, noteKey: message.noteKey, ...(message.params !== undefined && { params: message.params }), ...(message.preview === true && { preview: true }) }, { cwd, signal: controller.signal, timeoutMs: message.timeoutMs });
      const { status, language, restarted, latex, text, error, controls, plot, warnings, durationMs } = result;
      send({
        v: PROTOCOL_VERSION, id, type: "cellResult", status, language, ...(restarted !== undefined && { restarted }),
        ...(latex !== undefined && { latex }), ...(text !== undefined && { text }), ...(error !== undefined && { error }), ...(controls !== undefined && { controls }), ...(plot !== undefined && { plot }),
        ...(warnings !== undefined && warnings.length > 0 && { warnings: [...warnings] }), durationMs,
      });
    } finally {
      running.delete(id);
    }
  };
}

/** Aborts the run registered under the request id, if any. */
function createCancelCell(logger: ILogger, running: Map<string, AbortController>): HelperHandler {
  return (message) => {
    if (message.type !== "cancelCell") { throw new Error(`cancelCell handler received ${message.type}`); }
    const controller = running.get(message.requestId);
    void logger.log("INFO", CELL_MODULE, controller ? "Cancelling the running cell" : "Cancel with no running cell", { requestId: message.requestId });
    controller?.abort();
    return Promise.resolve();
  };
}

// The dispatcher runs this one ahead of the queue, so a restart lands while a run is still pending.
function createRestartCell(runner: ICellRunner, logger: ILogger): HelperHandler {
  return async (message) => {
    if (message.type !== "restartCell") { throw new Error(`restartCell handler received ${message.type}`); }
    void logger.log("INFO", CELL_MODULE, "Restarting the note's cell session", { language: message.language });
    await runner.restart(message.noteKey, message.language);
  };
}

// A throw becomes an error reply under the id in the dispatcher. The request carries no signal: nothing cancels a math request once sent.
function createEvalMath(options: CellHandlersOptions): HelperHandler {
  const { runner, resolveCwd, logger } = options;
  return async (message, send) => {
    if (message.type !== "evalMath") { throw new Error(`evalMath handler received ${message.type}`); }
    if (!runner.runMath) { throw new Error("This helper's cell runner does not run math."); }
    if (resolveCwd(message.cwd) === undefined) {
      void logger.log("WARN", CELL_MODULE, "Math refused: unknown cwd scope", { id: message.id, scope: message.cwd });
      send({ v: PROTOCOL_VERSION, id: message.id, type: "error", code: "project-id", message: `cwd "${message.cwd}" is not a project that is open or a known paper` });
      return;
    }
    const result = await runner.runMath({ noteKey: message.noteKey, op: message.op, tex: message.tex });
    send({ v: PROTOCOL_VERSION, id: message.id, type: "mathResult", result });
  };
}

/** Runs, cancels and restarts code cells for the page: runCell answers cellResult under the request id, cancelCell aborts a run by that id, restartCell drops a note's session for a language and sends no reply, and evalMath answers mathResult under the request id. */
export function createCellHandlers(options: CellHandlersOptions): { runCell: HelperHandler; cancelCell: HelperHandler; restartCell: HelperHandler; evalMath: HelperHandler } {
  const running = new Map<string, AbortController>();
  return {
    runCell: createRunCell(options, running),
    cancelCell: createCancelCell(options.logger, running),
    restartCell: createRestartCell(options.runner, options.logger),
    evalMath: createEvalMath(options),
  };
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
        tex: await options.texStatus(), python: status.state, capabilities: [...HELPER_CAPABILITIES],
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
  /** The cell driver scripts, which each composition root locates in its own bundle; beside this module when absent. */
  cellDrivers?: NodeCellRunnerOptions["drivers"];
  /** The pix2tex worker script and requirements folder, which the executable writes to disk; beside the equations module when absent. */
  pix2texFiles?: { workerScript: string; requirementsDir: string };
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

type LibraryProjects = ReturnType<typeof createLibraryProjects>;

/** The build handlers and the template publishing, which share one Typst compiler host factory and the optional native biber. */
function createBuildAndPublish(options: HelperHostOptions, projects: LibraryProjects, tex: ReturnType<typeof createSharedTexProvider>) {
  const { dataDir, logger } = options;
  const packageDirs = { data: path.join(dataDir, "typst-packages", "local"), cache: path.join(dataDir, "typst-packages", "cache") };
  const openTypst = (withFontDownload: <T>(run: () => Promise<T>) => Promise<T>): TypstCompilerHost =>
    new TypstCompilerHost({ wasm: options.typstWasm, fontsDir: path.join(dataDir, "typst-fonts"), packageDirs, withFontDownload });
  // PLATFORM: latexmk runs `$biber` through cmd.exe on Windows, which the POSIX-quoted command does not suit, so Windows keeps native biber.
  const biber = process.platform === "win32" ? undefined : options.biber;
  const builds = createBuildHandlers({ dataDir, logger, projects, tex, openTypst, ...(biber && { biber }) });
  const publishing = createTemplatePublishHandlers({ dataDir, logger, fetch, build: {
    logger, tex, typst: openTypst((run) => run()), ...(biber && { biber }),
  } });
  return { builds, publishing };
}

/** The cell runner over the located Python (else the managed one) and the located Wolfram and R tools, with the handlers that serve the page. */
function createCells(python: PythonProvider, projects: LibraryProjects, logger: HelperLogger, drivers: NodeCellRunnerOptions["drivers"] | undefined) {
  const runner = createNodeCellRunner({
    python, drivers: drivers ?? bundledCellDrivers(), logger,
    locate: (language) => locateTool(language === "python" ? "python" : language === "mathematica" ? "wolframscript" : "Rscript"),
  });
  const cells = createCellHandlers({ runner, resolveCwd: (scope) => resolveCellCwd(scope, projects.rootOf), logger });
  return { runner, cells };
}

const CAN_IMPORT_TIMEOUT_MS = 30_000;

/** The pix2tex runner and the managed provider over the helper's shared tools folder and `python`; the system Python is tried last and no setting names one. */
function createPix2tex(python: PythonProvider, logger: HelperLogger, files: HelperHostOptions["pix2texFiles"]): { runner: Pix2texRunner; provider: Pix2texProvider } {
  const env = process.env;
  const platform = process.platform;
  const provider = createManagedPix2texProvider({
    root: path.join(resolveSharedToolsDir(env, platform, os.homedir()), "pix2tex"), platform, arch: process.arch, python,
    run: runCancellable, download: (url, sha256, signal) => downloadVerified(url, sha256, fetch, signal), logger,
    ...(files && { requirementsDir: files.requirementsDir }),
  });
  const runner = createPix2texRunner({
    settingPython: () => undefined,
    managed: provider,
    locatePython: () => locateTool("python"),
    canImport: async (executable) => (await runCancellable(executable, ["-c", "import pix2tex"], os.tmpdir(), new AbortController().signal, { timeoutMs: CAN_IMPORT_TIMEOUT_MS })).code === 0,
    spawn: (command, args, workerEnv) => spawn(command, args, { env: workerEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }),
    ...(files && { workerScript: files.workerScript }),
    logger,
  });
  return { runner, provider };
}

export async function runHelperHost(options: HelperHostOptions): Promise<void> {
  const { dataDir, logger, helperVersion, host } = options;
  // INVARIANT: stdout carries frames only, so nothing in the helper may call console.log.
  const send = createFrameWriter(options.output ?? process.stdout, logger);
  const tex = createSharedTexProvider({ env: process.env, platform: process.platform, homeDir: os.homedir(), logger, fetchImpl: fetch });
  const python = options.python ?? createSharedPythonProvider({ env: process.env, platform: process.platform, homeDir: os.homedir(), logger, fetchImpl: fetch });
  const projects = createLibraryProjects({ logger });
  const { builds, publishing } = createBuildAndPublish(options, projects, tex);
  const { runner, cells } = createCells(python, projects, logger, options.cellDrivers);
  const pix2tex = createPix2tex(python, logger, options.pix2texFiles);
  const dispatcher = createHelperAnswerer(
    {
      ...createProjectHandlers({ dataDir, projects, forgetBuilds: builds.forget }),
      compile: builds.compile, cancel: builds.cancel,
      ...publishing.handlers,
      ...createTexInstallHandlers({ tex, helperVersion, host, logger }),
      runCell: cells.runCell, cancelCell: cells.cancelCell, restartCell: cells.restartCell, evalMath: cells.evalMath,
      ...createPythonHandlers({ python, texStatus: () => tex.status(), helperVersion, host, logger }),
      ...createPrintHandlers(),
      ...createOcrHandlers({
        ...pix2tex,
        readyFields: async () => ({ helperVersion, host, tex: await tex.status(), python: (await python.status()).state }),
        logger,
      }),
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
    pix2tex.runner.dispose();
    await rejection.settled();
    await projects.closeAll();
    await logger.log("INFO", "helper", "Input closed; helper exits");
  }
}
