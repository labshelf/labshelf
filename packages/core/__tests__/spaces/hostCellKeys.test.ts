// Tests the Spaces page's multi-language cells: space.runCell and space.restartCell carry a cell language and serveSpaces derives the D2 note key (space:<space id>:<note path>).
import { isDeepStrictEqual } from "node:util";

import { createLoopbackTransport } from "../../src/libraryUi/protocol/index";
import type { ILogger } from "../../src/ports/index";
import { serveSpaces, type HostToSpaces, type SpacesHostPort, type SpacesToHost } from "../../src/spaces/index";
import { parseSpacesMessage } from "../../src/spaces/spacesProtocol";
import { seededFixture } from "./store/spaceStoreFixture";
import { library } from "./viewModel/viewFixture";

const LANGUAGES = ["python", "mathematica", "r"] as const;
const base = { version: 1, name: "Thesis", folders: [], papers: [{ id: "p1" }], projects: [], dates: [] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// A mismatch reads as the feature being absent, so a test fails with "not implemented" until the behaviour exists.
function expectSame(actual: unknown, expected: unknown, what: string): void {
  if (!isDeepStrictEqual(actual, expected)) { throw new Error(`not implemented: ${what}; got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`); }
}

const PATH = "notes/calc.qmd";
const runCell = (language: unknown, path = PATH) => ({ type: "space.runCell", path, itemId: "i1", label: "calc", code: "print(1)", language, requestId: "r1" });
const restartCell = (language: unknown, path = PATH) => ({ type: "space.restartCell", path, language });

describe("space protocol", () => {
  it.each(LANGUAGES)("3.2a accepts space.runCell in %s unchanged", (language) => { expectSame(parseSpacesMessage(runCell(language)), runCell(language), `space.runCell ${language}`); });
  it("3.2a rejects space.runCell with an unknown language", () => { expectSame(parseSpacesMessage(runCell("julia")), undefined, "space.runCell julia"); });
  it("3.2a rejects space.runCell without a language", () => {
    const { language: _language, ...without } = runCell("python");
    expectSame(parseSpacesMessage(without), undefined, "space.runCell without language");
  });

  it.each(LANGUAGES)("3.2b accepts space.restartCell in %s unchanged", (language) => { expectSame(parseSpacesMessage(restartCell(language)), restartCell(language), `space.restartCell ${language}`); });
  it("3.2b rejects space.restartCell with an unknown language", () => {
    expectSame(parseSpacesMessage(restartCell("r")), restartCell("r"), "valid space.restartCell");
    expectSame(parseSpacesMessage(restartCell("julia")), undefined, "space.restartCell julia");
  });
  it("3.2b rejects space.restartCell without a language", () => {
    expectSame(parseSpacesMessage(restartCell("r")), restartCell("r"), "valid space.restartCell");
    expectSame(parseSpacesMessage({ type: "space.restartCell", path: PATH }), undefined, "space.restartCell without language");
  });
  it("3.2b rejects space.restartCell whose path escapes the Space", () => {
    // A valid restart must parse first, so the rejection is the path check and not a missing message type.
    expectSame(parseSpacesMessage(restartCell("r")), restartCell("r"), "valid space.restartCell");
    expectSame(parseSpacesMessage(restartCell("r", "../outside.qmd")), undefined, "space.restartCell escaping path");
  });

  it("3.2c the restart message exists for every cell language", () => {
    expectSame(LANGUAGES.map((language) => parseSpacesMessage(restartCell(language)) !== undefined), [true, true, true], "space.restartCell for all languages");
  });
});

async function setup() {
  const f = await seededFixture({ thesis: base });
  await f.store.reload();
  const path = await f.store.notes.create("thesis", "Calc");
  const itemId = await f.store.notes.addItem("thesis", path, "```{r}\n#| label: calc\nprint(1)\n```\n");
  const port: SpacesHostPort = {
    library: () => library({ id: "p1", title: "Attention", status: "done" }),
    onLibraryChange: () => () => undefined,
    projects: async () => [],
    onProjectsChange: () => () => undefined,
    openPaper: async () => undefined, selectPaper: async () => undefined, openProject: async () => undefined,
    openSpace: async () => undefined, openCatalog: async () => undefined, saveFile: async () => undefined,
  };
  const { ui, host } = createLoopbackTransport<SpacesToHost, HostToSpaces>();
  ui.subscribe(() => undefined);
  const logger: ILogger = { log: async () => undefined, error: async () => undefined };
  const requests: Array<{ code: unknown; language: unknown; noteKey: unknown }> = [];
  const restarts: unknown[][] = [];
  const options = {
    store: f.store, port, logger, today: () => "2026-11-01",
    runCell: async (request: { code: unknown; language: unknown; noteKey: unknown }) => {
      requests.push({ code: request.code, language: request.language, noteKey: request.noteKey });
      return { status: "cancelled", language: "python", durationMs: 1 };
    },
    restartCell: async (...args: unknown[]) => { restarts.push(args); },
  };
  serveSpaces(host, options as never);
  ui.post({ type: "ready", view: "space", id: "thesis" });
  await settle();
  const send = (message: object) => { ui.post(message as unknown as SpacesToHost); };
  return { send, requests, restarts, path, itemId };
}

describe("serveSpaces cells", () => {
  it.each(LANGUAGES)("3.2a passes %s and the key space:<id>:<path> to the run port", async (language) => {
    const { send, requests, path, itemId } = await setup();
    send({ ...runCell(language, path), itemId });
    await settle();
    expectSame(requests, [{ code: "print(1)", language, noteKey: `space:thesis:${path}` }], `space.runCell ${language} request`);
  });

  it("3.2a keeps a key sent by the page out of the run request", async () => {
    const { send, requests, path, itemId } = await setup();
    send({ ...runCell("mathematica", path), itemId, noteKey: "space:other:x.qmd" });
    await settle();
    expectSame(requests, [{ code: "print(1)", language: "mathematica", noteKey: `space:thesis:${path}` }], "host derives the key");
  });

  it.each(LANGUAGES)("3.2b space.restartCell reaches the restart port with space:<id>:<path> and %s", async (language) => {
    const { send, restarts, path } = await setup();
    send(restartCell(language, path));
    await settle();
    expectSame(restarts, [[`space:thesis:${path}`, language]], `space.restartCell ${language}`);
  });

  it("3.2b space.restartCell does not run any cell", async () => {
    const { send, requests, restarts, path } = await setup();
    send(restartCell("r", path));
    await settle();
    expectSame(restarts.length, 1, "restart happened");
    expectSame(requests, [], "no run");
  });
});
