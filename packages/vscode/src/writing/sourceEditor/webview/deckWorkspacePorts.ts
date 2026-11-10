/// <reference lib="dom" />
// The talk and poster workspace inside the LabShelf Editor webview: its ports as requests to the extension host (deckWorkspaceHost.ts),
// the build state the host posts, and the mode kept in the webview's state.
import { mountDeckWorkspace, type DeckBuildState, type DeckWorkspace, type DeckWorkspaceMode, type DeckWorkspacePorts } from "@labshelf/core/deckWorkspace";
import type { SourceDeckEditing } from "@labshelf/core/sourceEditor";
import { base64ToBytes, bytesToBase64, type DeckKit, type DeckKitsPort, type DeckOverflowMark } from "@labshelf/core";
import { requestPdfAssets, requestPdfBytes } from "./citationPorts.js";
import type { HostPorts } from "./hostPorts.js";

interface WebviewState { getState(): unknown; setState(state: unknown): void }

const MODES: readonly DeckWorkspaceMode[] = ["visual", "split", "code", "grid"];

type CursorListener = (path: string, line: number) => void;

/** The overflow marks of a deckBuild message: the entries with a string file and a number line. */
function readOverflow(raw: unknown): DeckOverflowMark[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown) => {
    const { file, line } = (entry ?? {}) as { file?: unknown; line?: unknown };
    return typeof file === "string" && typeof line === "number" ? [{ file, line }] : [];
  });
}

/**
 * What the host posts the workspace: the build state it last posted (deckBuild) and the cursor in another project file open in a
 * VS Code editor (deckCursor, project-relative path and 1-based line), with their listeners.
 */
export function createBuildFeed(): {
  deliver(raw: unknown): boolean;
  onState: DeckWorkspacePorts["build"]["onState"];
  onCursor(listener: CursorListener): () => void;
} {
  // None until the host posts the state it loaded, so the workspace never takes a placeholder for "no page map".
  let state: DeckBuildState | undefined;
  const listeners = new Set<(state: DeckBuildState) => void>();
  const cursorListeners = new Set<CursorListener>();
  return {
    deliver(raw) {
      const message = raw as { type?: unknown; state?: unknown; errors?: unknown; overflow?: unknown; pageMap?: DeckBuildState["pageMap"]; path?: unknown; line?: unknown };
      if (message?.type === "deckCursor" && typeof message.path === "string" && typeof message.line === "number") {
        for (const listener of [...cursorListeners]) listener(message.path, message.line);
        return true;
      }
      if (message?.type !== "deckBuild" || typeof message.state !== "string") return false;
      const overflow = readOverflow(message.overflow);
      // The page map comes from the extension host's own build result, so it is taken as the host sent it.
      state = {
        state: message.state as DeckBuildState["state"], errors: typeof message.errors === "number" ? message.errors : 0, ...(overflow.length ? { overflow } : {}),
        ...(message.pageMap && { pageMap: message.pageMap }),
      };
      for (const listener of [...listeners]) listener(state);
      return true;
    },
    onState(listener) {
      listeners.add(listener);
      if (state) listener(state);
      return () => { listeners.delete(listener); };
    },
    onCursor(listener) {
      cursorListeners.add(listener);
      return () => { cursorListeners.delete(listener); };
    },
  };
}


/** The library's Kits as deckKits, deckSaveKit and deckPickKitImage requests; images cross as {name, base64}. */
export function createKitsPort(ports: Pick<HostPorts, "request">): DeckKitsPort {
  return {
    list: async () => await ports.request("deckKits", {}) as DeckKit[],
    save: async (kit, logo) => await ports.request("deckSaveKit", logo ? { kit, logo: { name: logo.name, base64: bytesToBase64(logo.bytes) } } : { kit }) as DeckKit,
    pickImage: async () => {
      const picked = await ports.request("deckPickKitImage", {}) as { name: string; base64: string } | null;
      return picked ? { name: picked.name, bytes: base64ToBytes(picked.base64) } : null;
    },
  };
}

type FilesPort = NonNullable<DeckWorkspacePorts["files"]>;

/** The project files as readFile, writeFile and openFile requests, with the host's cursor feed. */
function createFilesPort(ports: Pick<HostPorts, "request">, onCursor: NonNullable<FilesPort["onCursor"]>): FilesPort {
  return {
    read: async (path) => { const text = await ports.request("readFile", { path }).catch(() => undefined); return typeof text === "string" ? text : undefined; },
    write: async (path, text) => { await ports.request("writeFile", { path, text }); },
    open: (path, line, options) => { void ports.request("openFile", options?.preserveFocus ? { path, line, preserveFocus: true } : { path, line }).catch(() => undefined); },
    onCursor,
  };
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
  const assets = await requestPdfAssets(ports);
  const stored = (): Record<string, unknown> => (typeof state.getState() === "object" && state.getState() !== null ? state.getState() as Record<string, unknown> : {});
  return mountDeckWorkspace(deps.root, {
    path: deps.path,
    editing: deps.editing,
    editor: deps.card,
    subscribe: deps.subscribe,
    pdf: {
      assets,
      read: async () => await requestPdfBytes(ports, "deckPdf", {}).catch(() => undefined),
    },
    build: {
      run: () => { void deps.flush().then(() => ports.request("deckBuild", {})).catch(() => undefined); },
      onState: deps.builds.onState,
    },
    stylePreview: async ({ text, page, key }) => await requestPdfBytes(ports, "deckStylePreview", { path: deps.path, text, page, key }).catch(() => undefined),
    kits: createKitsPort(ports),
    files: createFilesPort(ports, deps.builds.onCursor),
    present: () => ports.runAction("presentDeck"),
    posterPreview: () => ports.runAction("posterPreview"),
    exportPdf: () => { void ports.request("deckExportPdf", {}).catch(() => undefined); },
    showProblems: () => { void ports.request("showProblems", {}).catch(() => undefined); },
    pickImage: async () => { const picked = await ports.request("deckPickImage", {}).catch(() => null); return typeof picked === "string" ? picked : undefined; },
    // The Explorer gives uris; the host resolves them. LabShelf project-file payloads come from the browser's tree only.
    dropImage: async ({ uris }) => {
      if (uris.length === 0) return undefined;
      const dropped = await ports.request("deckDropImage", { uris }).catch(() => null);
      return typeof dropped === "string" ? dropped : undefined;
    },
    mode: {
      read: () => { const mode = stored()["deckMode"]; return MODES.find((m) => m === mode); },
      write: (mode) => state.setState({ ...stored(), deckMode: mode }),
    },
  });
}
