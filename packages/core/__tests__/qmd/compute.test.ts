// Tests that the reader, library UI and Spaces hosts carry cell params and previews: a preview runs without writing and is answered with a cellPreview message; each protocol's validator rejects invalid params.
// Written as if the file sat at packages/core/__tests__/qmd/compute.test.ts (it mirrors src/qmd/compute/, where createCellRuns lives); relative imports are resolved from there.
import {
  createLoopbackTransport, isWebviewMessage, parseSpacesMessage, parseUiMessage, PaperNotesStore, runPaperCell, serveSpaces,
  type CellRequest, type CellResult, type ILogger, type LibraryUiHost, type SpacesHostPort,
} from "@labshelf/core";
import { setupHost } from "../reader/hostFixture";
import { seededFixture } from "../spaces/store/spaceStoreFixture";
import { library } from "../spaces/viewModel/viewFixture";

type Runner = (request: CellRequest, signal: AbortSignal) => Promise<CellResult>;
type Posted = Array<Record<string, unknown>>;

const PARAMS = { beta: 0.93, mode: "fast", on: true };
const RESULT = {
  status: "ok", language: "python", text: "1.86", durationMs: 3,
  controls: [{ name: "beta", kind: "slider", min: 0, max: 1, step: 0.01, value: 0.93 }],
} as unknown as CellResult;
const okRunner = (requests: unknown[]): Runner => async (request) => { requests.push(request); return RESULT; };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

interface Driver {
  /** The name of the message a host answers a preview with. */
  previewType: string;
  /** Runs one cell with `extra` (params, preview) merged into the view's runCell message. */
  run(extra: Record<string, unknown>): Promise<{ requests: CellRequest[]; posted: Posted; written: () => Promise<boolean> }>;
}

// ---- reader ----

const READER_ID = "n-01JB2QN0000000000000000000";
const READER_SEED = `::: {#${READER_ID} .labshelf-item anchor="" author="Ana" created="2026-10-01T00:00:00.000Z"}\n\`\`\`{python}\n#| label: calc\nbeta * 2\n\`\`\`\n:::\n`;

const reader: Driver = {
  previewType: "cellPreview",
  async run(extra) {
    const requests: CellRequest[] = [];
    const base = setupHost();
    const files: Record<string, string> = { p1: READER_SEED };
    const notes = new PaperNotesStore({ read: async (id) => files[id] ?? null, write: async (id, text) => { files[id] = text; } }, { logger: base.ports.logger });
    Object.assign(base.ports, { notes, runCell: okRunner(requests) });
    await base.host.handle({ command: "runCell", itemId: READER_ID, label: "calc", code: "beta * 2", language: "python", requestId: "r1", ...extra } as never);
    const posted = base.posted as unknown as Posted;
    return { requests, posted, written: async () => files["p1"] !== READER_SEED || posted.some((m) => m["type"] === "updateNotes") };
  },
};

// ---- library UI (paper.runCell) ----

const paperDriver: Driver = {
  previewType: "paper.cellPreview",
  async run(extra) {
    const requests: CellRequest[] = [];
    const posted: Posted = [];
    const body = "```{python}\n#| label: calc\nbeta * 2\n```";
    const item = { kind: "item", id: "n1", anchor: { kind: "none" }, classes: ["labshelf-item"], attrs: [], fence: "", body, close: "", created: "2026-01-01T00:00:00Z", author: "me" };
    const editItem = jest.fn(async () => undefined);
    const notes = { read: jest.fn(async () => ({ segments: [item] })), addItem: jest.fn(), editItem, removeItem: jest.fn() };
    const host = {
      papers: async () => [], post: (m: unknown) => { posted.push(m as Record<string, unknown>); }, notice: () => undefined, refresh: async () => undefined,
      details: jest.fn(async () => ({ annotations: [] })), notes, runCell: okRunner(requests),
    } as unknown as LibraryUiHost;
    await runPaperCell(host, { id: "a", itemId: "n1", label: "calc", code: "beta * 2", language: "python", requestId: "r1", ...extra } as never);
    return { requests, posted, written: async () => editItem.mock.calls.length > 0 || posted.some((m) => m["type"] === "details") };
  },
};

// ---- Spaces (space.runCell) ----

const SPACE_NOTE = "```{python}\n#| label: calc\nbeta * 2\n```\n";

const spaces: Driver = {
  previewType: "space.cellPreview",
  async run(extra) {
    const requests: CellRequest[] = [];
    const f = await seededFixture({ thesis: { version: 1, name: "Thesis", folders: [], papers: [{ id: "p1" }], projects: [], dates: [] } });
    await f.store.reload();
    const path = await f.store.notes.create("thesis", "Calc");
    const itemId = await f.store.notes.addItem("thesis", path, SPACE_NOTE);
    const port: SpacesHostPort = {
      library: () => library({ id: "p1", title: "Attention", status: "done" }), onLibraryChange: () => () => undefined,
      projects: async () => [], onProjectsChange: () => () => undefined,
      openPaper: async () => undefined, selectPaper: async () => undefined, openProject: async () => undefined,
      openSpace: async () => undefined, openCatalog: async () => undefined, saveFile: async () => undefined,
    };
    const { ui, host } = createLoopbackTransport<never, never>();
    const posted: Posted = [];
    (ui as { subscribe(listener: (m: unknown) => void): unknown }).subscribe((m) => posted.push(m as Record<string, unknown>));
    const logger: ILogger = { log: async () => undefined, error: async () => undefined };
    serveSpaces(host as never, { store: f.store, port, logger, today: () => "2026-11-01", runCell: okRunner(requests) } as never);
    const post = (m: unknown) => (ui as { post(m: unknown): void }).post(m);
    post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    posted.length = 0;
    post({ type: "space.runCell", path, itemId, label: "calc", code: "beta * 2", language: "python", requestId: "r1", ...extra });
    await settle();
    return {
      requests, posted,
      written: async () => (await f.store.notes.read("thesis", path)).find((i) => i.id === itemId)!.body !== SPACE_NOTE || posted.some((m) => m["type"] === "spaceQmd"),
    };
  },
};

const HOSTS: Array<[string, Driver]> = [["reader", reader], ["paper", paperDriver], ["space", spaces]];

describe.each(HOSTS)("3.2 %s host runs a cell with params", (_name, driver) => {
  it("3.2a runs a preview without writing the cell", async () => {
    const { requests, written } = await driver.run({ params: PARAMS, preview: true });
    expect(requests).toHaveLength(1);
    expect(await written()).toBe(false);
  });

  it("3.2a answers a preview with a cellPreview carrying the request id and the result", async () => {
    const { posted } = await driver.run({ params: PARAMS, preview: true });
    const previews = posted.filter((m) => m["type"] === driver.previewType);
    expect(previews).toEqual([{ type: driver.previewType, requestId: "r1", result: RESULT }]);
  });

  it("3.2a hands the params and the preview flag to the runner", async () => {
    const { requests } = await driver.run({ params: PARAMS, preview: true });
    expect(requests[0]).toMatchObject({ code: "beta * 2", language: "python", params: PARAMS, preview: true });
  });

  it("3.2a a run that is not a preview still writes the output and posts no cellPreview", async () => {
    const { posted, written, requests } = await driver.run({ params: PARAMS });
    expect(requests[0]).toMatchObject({ params: PARAMS });
    expect(await written()).toBe(true);
    expect(posted.some((m) => m["type"] === driver.previewType)).toBe(false);
  });
});

// ---- validators ----

interface Validator { name: string; message: (extra: Record<string, unknown>) => Record<string, unknown>; accepts: (raw: unknown) => boolean; parsed?: (raw: unknown) => unknown }

const VALIDATORS: Validator[] = [
  {
    name: "reader runCell",
    message: (extra) => ({ command: "runCell", itemId: "n1", label: "calc", code: "beta * 2", language: "python", requestId: "r1", ...extra }),
    accepts: (raw) => isWebviewMessage(raw),
  },
  {
    name: "paper.runCell",
    message: (extra) => ({ type: "paper.runCell", id: "p1", itemId: "n1", label: "calc", code: "beta * 2", language: "python", requestId: "r1", ...extra }),
    accepts: (raw) => parseUiMessage(raw) !== null,
    parsed: (raw) => parseUiMessage(raw),
  },
  {
    name: "space.runCell",
    message: (extra) => ({ type: "space.runCell", path: "notes/calc.qmd", itemId: "n1", label: "calc", code: "beta * 2", language: "python", requestId: "r1", ...extra }),
    accepts: (raw) => parseSpacesMessage(raw) !== undefined,
    parsed: (raw) => parseSpacesMessage(raw),
  },
];

const eight = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p${i}`, i]));
const nine = { ...eight, p8: 8 };

const INVALID: Array<[string, unknown]> = [
  ["a name starting with a digit", { "1a": 1 }],
  ["a name with a dash", { "a-b": 1 }],
  ["a name with a space", { "a b": 1 }],
  ["an empty name", { "": 1 }],
  ["a name with a non-ASCII letter", { "é": 1 }],
  ["a ninth entry", nine],
  ["NaN", { a: Number.NaN }],
  ["Infinity", { a: Number.POSITIVE_INFINITY }],
  ["-Infinity", { a: Number.NEGATIVE_INFINITY }],
  ["a string over 200 characters", { a: "x".repeat(201) }],
  ["a null value", { a: null }],
  ["an object value", { a: { b: 1 } }],
  ["an array value", { a: [1, 2] }],
  ["an array instead of an object", [1, 2]],
  ["a string instead of an object", "beta=1"],
  ["null instead of an object", null],
];

const VALID: Array<[string, Record<string, unknown>]> = [
  ["numbers, booleans and strings", PARAMS],
  ["no entries", {}],
  ["eight entries", eight],
  ["a string of exactly 200 characters", { a: "x".repeat(200) }],
  ["an empty string", { a: "" }],
  ["negative and fractional numbers", { a: -3.5, b: 0 }],
  ["names with digits and underscores", { a_1: 1, B2: false }],
];

describe.each(VALIDATORS)("3.2 $name validation", (validator) => {
  it("3.2b accepts the message without params", () => {
    expect(validator.accepts(validator.message({}))).toBe(true);
  });

  it.each(VALID)("3.2b accepts params with %s", (_what, params) => {
    expect(validator.accepts(validator.message({ params }))).toBe(true);
  });

  it.each(INVALID)("3.2b rejects params with %s", (_what, params) => {
    // The valid control keeps a guard that ignores the message type from passing for the wrong reason.
    expect(validator.accepts(validator.message({ params: PARAMS }))).toBe(true);
    expect(validator.accepts(validator.message({ params }))).toBe(false);
  });

  it.each([true, false])("3.2b accepts preview %s", (preview) => {
    expect(validator.accepts(validator.message({ params: PARAMS, preview }))).toBe(true);
  });

  it.each([["a string", "yes"], ["a number", 1], ["null", null]])("3.2b rejects a preview that is %s", (_what, preview) => {
    expect(validator.accepts(validator.message({ params: PARAMS }))).toBe(true);
    expect(validator.accepts(validator.message({ params: PARAMS, preview }))).toBe(false);
  });

  it("3.2b keeps the params and the preview flag of an accepted message", () => {
    if (!validator.parsed) { return; }
    expect(validator.parsed(validator.message({ params: PARAMS, preview: true }))).toMatchObject({ params: PARAMS, preview: true });
  });
});
