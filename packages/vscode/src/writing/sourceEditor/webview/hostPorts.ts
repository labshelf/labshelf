// The editor's dependencies inside the webview, each a request to the extension host (writing/sourceEditor/bridges.ts) or a feed of its messages.
import type { DefinitionDeps, SourceEditorDeps } from "@labshelf/core/sourceEditor";
import type { NoteInsertSource, PaperNotesStore, SourceEditorInbound, SourceEditorOutbound } from "@labshelf/core";

type Request = Extract<SourceEditorOutbound, { type: "request" }>;
type Response = Extract<SourceEditorInbound, { type: "response" }>;
type ProblemsMessage = Extract<SourceEditorInbound, { type: "problems" }>;
type ProblemSource = NonNullable<SourceEditorDeps["problems"]>;
type ProblemListener = Parameters<ProblemSource>[1];
type Problems = Parameters<ProblemListener>[0];
type OpenTab = DefinitionDeps["openTab"];

const NOT_AVAILABLE = "not available";

export interface HostPorts {
  files: SourceEditorDeps["files"];
  papers: SourceEditorDeps["papers"];
  notes: Pick<PaperNotesStore, "read">;
  noteLinks: NoteInsertSource;
  openNotes(paperId: string): void;
  openTab: OpenTab;
  problems: ProblemSource;
  /** Settles the request a response answers. */
  settle(response: Response): void;
  /** Gives the listeners the file's current problems. */
  deliverProblems(message: ProblemsMessage): void;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** @param post sends a message to the extension host */
export function createHostPorts(post: (message: SourceEditorOutbound) => void): HostPorts {
  let nextRequestId = 1;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  const request = (method: Request["method"], params: Record<string, unknown>): Promise<unknown> => {
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({ type: "request", id, method, params });
    });
  };

  const listeners = new Set<ProblemListener>();
  let path = "";
  let current: Problems = [];

  return {
    files: {
      async list() { return strings(await request("listFiles", {})); },
      async read(path) {
        const value = await request("readFile", { path });
        if (typeof value !== "string") { throw new Error(`readFile answered no text for ${path}`); }
        return value;
      },
      // Document mode only: the host saves the file through its TextDocument.
      write: async () => { throw new Error(NOT_AVAILABLE); },
    },
    papers: async () => {
      const value = await request("papers", {});
      return Array.isArray(value) ? value as Awaited<ReturnType<SourceEditorDeps["papers"]>> : [];
    },
    notes: { read: async (paperId) => await request("readNote", { paperId }) as Awaited<ReturnType<PaperNotesStore["read"]>> },
    noteLinks: {
      listProjectNotes: async () => {
        const value = await request("listProjectNotes", {});
        return Array.isArray(value) ? value as Awaited<ReturnType<NoteInsertSource["listProjectNotes"]>> : [];
      },
      readProjectNote: async (path) => {
        const value = await request("readProjectNote", { path });
        return typeof value === "string" ? value : undefined;
      },
      listCitedPaperIds: async () => strings(await request("listCitedPaperIds", {})),
      readPaperNote: async (paperId) => {
        const value = await request("readPaperNote", { paperId });
        return typeof value === "string" ? value : undefined;
      },
    },
    openNotes: (paperId) => { void request("openNotes", { paperId }).catch(() => undefined); },
    // A definition in another file of the project: the host opens it in a VS Code editor.
    openTab: (_kind, params) => { void request("openFile", { path: params.path }).catch(() => undefined); },
    // The webview edits one file, so the path only labels the problems.
    problems: (subscribedPath, listener) => {
      path = subscribedPath;
      listeners.add(listener);
      listener(current);
      return () => { listeners.delete(listener); };
    },
    settle(response) {
      const waiting = pending.get(response.id);
      if (!waiting) { return; }
      pending.delete(response.id);
      if (response.ok) { waiting.resolve(response.value); } else { waiting.reject(new Error(response.error)); }
    },
    deliverProblems(message) {
      current = message.problems.map((problem) => ({ file: path, line: problem.line, severity: problem.severity, message: problem.message }));
      for (const listener of listeners) { listener(current); }
    },
  };
}
