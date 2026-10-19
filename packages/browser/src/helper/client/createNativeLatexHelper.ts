// Implements ILatexHelper over a native-messaging handshake and the loopback WebSocket the helper opens for the session.
import {
  PROTOCOL_VERSION, type HelperCompileRequest, type HelperEdit, type HelperLspListener, type HelperProgressListener,
  type HelperStatus, type ILatexHelper, type ToPageMessage,
} from "@labshelf/core/helper";
import type { ILogger } from "@labshelf/core";
import { handshake, type HandshakeDeps } from "./handshake";
import { statusFromReady, type HelperConnection, type HelperPortFactory, type HelperWebSocketConstructor, type RequestBody } from "./connection";
import { compileStep, EditTracker, progressOf } from "./project";

interface NativeLatexHelperDeps {
  logger: ILogger;
  extensionVersion: string;
  /** The page's `location.origin`; the helper accepts the socket only from this origin. */
  origin: string;
  connectNative: HelperPortFactory;
  /** Defaults to the page's WebSocket. */
  webSocket?: HelperWebSocketConstructor;
}

interface Session { native: HelperConnection; socket: HelperConnection }

const MODULE = "browser.helper";

export function createNativeLatexHelper(deps: NativeLatexHelperDeps): ILatexHelper {
  const { logger } = deps;
  const edits = new EditTracker();
  const lspListeners = new Map<string, Set<HelperLspListener>>();
  let session: Session | undefined;
  let current: HelperStatus | undefined;
  let generation = 0;
  let connecting: Promise<HelperStatus> | undefined;

  function dropSession(reason: string | undefined, forGeneration: number): void {
    if (forGeneration !== generation) { return; }
    const dropped = session;
    session = undefined;
    current = undefined;
    dropped?.native.disconnect();
    dropped?.socket.disconnect();
    void logger.log("INFO", MODULE, "LabShelf Helper connection closed", { reason });
  }

  function resendStale(message: Extract<ToPageMessage, { type: "error" }>): void {
    const resend = message.code === "stale" && message.id !== undefined ? edits.resend(message.id) : undefined;
    if (!resend) {
      void logger.log("WARN", MODULE, "LabShelf Helper reported an error no request was waiting for", { code: message.code, message: message.message });
      return;
    }
    void logger.log("INFO", MODULE, "Resending the whole text after a stale edit", { projectId: resend.projectId, path: resend.path });
    try {
      session?.socket.post({ type: "edit", ...resend });
    } catch (error) {
      void logger.error(MODULE, error, { operation: "resend", projectId: resend.projectId, path: resend.path });
    }
  }

  // INVARIANT: the helper keeps open projects per socket, so overlapping connects share one handshake instead of each replacing the socket.
  function connect(): Promise<HelperStatus> {
    connecting ??= openSession().finally(() => { connecting = undefined; });
    return connecting;
  }

  async function openSession(): Promise<HelperStatus> {
    const mine = ++generation;
    const previous = session;
    session = undefined;
    previous?.native.disconnect();
    previous?.socket.disconnect();
    const handshakeDeps: HandshakeDeps = { ...deps, webSocket: deps.webSocket ?? globalThis.WebSocket };
    const outcome = await handshake(handshakeDeps, {
      onLsp: (message) => lspListeners.get(message.projectId)?.forEach((listener) => listener(message.payload)),
      onUnmatchedError: resendStale,
      onClose: (reason) => dropSession(reason, mine),
    });
    edits.forgetAll();
    current = outcome.status;
    session = outcome.native && outcome.socket ? { native: outcome.native, socket: outcome.socket } : undefined;
    return current;
  }

  async function readySocket(): Promise<HelperConnection> {
    if (!session) { await connect(); }
    if (!session || current?.state !== "ready") { throw new Error(`LabShelf Helper is not ready (${current?.state ?? "not connected"})`); }
    return session.socket;
  }

  async function logged<T>(operation: string, context: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      await logger.error(MODULE, error, { operation, ...context });
      throw error;
    }
  }

  async function install(request: RequestBody, onProgress: HelperProgressListener): Promise<void> {
    const ready = await (await readySocket()).request(request, (m) => {
      if (m.type === "progress") { onProgress(progressOf(m)); }
      return m.type === "ready" ? { done: m } : undefined;
    });
    current = statusFromReady(ready, PROTOCOL_VERSION);
  }

  async function edit(projectId: string, path: string, version: number, change: HelperEdit): Promise<void> {
    const socket = await readySocket();
    const body = edits.apply(projectId, path, version, change);
    edits.remember(socket.post({ type: "edit", projectId, path, version, ...body }), projectId, path);
  }

  async function compile(request: HelperCompileRequest, onProgress: HelperProgressListener) {
    const { projectId, main, mode, engine, editedFile, editedLine } = request;
    const body: RequestBody = { type: "compile", projectId, main, mode, ...(engine ? { engine } : {}), ...(editedFile ? { editedFile } : {}), ...(editedLine ? { editedLine } : {}) };
    return (await readySocket()).request(body, compileStep(onProgress));
  }

  return {
    connect,
    status: () => current,
    openProject: (projectId, root) => logged("openProject", { projectId }, async () => {
      edits.forget(projectId);
      return (await readySocket()).request({ type: "openProject", projectId, root }, (m) => (m.type === "opened" ? { done: { files: m.files } } : undefined));
    }),
    closeProject: (projectId) => logged("closeProject", { projectId }, async () => {
      edits.forget(projectId);
      await (await readySocket()).request({ type: "closeProject", projectId }, (m) => (m.type === "closed" ? { done: undefined } : undefined));
    }),
    edit: (projectId, path, version, change) => logged("edit", { projectId, path }, () => edit(projectId, path, version, change)),
    save: (projectId, path) => logged("save", { projectId, path }, async () => {
      edits.forget(projectId, path);
      (await readySocket()).post({ type: "save", projectId, path });
    }),
    compile: (request, onProgress) => logged("compile", { projectId: request.projectId }, () => compile(request, onProgress)),
    cancel: async (projectId) => { (await readySocket()).post({ type: "cancel", projectId }); },
    installTex: (kind, onProgress) => logged("installTex", { kind }, () => install({ type: "installTex", kind }, onProgress)),
    installAllPackages: (onProgress) => logged("installAllPackages", {}, () => install({ type: "installAllPackages" }, onProgress)),
    onLsp(projectId, listener) {
      const listeners = lspListeners.get(projectId) ?? new Set();
      listeners.add(listener);
      lspListeners.set(projectId, listeners);
      return () => { listeners.delete(listener); };
    },
    sendLsp: (projectId, payload) => logged("sendLsp", { projectId }, async () => { (await readySocket()).post({ type: "lsp", projectId, payload }); }),
  };
}
