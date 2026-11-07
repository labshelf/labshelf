// The editor's dependencies inside the webview, each a request to the extension host (writing/sourceEditor/bridges.ts) or a feed of its messages.
import type { DefinitionDeps, SourceEditorDeps } from "@labshelf/core/sourceEditor";
import type { NoteInsertSource, PaperNotesStore, SourceEditorAction, SourceEditorInbound, SourceEditorOutbound, TextRange, ThreadRange } from "@labshelf/core";

type Request = Extract<SourceEditorOutbound, { type: "request" }>;
type Response = Extract<SourceEditorInbound, { type: "response" }>;
type ProblemsMessage = Extract<SourceEditorInbound, { type: "problems" }>;
type CommentsMessage = Extract<SourceEditorInbound, { type: "comments" }>;
/** The editor's EditorComments (core): ranges are LF offsets of the document. */
interface CommentsPort {
  subscribe(listener: (ranges: ThreadRange[]) => void): () => void;
  add(range: TextRange, text: string): Promise<void>;
  open(): void;
}
type SuggestionsMessage = Extract<SourceEditorInbound, { type: "suggestions" }>;
/** The editor's EditorSuggestions (core) for the open file. */
type SuggestionsPort = NonNullable<SourceEditorDeps["review"]>["suggestions"];
type ProblemSource = NonNullable<SourceEditorDeps["problems"]>;
type ProblemListener = Parameters<ProblemSource>[1];
type Problems = Parameters<ProblemListener>[0];
type OpenTab = DefinitionDeps["openTab"];
type DictionaryStore = NonNullable<SourceEditorDeps["proofing"]>["store"];
type DictionaryFiles = NonNullable<Awaited<ReturnType<DictionaryStore["read"]>>>;

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
  suggestions: SuggestionsPort;
  /** The machine-local spelling dictionaries and the user's words, kept by the host. */
  dictionaries: DictionaryStore;
  /** Runs a toolbar action on the host (an insert dialog, the citation picker, project search or history). */
  runAction(action: SourceEditorAction): void;
  /** Sends any request to the host, such as the talk and poster workspace's. */
  request: Ask;
  /** Settles the request a response answers. */
  settle(response: Response): void;
  /** Gives the listeners the file's current problems. */
  deliverProblems(message: ProblemsMessage): void;
  /** Gives the listeners the file's current comment ranges. */
  deliverComments(message: CommentsMessage): void;
  /** Gives the listeners the file's current tracked changes. */
  deliverSuggestions(message: SuggestionsMessage): void;
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

/** The bytes arrive as structured-clone Uint8Arrays; anything else is not a dictionary. */
function dictionaryFilesOf(value: unknown): DictionaryFiles | null {
  if (typeof value !== "object" || value === null) { return null; }
  const { aff, dic } = value as { aff?: unknown; dic?: unknown };
  return aff instanceof Uint8Array && dic instanceof Uint8Array ? { aff, dic } : null;
}

function dictionaryPort(ask: Ask): DictionaryStore {
  return {
    list: async () => strings(await ask("dictionaryList", {})),
    read: async (tag) => dictionaryFilesOf(await ask("dictionaryRead", { tag })),
    install: async (tag) => { await ask("dictionaryInstall", { tag }); },
    userWords: async () => strings(await ask("userWords", {})),
    addUserWord: async (word) => { await ask("addUserWord", { word }); },
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
  const listeners = new Set<(ranges: ThreadRange[]) => void>();
  let currentRanges: ThreadRange[] = [];
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
      currentRanges = message.ranges.map((range) => ({ id: range.id, start: range.from, end: range.to, comments: range.comments }));
      for (const listener of listeners) { listener(currentRanges); }
    },
  };
}

/** The suggestions feed: a listener gets the current list at once and after each delivery; adding and removing are messages the host stores, whose change comes back as a delivery. */
function createSuggestionsPort(post: (message: SourceEditorOutbound) => void): { port: SuggestionsPort; deliver(message: SuggestionsMessage): void } {
  type Listener = Parameters<SuggestionsPort["subscribe"]>[0];
  const listeners = new Set<Listener>();
  let current: Parameters<Listener>[0] = [];
  return {
    port: {
      subscribe: (listener) => {
        listeners.add(listener);
        listener(current);
        return () => { listeners.delete(listener); };
      },
      add: async (suggestions) => { post({ type: "addSuggestions", suggestions: [...suggestions] }); },
      remove: async (ids) => { post({ type: "removeSuggestions", ids: [...ids] }); },
    },
    deliver(message) {
      current = message.suggestions;
      for (const listener of [...listeners]) { listener(current); }
    },
  };
}

/** @param post sends a message to the extension host */
export function createHostPorts(post: (message: SourceEditorOutbound) => void): HostPorts {
  const { ask, settle } = createRequester(post);
  const problems = createProblemsPort();
  const comments = createCommentsPort(ask);
  const suggestions = createSuggestionsPort(post);

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
    suggestions: suggestions.port,
    dictionaries: dictionaryPort(ask),
    runAction: (action) => { void ask("runAction", { action }).catch(() => undefined); },
    request: ask,
    settle,
    deliverProblems: problems.deliver,
    deliverComments: comments.deliver,
    deliverSuggestions: suggestions.deliver,
  };
}
