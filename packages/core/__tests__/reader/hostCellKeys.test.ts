// Tests the reader's multi-language cells: runCell and restartCell carry a cell language, the host derives the D2 note key (paper:<id>), and the protocol moves to 9.
import { isDeepStrictEqual } from "node:util";

import { PaperNotesStore, type CellResult } from "@labshelf/core";
import { isWebviewMessage, PROTOCOL_VERSION } from "../../src/reader/protocol/index";
import { setupHost } from "./hostFixture";

const LANGUAGES = ["python", "mathematica", "r"] as const;
const ID = "n-01JB2QN0000000000000000000";

// A mismatch reads as the feature being absent, so a test fails with "not implemented" until the behaviour exists.
function expectSame(actual: unknown, expected: unknown, what: string): void {
  if (!isDeepStrictEqual(actual, expected)) { throw new Error(`not implemented: ${what}; got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`); }
}

const seed = (language: string) => `::: {#${ID} .labshelf-item anchor="" author="Ana" created="2026-10-01T00:00:00.000Z"}\n\`\`\`{${language}}\n#| label: calc\nprint(1)\n\`\`\`\n:::\n`;

function setup(language = "python") {
  const base = setupHost();
  const files: Record<string, string> = { p1: seed(language) };
  const notes = new PaperNotesStore({ read: async (id) => files[id] ?? null, write: async (id, text) => { files[id] = text; } }, { logger: base.ports.logger });
  const requests: Array<{ code: unknown; language: unknown; noteKey: unknown }> = [];
  const runCell = async (request: { code: unknown; language: unknown; noteKey: unknown }): Promise<CellResult> => {
    requests.push({ code: request.code, language: request.language, noteKey: request.noteKey });
    return { status: "cancelled", language: "python", durationMs: 1 };
  };
  const restarts: unknown[][] = [];
  const restartCell = async (...args: unknown[]): Promise<void> => { restarts.push(args); };
  Object.assign(base.ports, { notes, runCell, restartCell });
  return { ...base, requests, restarts };
}

const run = (language: unknown) => ({ command: "runCell", itemId: ID, label: "calc", code: "print(1)", language, requestId: "r1" });

describe("reader protocol", () => {
  it("3.2a PROTOCOL_VERSION is 9", () => { expectSame(PROTOCOL_VERSION, 9, "reader PROTOCOL_VERSION"); });

  it.each(LANGUAGES)("3.2a accepts runCell in %s", (language) => {
    // The unknown-language check is the part that is new; a guard that ignores the language would accept both.
    expectSame([isWebviewMessage(run(language)), isWebviewMessage(run("julia"))], [true, false], `runCell ${language} checked`);
  });
  it("3.2a rejects runCell with an unknown language", () => { expectSame(isWebviewMessage(run("julia")), false, "runCell julia"); });
  it("3.2a rejects runCell without a language", () => {
    const { language: _language, ...without } = run("python");
    expectSame(isWebviewMessage(without), false, "runCell without language");
  });
  it("3.2a rejects runCell whose language is not a string", () => { expectSame(isWebviewMessage(run(3)), false, "runCell numeric language"); });

  it.each(LANGUAGES)("3.2b accepts restartCell in %s", (language) => { expectSame(isWebviewMessage({ command: "restartCell", language }), true, `restartCell ${language}`); });
  it("3.2b rejects restartCell with an unknown language", () => {
    expectSame(isWebviewMessage({ command: "restartCell", language: "r" }), true, "valid restartCell");
    expectSame(isWebviewMessage({ command: "restartCell", language: "julia" }), false, "restartCell julia");
  });
  it("3.2b rejects restartCell without a language", () => {
    expectSame(isWebviewMessage({ command: "restartCell", language: "r" }), true, "valid restartCell");
    expectSame(isWebviewMessage({ command: "restartCell" }), false, "restartCell without language");
  });

  it("3.2c the restart message exists for every cell language", () => {
    expectSame(LANGUAGES.map((language) => isWebviewMessage({ command: "restartCell", language })), [true, true, true], "restartCell for all languages");
  });
});

describe("reader host cells", () => {
  it.each(LANGUAGES)("3.2a passes %s and the key paper:<id> to the run port", async (language) => {
    const { host, requests } = setup(language);
    await host.handle(run(language));
    expectSame(requests, [{ code: "print(1)", language, noteKey: "paper:p1" }], `runCell ${language} request`);
  });

  it("3.2a keeps a key sent by the view out of the run request", async () => {
    const { host, requests } = setup("r");
    await host.handle({ ...run("r"), noteKey: "paper:other" });
    expectSame(requests, [{ code: "print(1)", language: "r", noteKey: "paper:p1" }], "host derives the key");
  });

  it.each(LANGUAGES)("3.2b restartCell reaches the restart port with paper:<id> and %s", async (language) => {
    const { host, restarts } = setup();
    await host.handle({ command: "restartCell", language });
    expectSame(restarts, [["paper:p1", language]], `restart ${language}`);
  });

  it("3.2b restartCell does not run any cell", async () => {
    const { host, requests, restarts } = setup();
    await host.handle({ command: "restartCell", language: "mathematica" });
    expectSame(restarts.length, 1, "restart happened");
    expectSame(requests, [], "no run");
  });

  it("3.2b a restartCell with an unknown language restarts nothing", async () => {
    const { host, restarts } = setup();
    await host.handle({ command: "restartCell", language: "julia" });
    // Without the message in the protocol nothing restarts either, so the valid restart must work first.
    await host.handle({ command: "restartCell", language: "r" });
    expectSame(restarts, [["paper:p1", "r"]], "only the valid restart");
  });
});
