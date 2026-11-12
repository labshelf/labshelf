// The LaTeX helper client of a page: ILatexHelper and its session over a native port and a socket transport the app opens.
import { formatError } from "../errors/index.js";
import type { ILogger } from "../ports/index.js";
import { MAX_OCR_PNG_BYTES, MAX_PRINT_HTML_BYTES, PROTOCOL_VERSION, type TemplatePublishEvent, type TemplatePublishRequest, type ToPageMessage } from "./helperMessages.js";
import type { CellLanguage, CellResult } from "../qmd/compute/index.js";
import type { MathResult } from "../qmd/compute/index.js";
import {
  helperCanLinkOutputs, helperCanOcr, helperCanPrintPdf,
  type HelperSourcePick, type HelperSourceRunRequest, type HelperSourceRunResult, type HelperMathRequest, type HelperCellRequest, type HelperCompileRequest, type HelperChange, type HelperOcrResult, type HelperPrintRequest, type HelperPrintResult, type HelperState, type ILatexHelper, type OnHelperProgress,
} from "./helperPaths.js";
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

const PRINT_CANCELLED: HelperPrintResult = { ok: false, reason: "cancelled", message: "Cancelled." };
const OCR_CANCELLED: HelperOcrResult = { ok: false, reason: "cancelled", message: "Cancelled." };

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

function cellResultOf({ status, language, restarted, latex, text, error, controls, plot, warnings, durationMs }: Extract<ToPageMessage, { type: "cellResult" }>): CellResult {
  return {
    status, language, durationMs, ...(restarted !== undefined ? { restarted } : {}), ...(controls !== undefined ? { controls } : {}),
    ...(latex !== undefined ? { latex } : {}), ...(text !== undefined ? { text } : {}), ...(error !== undefined ? { error } : {}),
    ...(plot !== undefined ? { plot } : {}), ...(warnings !== undefined ? { warnings } : {}),
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
    // A `ready` without `python` (the TeX installs') or `capabilities` leaves the last known value.
    if (status.state !== "ready" || previous?.state !== "ready") { this.session.status = status; return; }
    this.session.status = {
      ...status,
      ...(status.python === undefined && previous.python !== undefined ? { python: previous.python } : {}),
      ...(status.capabilities === undefined && previous.capabilities !== undefined ? { capabilities: previous.capabilities } : {}),
    };
  }

  installPython(onProgress: OnHelperProgress): Promise<void> {
    return this.logged("installPython", {}, () => this.install({ type: "installPython" }, onProgress));
  }

  installPix2tex(onProgress: OnHelperProgress): Promise<void> {
    return this.logged("installPix2tex", {}, () => this.install({ type: "installPix2tex" }, onProgress));
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

  evalMath(request: HelperMathRequest, signal: AbortSignal): Promise<MathResult> {
    return this.logged("evalMath", { cwd: request.cwd }, async () => {
      const socket = await this.session.readySocket();
      signal.throwIfAborted();
      // The helper never cancels math: an abort only drops the reply, and the session keeps working.
      const reply = socket.request({ type: "evalMath", ...request }, (m) => m.type === "mathResult" ? { done: m.result } : undefined);
      let onAbort = () => undefined as void;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason ?? new Error("The math request was aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
      });
      reply.catch(() => undefined);
      try {
        return await Promise.race([reply, aborted]);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    });
  }

  printPdf(request: HelperPrintRequest, signal: AbortSignal): Promise<HelperPrintResult> {
    return this.logged("printPdf", { size: request.size }, async (): Promise<HelperPrintResult> => {
      const socket = await this.session.readySocket();
      if (!helperCanPrintPdf(this.session.status)) { return { ok: false, reason: "unsupported", message: "Update LabShelf Helper to export PDFs." }; }
      const html = new TextEncoder().encode(request.html);
      if (html.length > MAX_PRINT_HTML_BYTES) { return { ok: false, reason: "limit", message: "The deck is too large to print through LabShelf Helper." }; }
      if (signal.aborted) { return PRINT_CANCELLED; }
      let printId: string | undefined;
      let onAbort = () => undefined as void;
      // An abort posts cancelPrint and settles at once; the helper's later printFailed finds no request waiting.
      const aborted = new Promise<HelperPrintResult>((resolve) => {
        onAbort = () => {
          if (printId !== undefined && socket.isOpen) { socket.post({ type: "cancelPrint", requestId: printId }); }
          resolve(PRINT_CANCELLED);
        };
        signal.addEventListener("abort", onAbort, { once: true });
      });
      const reply = socket.request<HelperPrintResult>({ type: "printPdf", size: request.size }, (m, payload) => {
        if (m.type === "pdfPrinted") { return { done: { ok: true, pdf: payload.slice() } }; }
        return m.type === "printFailed" ? { done: { ok: false, reason: m.reason, message: m.message } } : undefined;
      }, (id) => { printId = id; }, html);
      reply.catch(() => undefined);
      try {
        return await Promise.race([reply, aborted]);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    });
  }

  ocr(png: Uint8Array, signal: AbortSignal): Promise<HelperOcrResult> {
    return this.logged("ocr", { bytes: png.length }, async (): Promise<HelperOcrResult> => {
      const socket = await this.session.readySocket();
      if (!helperCanOcr(this.session.status)) { return { ok: false, reason: "unsupported", message: "Update LabShelf Helper to read equations." }; }
      if (png.length > MAX_OCR_PNG_BYTES) { return { ok: false, reason: "limit", message: "The equation image is too large to read through LabShelf Helper." }; }
      if (signal.aborted) { return OCR_CANCELLED; }
      let ocrId: string | undefined;
      let onAbort = () => undefined as void;
      // An abort posts cancelOcr and settles at once; the helper's later ocrFailed finds no request waiting.
      const aborted = new Promise<HelperOcrResult>((resolve) => {
        onAbort = () => {
          if (ocrId !== undefined && socket.isOpen) { socket.post({ type: "cancelOcr", requestId: ocrId }); }
          resolve(OCR_CANCELLED);
        };
        signal.addEventListener("abort", onAbort, { once: true });
      });
      const reply = socket.request<HelperOcrResult>({ type: "ocr", bytes: png.length }, (m) => {
        if (m.type === "ocrResult") { return { done: { ok: true, latex: m.latex } }; }
        return m.type === "ocrFailed" ? { done: { ok: false, reason: m.reason, message: m.message } } : undefined;
      }, (id) => { ocrId = id; }, png);
      reply.catch(() => undefined);
      try {
        return await Promise.race([reply, aborted]);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    });
  }

  /** The ready socket of a helper that answers the source messages; throws a sentence the editor shows otherwise. */
  private async sourceSocket() {
    const socket = await this.session.readySocket();
    if (!helperCanLinkOutputs(this.session.status)) { throw new Error("Update LabShelf Helper to link outputs to code."); }
    return socket;
  }

  sourcePick(): Promise<HelperSourcePick> {
    return this.logged("sourcePick", {}, async () => (await this.sourceSocket()).request<HelperSourcePick>({ type: "sourcePick" }, (m) =>
      m.type === "sourcePicked" ? { done: { ...(m.folder !== undefined ? { folder: m.folder } : {}), ...(m.unavailable ? { unavailable: true } : {}) } } : undefined));
  }

  sourceInspect(folder: string): Promise<{ exists: boolean; remote?: string }> {
    return this.logged("sourceInspect", {}, async () => (await this.sourceSocket()).request<{ exists: boolean; remote?: string }>({ type: "sourceInspect", folder }, (m) =>
      m.type === "sourceInfo" ? { done: { exists: m.exists, ...(m.remote !== undefined ? { remote: m.remote } : {}) } } : undefined));
  }

  sourceList(folder: string): Promise<string[]> {
    return this.logged("sourceList", {}, async () => (await this.sourceSocket()).request<string[]>({ type: "sourceList", folder }, (m) =>
      m.type === "sourceFiles" ? { done: m.files } : undefined));
  }

  sourceRead(folder: string, path: string): Promise<Uint8Array | undefined> {
    return this.logged("sourceRead", { path }, async () => (await this.sourceSocket()).request<Uint8Array | undefined>({ type: "sourceRead", folder, path }, (m, payload) =>
      m.type === "sourceBytes" ? { done: m.missing ? undefined : payload.slice() } : undefined));
  }

  sourceRun(request: HelperSourceRunRequest, signal: AbortSignal): Promise<HelperSourceRunResult> {
    return this.logged("sourceRun", {}, async (): Promise<HelperSourceRunResult> => {
      const socket = await this.sourceSocket();
      if (signal.aborted) { return { status: "cancelled" }; }
      let runId: string | undefined;
      // An abort posts cancelSourceRun; the helper then answers the run as cancelled.
      const cancel = () => { if (runId !== undefined && socket.isOpen) { socket.post({ type: "cancelSourceRun", requestId: runId }); } };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        return await socket.request<HelperSourceRunResult>({ type: "sourceRun", ...request }, (m) => {
          if (m.type !== "sourceRan") { return undefined; }
          return { done: m.status === "cancelled" ? { status: "cancelled" } : { status: "finished", code: m.code ?? null, output: m.output ?? "" } };
        }, (id) => {
          runId = id;
          if (signal.aborted) { cancel(); }
        });
      } finally {
        signal.removeEventListener("abort", cancel);
      }
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
