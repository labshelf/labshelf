/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Pins how a paper's notes tab hands the page's From paper… port to the note editor: starting on that paper, with the
// note's files so images land beside the note. The project note tab loads through a dynamic import, which this jest
// run cannot execute (projectNoteTab.test.ts fails the same way), so its wiring is not run here.
import type { ILogger, PaperObjectsPort } from "@labshelf/core";
import type { TabContext } from "../../../src/libraryUi/editorArea/tabKinds";
import { mountPaperNoteTab } from "../../../src/libraryUi/editorArea/noteFileTab";

const mounts: Array<Record<string, unknown>> = [];
jest.mock("@labshelf/core/dom", () => ({
  ...jest.requireActual("@labshelf/core/dom"),
  mountNoteFile: (_el: HTMLElement, options: Record<string, unknown>) => { mounts.push(options); return { editors: [], update: () => undefined, destroy: () => undefined }; },
}));
jest.mock("../../../src/helper", () => ({
  getBrowserCellPorts: () => ({ runCell: jest.fn(), runCellIn: () => jest.fn(), restartCell: jest.fn(), runMath: undefined, installPython: jest.fn() }),
}));
jest.mock("../../../src/storage", () => ({
  ...jest.requireActual("../../../src/storage"),
  createPaperNotesPort: () => ({}),
}));
jest.mock("@labshelf/core", () => {
  const actual = jest.requireActual("@labshelf/core");
  return { ...actual, PaperNotesStore: class { async read() { return { segments: [] }; } } };
});

const logger: ILogger = { log: async () => undefined, error: async () => undefined };
const port: PaperObjectsPort = { papers: jest.fn(), list: jest.fn(), preview: jest.fn(), insert: jest.fn() };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function context(withPort: boolean): TabContext {
  return {
    logger, fs: {}, tab: { setDirty: jest.fn(), onBeforeClose: jest.fn() },
    ...(withPort ? { paperObjects: port } : {}),
  } as unknown as TabContext;
}

async function mounted(mount: () => unknown): Promise<Record<string, unknown>> {
  mounts.length = 0;
  mount();
  for (let i = 0; i < 100 && mounts.length === 0; i++) await wait(10);
  expect(mounts).toHaveLength(1);
  return mounts[0]!;
}

describe("note tabs and From paper…", () => {
  it("gives a paper's notes the page's port starting on that paper, beside its files", async () => {
    const options = await mounted(() => mountPaperNoteTab(document.createElement("div"), { paperId: "paper-1" }, context(true)));
    expect(options["paperObjects"]).toEqual({ port, defaultPaperId: "paper-1" });
    expect(options["files"]).toBeDefined();
  });

  it("offers no From paper… when the page has no port", async () => {
    const options = await mounted(() => mountPaperNoteTab(document.createElement("div"), { paperId: "paper-1" }, context(false)));
    expect(options["paperObjects"]).toBeUndefined();
  });
});
