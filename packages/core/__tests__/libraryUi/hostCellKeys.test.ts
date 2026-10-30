// Tests the library UI's multi-language cells: paper.runCell and paper.restartCell carry a cell language and paperHandlers derive the D2 note key (paper:<id>).
import { isDeepStrictEqual } from "node:util";

import * as paperHandlers from "../../src/libraryUi/paperHandlers";
import { parseDetailsMessage, parseUiMessage } from "../../src/libraryUi/protocol/index";

const LANGUAGES = ["python", "mathematica", "r"] as const;

// A mismatch reads as the feature being absent, so a test fails with "not implemented" until the behaviour exists.
function expectSame(actual: unknown, expected: unknown, what: string): void {
  if (!isDeepStrictEqual(actual, expected)) { throw new Error(`not implemented: ${what}; got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`); }
}

const runCell = (language: unknown) => ({ type: "paper.runCell", id: "p1", itemId: "n1", label: "calc", code: "print(1)", language, requestId: "r1" });
const restartCell = (language: unknown) => ({ type: "paper.restartCell", id: "p1", language });

describe("library UI protocol", () => {
  it.each(LANGUAGES)("3.2a accepts paper.runCell in %s unchanged", (language) => {
    // The unknown-language check is the part that is new; a guard that ignores the language would accept both.
    expectSame([parseUiMessage(runCell(language)), parseUiMessage(runCell("julia"))], [runCell(language), null], `paper.runCell ${language} checked`);
  });
  it("3.2a rejects paper.runCell with an unknown language", () => { expectSame(parseUiMessage(runCell("julia")), null, "paper.runCell julia"); });
  it("3.2a rejects paper.runCell without a language", () => {
    const { language: _language, ...without } = runCell("python");
    expectSame(parseUiMessage(without), null, "paper.runCell without language");
  });
  it("3.2a accepts paper.runCell wrapped in the Details envelope", () => {
    expectSame(parseDetailsMessage({ channel: "library", msg: runCell("julia") }), null, "wrapped paper.runCell julia");
    expectSame(parseDetailsMessage({ channel: "library", msg: runCell("r") }), { channel: "library", msg: runCell("r") }, "wrapped paper.runCell");
  });

  it.each(LANGUAGES)("3.2b accepts paper.restartCell in %s unchanged", (language) => { expectSame(parseUiMessage(restartCell(language)), restartCell(language), `paper.restartCell ${language}`); });
  it("3.2b rejects paper.restartCell with an unknown language", () => {
    expectSame(parseUiMessage(restartCell("r")), restartCell("r"), "valid paper.restartCell");
    expectSame(parseUiMessage(restartCell("julia")), null, "paper.restartCell julia");
  });
  it("3.2b rejects paper.restartCell without a paper id", () => {
    expectSame(parseUiMessage(restartCell("r")), restartCell("r"), "valid paper.restartCell");
    expectSame(parseUiMessage({ type: "paper.restartCell", language: "r" }), null, "paper.restartCell without id");
  });
  it("3.2b rejects paper.restartCell without a language", () => {
    expectSame(parseUiMessage(restartCell("r")), restartCell("r"), "valid paper.restartCell");
    expectSame(parseUiMessage({ type: "paper.restartCell", id: "p1" }), null, "paper.restartCell without language");
  });
  it("3.2b accepts paper.restartCell wrapped in the Details envelope", () => {
    expectSame(parseDetailsMessage({ channel: "library", msg: restartCell("r") }), { channel: "library", msg: restartCell("r") }, "wrapped paper.restartCell");
  });

  it("3.2c the restart message exists for every cell language", () => {
    expectSame(LANGUAGES.map((language) => parseUiMessage(restartCell(language)) !== null), [true, true, true], "paper.restartCell for all languages");
  });
});

// The handlers are reached through a namespace so a missing export reads as "not implemented" rather than a compile error.
const handlers = paperHandlers as unknown as {
  runPaperCell: (host: unknown, msg: unknown) => Promise<void>;
  restartPaperCell?: (host: unknown, msg: unknown) => Promise<void>;
};

function fakeHost() {
  const requests: Array<{ code: unknown; language: unknown; noteKey: unknown }> = [];
  const restarts: unknown[][] = [];
  const notes = {
    read: async () => ({ segments: [{ kind: "item", id: "n1", anchor: { kind: "none" }, classes: ["labshelf-item"], attrs: [], fence: "", body: "first", close: "", created: "2026-01-01T00:00:00Z", author: "me" }] }),
    editItem: async () => undefined,
  };
  const host = {
    papers: async () => [{ id: "p1", title: "Alpha", path: "papers/p1", citeKey: "p1" }],
    post: () => undefined,
    notice: () => undefined,
    refresh: async () => undefined,
    details: async () => ({ annotations: [] }),
    notes,
    runCell: async (request: { code: unknown; language: unknown; noteKey: unknown }) => {
      requests.push({ code: request.code, language: request.language, noteKey: request.noteKey });
      return { status: "cancelled", language: "python", durationMs: 1 };
    },
    restartCell: async (...args: unknown[]) => { restarts.push(args); },
  };
  return { host, requests, restarts };
}

describe("paperHandlers cells", () => {
  it.each(LANGUAGES)("3.2a runPaperCell passes %s and the key paper:<id> to the run port", async (language) => {
    const { host, requests } = fakeHost();
    await handlers.runPaperCell(host, runCell(language));
    expectSame(requests, [{ code: "print(1)", language, noteKey: "paper:p1" }], `runPaperCell ${language} request`);
  });

  it("3.2a keeps a key sent by the view out of the run request", async () => {
    const { host, requests } = fakeHost();
    await handlers.runPaperCell(host, { ...runCell("mathematica"), noteKey: "paper:other" });
    expectSame(requests, [{ code: "print(1)", language: "mathematica", noteKey: "paper:p1" }], "host derives the key");
  });

  it.each(LANGUAGES)("3.2b restartPaperCell reaches the restart port with paper:<id> and %s", async (language) => {
    const { host, restarts } = fakeHost();
    if (!handlers.restartPaperCell) { throw new Error("not implemented: restartPaperCell is not exported by paperHandlers"); }
    await handlers.restartPaperCell(host, restartCell(language));
    expectSame(restarts, [["paper:p1", language]], `restartPaperCell ${language}`);
  });

  it("3.2b restartPaperCell does not run any cell", async () => {
    const { host, requests, restarts } = fakeHost();
    if (!handlers.restartPaperCell) { throw new Error("not implemented: restartPaperCell is not exported by paperHandlers"); }
    await handlers.restartPaperCell(host, restartCell("r"));
    expectSame(restarts.length, 1, "restart happened");
    expectSame(requests, [], "no run");
  });
});
