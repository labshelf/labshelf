// Speaks JSON-RPC to one language server over the helper's lsp channel: numbered requests, notifications and cancellation.
import type { ILogger } from "@labshelf/core";
import type { HelperLspChannel } from "../../../helperProject";

type Message = Record<string, unknown>;

export interface LspClient {
  /** Resolves the result; rejects on an error reply, a failed send, an abort or `dispose`. */
  request<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T>;
  notify(method: string, params: unknown): void;
  onNotification(method: string, handler: (params: unknown) => void): void;
  /** Cancels the pending requests and stops listening. */
  dispose(): void;
}

interface Pending { method: string; resolve(result: unknown): void; reject(error: Error): void }

const MODULE = "editor.typst.lspClient";

export function createLspClient(channel: HelperLspChannel, logger: ILogger, projectId: string): LspClient {
  const pending = new Map<number, Pending>();
  const handlers = new Map<string, (params: unknown) => void>();
  let nextId = 1;
  const write = (payload: Message): Promise<void> => channel.send({ jsonrpc: "2.0", ...payload });
  const cancel = (id: number, reason: string): void => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    // A cancel is advisory: when it cannot be sent, the server is gone and the request with it.
    write({ method: "$/cancelRequest", params: { id } }).catch(() => undefined);
    entry.reject(new Error(`${entry.method} ${reason}`));
  };

  function receive(message: Message): void {
    const id = message["id"];
    const method = message["method"];
    if (typeof method === "string" && id !== undefined) {
      // The helper answers configuration requests; anything else the server asks gets an empty answer so it does not wait.
      write({ id, result: null }).catch((error: unknown) => void logger.error(MODULE, error, { action: "answer server request", projectId, method }));
      return;
    }
    if (typeof method === "string") { handlers.get(method)?.(message["params"]); return; }
    const entry = typeof id === "number" ? pending.get(id) : undefined;
    if (!entry) return;
    pending.delete(id as number);
    const error = message["error"] as { code?: number; message?: string } | undefined;
    if (error) entry.reject(new Error(`${entry.method} failed: ${error.message ?? "unknown error"} (${error.code ?? "no code"})`));
    else entry.resolve(message["result"] ?? null);
  }

  const stop = channel.onMessage(receive);
  return {
    request<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { method, resolve: resolve as (result: unknown) => void, reject });
        signal?.addEventListener("abort", () => cancel(id, "was cancelled"), { once: true });
        write({ id, method, params }).catch((error: unknown) => {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    notify(method, params) {
      write({ method, params }).catch((error: unknown) => void logger.error(MODULE, error, { action: "notify", projectId, method }));
    },
    onNotification(method, handler) { handlers.set(method, handler); },
    dispose() {
      stop();
      for (const id of [...pending.keys()]) cancel(id, "was cancelled: the editor closed");
    },
  };
}
