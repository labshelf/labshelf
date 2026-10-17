// Implements ILatexHelper over a native-messaging port that an extension page owns.
import { HELPER_HOST_NAME, PROTOCOL_VERSION, type HelperProgressListener, type HelperStatus, type ILatexHelper } from "@labshelf/core/helper";
import { type ILogger } from "@labshelf/core";
import { HelperClosedError, HelperConnection, isHostNotFound, statusFromReady, type HelperPortFactory } from "./connection";
import { buildProject, progressOf, syncProject } from "./project";

interface NativeLatexHelperDeps {
  logger: ILogger;
  extensionVersion: string;
  connectNative: HelperPortFactory;
}

function failureReason(error: unknown): string | undefined {
  return error instanceof HelperClosedError ? error.reason : error instanceof Error ? error.message : undefined;
}

/** Opens the host and says hello; only a ready helper keeps its connection. A missing host is a status, any other failure is logged and thrown. */
async function handshake(deps: NativeLatexHelperDeps): Promise<{ status: HelperStatus; connection?: HelperConnection }> {
  try {
    const opened = new HelperConnection(deps.connectNative(), deps.logger);
    const ready = await opened.request({ type: "hello", extensionVersion: deps.extensionVersion }, (m) => (m.type === "ready" ? { done: m } : undefined));
    const status = statusFromReady(ready, PROTOCOL_VERSION);
    if (status.state === "ready") { return { status, connection: opened }; }
    opened.disconnect();
    return { status };
  } catch (error) {
    if (!isHostNotFound(failureReason(error))) {
      await deps.logger.error("browser.helper", error, { step: "hello", host: HELPER_HOST_NAME });
      throw error;
    }
    return { status: { state: "not-installed" } };
  }
}

async function logFailure<T>(logger: ILogger, operation: string, context: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    await logger.error("browser.helper", error, { operation, ...context });
    throw error;
  }
}

export function createNativeLatexHelper(deps: NativeLatexHelperDeps): ILatexHelper {
  const { logger } = deps;
  let connection: HelperConnection | undefined;
  let current: HelperStatus | undefined;

  async function connect(): Promise<HelperStatus> {
    connection?.disconnect();
    connection = undefined;
    const outcome = await handshake(deps);
    current = outcome.status;
    connection = outcome.connection;
    return current;
  }

  async function readyConnection(): Promise<HelperConnection> {
    if (!connection?.isOpen) { await connect(); }
    if (!connection?.isOpen || current?.state !== "ready") { throw new Error(`LabShelf Helper is not ready (${current?.state ?? "not connected"})`); }
    return connection;
  }

  const logged = <T>(operation: string, context: Record<string, unknown>, run: () => Promise<T>): Promise<T> =>
    logFailure(logger, operation, context, run);

  async function install(request: { type: "installTex"; kind: "tinytex" | "texlive" } | { type: "installAllPackages" }, onProgress: HelperProgressListener): Promise<void> {
    const ready = await (await readyConnection()).request(request, (m) => {
      if (m.type === "progress") { onProgress(progressOf(m)); }
      return m.type === "ready" ? { done: m } : undefined;
    });
    current = statusFromReady(ready, PROTOCOL_VERSION);
  }

  return {
    connect,
    status: () => current,
    compile: (project, onProgress) => logged("compile", { projectId: project.projectId }, async () => {
      const open = await readyConnection();
      await syncProject(open, project);
      return buildProject(open, project, onProgress);
    }),
    cancel: async (projectId) => { (await readyConnection()).post({ type: "cancel", projectId }); },
    installTex: (kind, onProgress) => logged("installTex", { kind }, () => install({ type: "installTex", kind }, onProgress)),
    installAllPackages: (onProgress) => logged("installAllPackages", {}, () => install({ type: "installAllPackages" }, onProgress)),
  };
}
