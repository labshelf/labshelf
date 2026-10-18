// Gives a source editor the helper's `lsp` messages of one project, and tells it each time that project opens there.
import type { HelperLspListener, ILatexHelper } from "@labshelf/core/helper";

export interface HelperLspChannel {
  /** Sends one JSON-RPC message to the project's language server; rejects while the project is not open in the helper. */
  send(payload: Record<string, unknown>): Promise<void>;
  onMessage(listener: HelperLspListener): () => void;
  /** Runs now when the project is open, and on every later opening: each opening starts a fresh server. */
  onOpen(listener: () => void): () => void;
}

export interface LspChannelSource {
  helper: Pick<ILatexHelper, "onLsp" | "sendLsp">;
  isOpen(projectId: string): boolean;
  onOpened(listener: (projectId: string) => void): () => void;
}

export function createLspChannel(source: LspChannelSource, projectId: string): HelperLspChannel {
  return {
    async send(payload) {
      if (!source.isOpen(projectId)) throw new Error(`Project ${projectId} is not open in the helper`);
      await source.helper.sendLsp(projectId, payload);
    },
    onMessage: (listener) => source.helper.onLsp(projectId, listener),
    onOpen(listener) {
      if (source.isOpen(projectId)) listener();
      return source.onOpened((id) => { if (id === projectId) listener(); });
    },
  };
}
