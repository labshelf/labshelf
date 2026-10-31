// The LaTeX helper client of a page: ILatexHelper and its session over a native port and a socket transport the app opens.
import { formatError } from "../errors/index.js";
import type { ILogger } from "../ports/index.js";
import { PROTOCOL_VERSION, type TemplatePublishEvent, type TemplatePublishRequest, type ToPageMessage } from "./helperMessages.js";
import type { CellLanguage, CellResult } from "../qmd/compute/index.js";
import type { HelperCellRequest, HelperCompileRequest, HelperChange, HelperState, ILatexHelper, OnHelperProgress } from "./helperPaths.js";
import {
  deriveHelperStatus, runHandshake, type HelperConnection, type HelperPortFactory, type HelperSocketOpener, type RequestBody,
} from "./helperClientConnection.js";
import { createCompileStep, deriveProgress, UpdateTracker } from "./updateTracker.js";

export interface NativeHelperSessionDeps {
  logger: ILogger;
  extensionVersion: string;
  origin: string;
  connectNative: HelperPortFactory;
  openSocket: HelperSocketOpener;
}

interface Session { native: HelperConnection; socket: HelperConnection }

export class NativeHelperSession {
  status: HelperState | undefined;
  private session: Session | undefined;
  private generation = 0;
  private connecting: Promise<HelperState> | undefined;

  constructor(private readonly deps: NativeHelperSessionDeps, private readonly edits: UpdateTracker) {}

  private drop(reason: string | undefined, generation: number): void {
    if (generation !== this.generation) return;
    const dropped = this.session;
    this.session = undefined;
    this.status = undefined;
    dropped?.native.disconnect();
    dropped?.socket.disconnect();
    void this.deps.logger.log("INFO", "browser.helper", "LabShelf Helper connection closed", { reason });
  }

  disconnect(): void { this.drop("disconnected by the page", this.generation); this.generation++; }

  private resendStale(message: Extract<ToPageMessage, { type: "error" }>): void {
    const resend = message.code === "stale" && message.id !== undefined ? this.edits.resend(message.id) : undefined;
    if (!resend) {
      void this.deps.logger.log("WARN", "browser.helper", "LabShelf Helper reported an error no request was waiting for", { code: message.code, message: message.message });
      return;
    }
    void this.deps.logger.log("INFO", "browser.helper", "Resending the whole text after a stale edit", { projectId: resend.projectId, path: resend.path });
    try { this.session?.socket.post({ type: "edit", ...resend }); }
    catch (error) { void this.deps.logger.error("browser.helper", error, { operation: "resend", projectId: resend.projectId, path: resend.path }); }
  }

  // INVARIANT: overlapping requests share one handshake because open projects belong to one socket.
  connect(): Promise<HelperState> {
    this.connecting ??= this.open().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private async open(): Promise<HelperState> {
    const mine = ++this.generation;
    const previous = this.session;
    this.session = undefined;
    previous?.native.disconnect();
    previous?.socket.disconnect();
    const outcome = await runHandshake(this.deps, {
      onUnmatchedError: (message) => this.resendStale(message), onClose: (reason) => this.drop(reason, mine),
    });
    if (mine !== this.generation) {
      outcome.native?.disconnect(); outcome.socket?.disconnect();
      throw new Error("LabShelf Helper connection was cancelled");
    }
    this.edits.forgetAll();
    this.status = outcome.status;
    this.session = outcome.native && outcome.socket ? { native: outcome.native, socket: outcome.socket } : undefined;
    return this.status;
  }

  async readySocket(): Promise<HelperConnection> {
    if (!this.session) await this.connect();
    if (!this.session || this.status?.state !== "ready") {
      if (this.status?.state === "not-installed") throw new Error("Install LabShelf Helper to build and publish projects.");
      if (this.status?.state === "update-extension") throw new Error("Update the LabShelf browser extension to connect to this Helper.");
      if (this.status?.state === "update-helper") {
        const host = this.status.host === "vscode" ? "the VS Code extension" : this.status.host === "terminal" ? "the terminal app" : "LabShelf Helper";
        throw new Error(`Update ${host} to connect the browser to its Helper.`);
      }
      throw new Error("LabShelf Helper is not connected. Try again.");
    }
    return this.session.socket;
  }
}

function compileBody({ projectId, main, mode, engine, editedFile, editedLine, haltOnError }: HelperCompileRequest): RequestBody {
  return {
    type: "compile", projectId, main, mode, ...(engine ? { engine } : {}), ...(editedFile ? { editedFile } : {}), ...(editedLine ? { editedLine } : {}),
    ...(haltOnError !== undefined ? { haltOnError } : {}),
  };
}

function cellResultOf({ status, language, restarted, latex, text, error, controls, durationMs }: Extract<ToPageMessage, { type: "cellResult" }>): CellResult {
  return {
    status, language, durationMs, ...(restarted !== undefined ? { restarted } : {}), ...(controls !== undefined ? { controls } : {}),
    ...(latex !== undefined ? { latex } : {}), ...(text !== undefined ? { text } : {}), ...(error !== undefined ? { error } : {}),
  };
}

class NativeLatexHelper implements ILatexHelper {
  private readonly edits = new UpdateTracker();
  private readonly session: NativeHelperSession;
  private readonly logger: ILogger;

  constructor(deps: NativeHelperSessionDeps) {
    this.logger = deps.logger;
    this.session = new NativeHelperSession(deps, this.edits);
  }

  connect = () => this.session.connect();
  status = () => this.session.status;
  disconnect = () => this.session.disconnect();

  private async logged<T>(operation: string, context: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (error) { await this.logger.error("browser.helper", error, { operation, ...context }); throw error; }
  }

  openProject(projectId: string, root: string): Promise<{ files: string[] }> {
    return this.logged("openProject", { projectId }, async () => {
      this.edits.forget(projectId);
      return (await this.session.readySocket()).request({ type: "openProject", projectId, root }, (m) => m.type === "opened" ? { done: { files: m.files } } : undefined);
    });
  }

  closeProject(projectId: string): Promise<void> {
    return this.logged("closeProject", { projectId }, async () => {
      this.edits.forget(projectId);
      await (await this.session.readySocket()).request({ type: "closeProject", projectId }, (m) => m.type === "closed" ? { done: undefined } : undefined);
    });
  }

  edit(projectId: string, path: string, version: number, change: HelperChange): Promise<void> {
    return this.logged("edit", { projectId, path }, async () => {
      const socket = await this.session.readySocket();
      const body = this.edits.apply(projectId, path, version, change);
      this.edits.remember(socket.post({ type: "edit", projectId, path, version, ...body }), projectId, path);
    });
  }

  save(projectId: string, path: string): Promise<void> {
    return this.logged("save", { projectId, path }, async () => {
      this.edits.forget(projectId, path);
      (await this.session.readySocket()).post({ type: "save", projectId, path });
    });
  }

  compile(request: HelperCompileRequest, onProgress: OnHelperProgress) {
    return this.logged("compile", { projectId: request.projectId }, async () =>
      (await this.session.readySocket()).request(compileBody(request), createCompileStep(onProgress)));
  }

  async cancel(projectId: string): Promise<void> { (await this.session.readySocket()).post({ type: "cancel", projectId }); }

  private async install(request: RequestBody, onProgress: OnHelperProgress): Promise<void> {
    const ready = await (await this.session.readySocket()).request(request, (m) => {
      if (m.type === "progress") onProgress(deriveProgress(m));
      return m.type === "ready" ? { done: m } : undefined;
    });
    const previous = this.session.status;
    const status = deriveHelperStatus(ready, PROTOCOL_VERSION);
    // A `ready` without `python` (the TeX installs') leaves the last known value.
    const kept = previous?.state === "ready" && previous.python !== undefined ? previous.python : undefined;
    this.session.status = status.state === "ready" && status.python === undefined && kept ? { ...status, python: kept } : status;
  }

  installPython(onProgress: OnHelperProgress): Promise<void> {
    return this.logged("installPython", {}, () => this.install({ type: "installPython" }, onProgress));
  }

  installTex(kind: "tinytex" | "texlive", onProgress: OnHelperProgress): Promise<void> {
    return this.logged("installTex", { kind }, () => this.install({ type: "installTex", kind }, onProgress));
  }

  installAllPackages(onProgress: OnHelperProgress): Promise<void> {
    return this.logged("installAllPackages", {}, () => this.install({ type: "installAllPackages" }, onProgress));
  }

  runCell(request: HelperCellRequest, signal: AbortSignal): Promise<CellResult> {
    return this.logged("runCell", { cwd: request.cwd }, async () => {
      const socket = await this.session.readySocket();
      signal.throwIfAborted();
      let runId: string | undefined;
      // The page never sees the id: an abort posts cancelCell with it, and the helper then answers the run as cancelled.
      const cancel = () => { if (runId !== undefined && socket.isOpen) { socket.post({ type: "cancelCell", requestId: runId }); } };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        return await socket.request({ type: "runCell", ...request }, (m) => m.type === "cellResult" ? { done: cellResultOf(m) } : undefined, (id) => {
          runId = id;
          if (signal.aborted) { cancel(); }
        });
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    });
  }

  restartCell(noteKey: string, language: CellLanguage): Promise<void> {
    return this.logged("restartCell", { language }, async () => {
      (await this.session.readySocket()).post({ type: "restartCell", noteKey, language });
    });
  }

  publishTemplate(projectId: string, request: TemplatePublishRequest, onEvent: (event: TemplatePublishEvent) => void, renderThumbnail: (pdf: Uint8Array) => Promise<Uint8Array>): Promise<void> {
    return this.logged("publishTemplate", { projectId, action: request.action }, async () => {
      const socket = await this.session.readySocket();
      await socket.request({ type: "publishTemplate", projectId, ...request }, (message, payload) => {
        if (message.type === "templatePreview") {
          void renderThumbnail(payload).then(
            (png) => socket.post({ type: "templateThumbnail", requestId: message.id }, png),
            (error: unknown) => socket.post({ type: "templateThumbnail", requestId: message.id, error: formatError(error) }),
          ).catch((error: unknown) => this.logger.error("browser.helper", error, { operation: "templateThumbnail" }));
          return undefined;
        }
        if (message.type !== "templatePublish") return undefined;
        if (message.event) onEvent(message.event);
        return message.done ? { done: undefined } : undefined;
      });
    });
  }
}

export function createNativeLatexHelper(deps: NativeHelperSessionDeps): ILatexHelper { return new NativeLatexHelper(deps); }
