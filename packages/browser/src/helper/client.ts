// The LaTeX helper client for an extension page: the native-messaging and WebSocket implementation of ILatexHelper and its session.
import {
  HELPER_HOST_NAME, PROTOCOL_VERSION, type HelperCompileRequest, type HelperChange, type HelperState, type OnHelperProgress,
  type ILatexHelper, type TemplatePublishEvent, type TemplatePublishRequest, type ToPageMessage,
} from "@labshelf/core/helper";
import { formatError, type ILogger } from "@labshelf/core";
import { bx, connectBrowserNative } from "../platform";
import {
  deriveHelperStatus, runHandshake, type HelperConnection, type HelperConnectionConstructor, type HelperPortFactory, type RequestBody,
} from "./connection";
import { createCompileStep, deriveProgress, UpdateTracker } from "./updateTracker";

export interface NativeHelperSessionDeps {
  logger: ILogger;
  extensionVersion: string;
  origin: string;
  connectNative: HelperPortFactory;
  webSocket?: HelperConnectionConstructor;
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
    const outcome = await runHandshake({ ...this.deps, webSocket: this.deps.webSocket ?? globalThis.WebSocket }, {
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
    this.session.status = deriveHelperStatus(ready, PROTOCOL_VERSION);
  }

  installTex(kind: "tinytex" | "texlive", onProgress: OnHelperProgress): Promise<void> {
    return this.logged("installTex", { kind }, () => this.install({ type: "installTex", kind }, onProgress));
  }

  installAllPackages(onProgress: OnHelperProgress): Promise<void> {
    return this.logged("installAllPackages", {}, () => this.install({ type: "installAllPackages" }, onProgress));
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

export function createBrowserLatexHelper(logger: ILogger): ILatexHelper {
  return createNativeLatexHelper({
    logger,
    extensionVersion: bx.runtime.getManifest().version,
    origin: location.origin,
    connectNative: () => connectBrowserNative(HELPER_HOST_NAME),
  });
}
