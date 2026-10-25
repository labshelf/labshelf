// Sends requests through an authenticated helper session.
import {
  PROTOCOL_VERSION, type HelperCompileRequest, type HelperChange, type OnHelperProgress,
  type ILatexHelper, type TemplatePublishEvent, type TemplatePublishRequest,
} from "@labshelf/core/helper";
import { formatError, type ILogger } from "@labshelf/core";
import { deriveHelperStatus, type RequestBody } from "./connection";
import { createCompileStep, UpdateTracker, deriveProgress } from "./project";
import { NativeHelperSession, type NativeHelperSessionDeps } from "./nativeHelperSession";

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
