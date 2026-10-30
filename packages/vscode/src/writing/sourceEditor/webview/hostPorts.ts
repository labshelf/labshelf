// The editor's dependencies inside the webview, each a request to the extension host (writing/sourceEditor/bridges.ts) or a feed of its messages.
import type { DefinitionDeps, SourceEditorDeps } from "@labshelf/core/sourceEditor";
import type { NoteInsertSource, PaperNotesStore, SourceEditorAction, SourceEditorInbound, SourceEditorOutbound, TextRange } from "@labshelf/core";

type Request = Extract<SourceEditorOutbound, { type: "request" }>;
type Response = Extract<SourceEditorInbound, { type: "response" }>;
type ProblemsMessage = Extract<SourceEditorInbound, { type: "problems" }>;
type CommentsMessage = Extract<SourceEditorInbound, { type: "comments" }>;
/** The editor's EditorComments (core): ranges are LF offsets of the document. */
interface CommentsPort {
  subscribe(listener: (ranges: TextRange[]) => void): () => void;
  add(range: TextRange, text: string): Promise<void>;
  open(): void;
}
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
  comments: CommentsPort;
  /** Runs a toolbar action on the host (an insert dialog, the citation picker, project search or history). */
  runAction(action: SourceEditorAction): void;
  /** Settles the request a response answers. */
  settle(response: Response): void;
  /** Gives the listeners the file's current problems. */
  deliverProblems(message: ProblemsMessage): void;
  /** Gives the listeners the file's current comment ranges. */
  deliverComments(message: CommentsMessage): void;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

type Ask = (method: Request["method"], params: Record<string, unknown>) => Promise<unknown>;

/** Sends each request to the host with a fresh id; `settle` answers the one a response names. */
function createRequester(post: (message: SourceEditorOutbound) => void): { ask: Ask; settle(response: Response): void } {
  let nextRequestId = 1;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  return {
    ask: (method, params) => {
      const id = nextRequestId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        post({ type: "request", id, method, params });
      });
    },
    settle(response) {
      const waiting = pending.get(response.id);
      if (!waiting) { return; }
      pending.delete(response.id);
      if (response.ok) { waiting.resolve(response.value); } else { waiting.reject(new Error(response.error)); }
    },
  };
}

function filesPort(ask: Ask): SourceEditorDeps["files"] {
  return {
    async list() { return strings(await ask("listFiles", {})); },
    async read(path) {
      const value = await ask("readFile", { path });
      if (typeof value !== "string") { throw new Error(`readFile answered no text for ${path}`); }
      return value;
    },
    // Document mode only: the host saves the file through its TextDocument.
    write: async () => { throw new Error(NOT_AVAILABLE); },
  };
}

function noteLinksPort(ask: Ask): NoteInsertSource {
  return {
    listProjectNotes: async () => {
      const value = await ask("listProjectNotes", {});
      return Array.isArray(value) ? value as Awaited<ReturnType<NoteInsertSource["listProjectNotes"]>> : [];
    },
    readProjectNote: async (path) => {
      const value = await ask("readProjectNote", { path });
      return typeof value === "string" ? value : undefined;
    },
    listCitedPaperIds: async () => strings(await ask("listCitedPaperIds", {})),
    readPaperNote: async (paperId) => {
      const value = await ask("readPaperNote", { paperId });
      return typeof value === "string" ? value : undefined;
    },
  };
}

/** The problems feed: a listener gets the current problems at once and after each delivery. */
function createProblemsPort(): { port: ProblemSource; deliver(message: ProblemsMessage): void } {
  const listeners = new Set<ProblemListener>();
  let path = "";
  let current: Problems = [];
  return {
    // The webview edits one file, so the path only labels the problems.
    port: (subscribedPath, listener) => {
      path = subscribedPath;
      listeners.add(listener);
      listener(current);
      return () => { listeners.delete(listener); };
    },
    deliver(message) {
      current = message.problems.map((problem) => ({ file: path, line: problem.line, severity: problem.severity, message: problem.message }));
      for (const listener of listeners) { listener(current); }
    },
  };
}

/** The comments feed and the requests that add a thread or focus VS Code's Comments view. */
function createCommentsPort(ask: Ask): { port: CommentsPort; deliver(message: CommentsMessage): void } {
  const listeners = new Set<(ranges: TextRange[]) => void>();
  let currentRanges: TextRange[] = [];
  return {
    port: {
      subscribe: (listener) => {
        listeners.add(listener);
        listener(currentRanges);
        return () => { listeners.delete(listener); };
      },
      add: async (range, text) => { await ask("addComment", { from: range.start, to: range.end, text }); },
      open: () => { void ask("openComments", {}).catch(() => undefined); },
    },
    deliver(message) {
      currentRanges = message.ranges.map((range) => ({ start: range.from, end: range.to }));
      for (const listener of listeners) { listener(currentRanges); }
    },
  };
}

/** @param post sends a message to the extension host */
export function createHostPorts(post: (message: SourceEditorOutbound) => void): HostPorts {
  const { ask, settle } = createRequester(post);
  const problems = createProblemsPort();
  const comments = createCommentsPort(ask);

  return {
    files: filesPort(ask),
    papers: async () => {
      const value = await ask("papers", {});
      return Array.isArray(value) ? value as Awaited<ReturnType<SourceEditorDeps["papers"]>> : [];
    },
    notes: { read: async (paperId) => await ask("readNote", { paperId }) as Awaited<ReturnType<PaperNotesStore["read"]>> },
    noteLinks: noteLinksPort(ask),
    openNotes: (paperId) => { void ask("openNotes", { paperId }).catch(() => undefined); },
    // A definition in another file of the project: the host opens it in a VS Code editor.
    openTab: (_kind, params) => { void ask("openFile", { path: params.path }).catch(() => undefined); },
    problems: problems.port,
    comments: comments.port,
    runAction: (action) => { void ask("runAction", { action }).catch(() => undefined); },
    settle,
    deliverProblems: problems.deliver,
    deliverComments: comments.deliver,
  };
}
