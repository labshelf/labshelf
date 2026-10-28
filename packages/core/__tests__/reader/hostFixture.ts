/**
 * A reader host controller over an in-memory sidecar and recording ports, shared by the host tests.
 */
import {
  DEFAULT_READER_PREFS,
  PaperSidecarStore,
  ReaderHostController,
  type HostToWebview,
  type PaperRecord,
  type ReaderHostPorts,
  type SidecarChange,
  type SidecarPort,
} from "@labshelf/core";

export const paper = {
  id: "p1", citeKey: "imai1986", title: "Efficient Algorithms", authors: ["Hiroshi Imai", "Takao Asano"], year: 1986, path: "papers/x/p1",
} as unknown as PaperRecord;

export const sidecar = JSON.stringify({
  annotations: [
    { id: "b", paperId: "p1", type: "note", pageNumber: 2, content: "n", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "x" },
    { id: "a", paperId: "p1", type: "highlight", pageNumber: 1, content: "h", color: "blue", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "x" },
  ],
  theme: "sepia",
  reading: { page: 5, scaleValue: "page-width", updatedAt: "t" },
});

export function setupHost(options: { seed?: string; page?: number; prefs?: typeof DEFAULT_READER_PREFS } = {}) {
  const files: Record<string, string> = options.seed ? { p1: options.seed } : {};
  const port: SidecarPort = { read: async (id) => files[id] ?? null, write: async (id, t) => { files[id] = t; } };
  let ids = 0;
  const posted: HostToWebview[] = [];
  const changes: SidecarChange[] = [];
  let prefs = options.prefs ?? DEFAULT_READER_PREFS;
  let clock = 1000;
  const ports = {
    paper,
    store: new PaperSidecarStore(port, { now: () => "2026-10-07T00:00:00.000Z", newId: () => `a${++ids}` }),
    post: (m: HostToWebview) => { posted.push(m); },
    getPrefs: () => prefs,
    autoTheme: () => "dark" as const,
    writeClipboard: jest.fn(async (_text: string) => undefined),
    notify: jest.fn(),
    openExternal: jest.fn(async (_url: string) => undefined),
    saveAnnotations: jest.fn(async (_markdown: string) => undefined),
    logger: { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) },
    sidecarChanged: (change: SidecarChange) => { changes.push(change); },
    now: () => clock,
  } satisfies ReaderHostPorts;
  const host = new ReaderHostController(ports, options.page !== undefined ? { page: options.page } : {});
  const setPrefs = (next: typeof DEFAULT_READER_PREFS) => { prefs = next; };
  const advanceClock = (ms: number) => { clock += ms; };
  return { host, ports, posted, files, changes, setPrefs, advanceClock };
}
