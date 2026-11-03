// The talk and poster workspace inside the LabShelf Editor webview: its ports as requests to the extension host (deckWorkspaceHost.ts),
// the build state the host posts, and the mode kept in the webview's state.
import { mountDeckWorkspace, type DeckBuildState, type DeckWorkspace, type DeckWorkspaceMode, type DeckWorkspacePorts } from "@labshelf/core/deckWorkspace";
import type { SourceDeckEditing } from "@labshelf/core/sourceEditor";
import type { HostPorts } from "./hostPorts.js";

interface WebviewState { getState(): unknown; setState(state: unknown): void }

const MODES: readonly DeckWorkspaceMode[] = ["visual", "split", "code"];

/** The build state the host last posted, and its listeners. */
export function createBuildFeed(): { deliver(raw: unknown): boolean; onState: DeckWorkspacePorts["build"]["onState"] } {
  let state: DeckBuildState = { state: "none", errors: 0 };
  const listeners = new Set<(state: DeckBuildState) => void>();
  return {
    deliver(raw) {
      const message = raw as { type?: unknown; state?: unknown; errors?: unknown };
      if (message?.type !== "deckBuild" || typeof message.state !== "string") return false;
      state = { state: message.state as DeckBuildState["state"], errors: typeof message.errors === "number" ? message.errors : 0 };
      for (const listener of [...listeners]) listener(state);
      return true;
    },
    onState(listener) {
      listeners.add(listener);
      listener(state);
      return () => { listeners.delete(listener); };
    },
  };
}

function decode(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export interface WorkspaceHostDeps {
  root: HTMLElement;
  card: HTMLElement;
  path: string;
  editing: SourceDeckEditing;
  /** Writes the editor's pending edits to the host before a build. */
  flush(): Promise<unknown>;
  subscribe: DeckWorkspacePorts["subscribe"];
  ports: HostPorts;
  builds: ReturnType<typeof createBuildFeed>;
  state: WebviewState;
}

/** Mounts the workspace around the editor card; undefined when the host cannot give pdf.js (the editor then stays as it is). */
export async function mountWorkspaceInWebview(deps: WorkspaceHostDeps): Promise<DeckWorkspace | undefined> {
  const { ports, state } = deps;
  const assets = await ports.request("deckAssets", {}) as DeckWorkspacePorts["pdf"]["assets"];
  const stored = (): Record<string, unknown> => (typeof state.getState() === "object" && state.getState() !== null ? state.getState() as Record<string, unknown> : {});
  const latex = deps.path.endsWith(".tex");
  return mountDeckWorkspace(deps.root, {
    path: deps.path,
    editing: deps.editing,
    editor: deps.card,
    subscribe: deps.subscribe,
    pdf: {
      assets,
      read: async () => {
        const data = await ports.request("deckPdf", {}).catch(() => null);
        return typeof data === "string" ? decode(data) : undefined;
      },
    },
    build: {
      run: () => { void deps.flush().then(() => ports.request("deckBuild", {})).catch(() => undefined); },
      onState: deps.builds.onState,
    },
    ...(latex ? {
      links: {
        boxes: async (from: number, to: number) => await ports.request("deckBoxes", { from, to }) as Awaited<ReturnType<NonNullable<DeckWorkspacePorts["links"]>["boxes"]>>,
        sourceAt: async (point: { page: number; x: number; y: number }) => { const line = await ports.request("deckSourceAt", point); return typeof line === "number" ? line : line === null ? null : undefined; },
      },
    } : {}),
    present: () => ports.runAction("presentDeck"),
    posterPreview: () => ports.runAction("posterPreview"),
    exportPdf: () => { void ports.request("deckExportPdf", {}).catch(() => undefined); },
    showProblems: () => { void ports.request("showProblems", {}).catch(() => undefined); },
    pickImage: async () => { const picked = await ports.request("deckPickImage", {}).catch(() => null); return typeof picked === "string" ? picked : undefined; },
    mode: {
      read: () => { const mode = stored()["deckMode"]; return MODES.find((m) => m === mode); },
      write: (mode) => state.setState({ ...stored(), deckMode: mode }),
    },
  });
}
