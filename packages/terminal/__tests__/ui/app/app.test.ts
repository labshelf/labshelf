import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { AppContext } from "../../../src/app/context";
import * as system from "../../../src/platform/system";
import { ALL, App } from "../../../src/ui/app";
import {
  ATTENTION, BERT, EINSTEIN, FakeTerminal, LECUN, PAPERS, ZEBRA, eventually, folderDir, goToFolder, hoveredId, idle, ids, makeTmpRoot,
  openApp, pane, paperDir, press, readMeta, screenText, seedLibrary, writePaper, yamlOf,
} from "../../fixtures/appHarness";

jest.mock("../../../src/platform/system", () => ({
  ...jest.requireActual<typeof import("../../../src/platform/system")>("../../../src/platform/system"),
  openExternal: jest.fn(),
  revealInFileManager: jest.fn(),
  copyToClipboard: jest.fn(),
  runEditor: jest.fn(),
  trashSupported: jest.fn(),
  moveToTrash: jest.fn(),
}));

const mocked = {
  openExternal: jest.mocked(system.openExternal),
  revealInFileManager: jest.mocked(system.revealInFileManager),
  copyToClipboard: jest.mocked(system.copyToClipboard),
  runEditor: jest.mocked(system.runEditor),
  trashSupported: jest.mocked(system.trashSupported),
  moveToTrash: jest.mocked(system.moveToTrash),
};

let tmp: string;
let root: string;
let ctx: AppContext;
let term: FakeTerminal;
let app: App;

beforeEach(async () => {
  mocked.openExternal.mockReset();
  mocked.revealInFileManager.mockReset();
  mocked.copyToClipboard.mockReset().mockResolvedValue("system");
  mocked.runEditor.mockReset().mockReturnValue(true);
  mocked.trashSupported.mockReset().mockReturnValue(true);
  mocked.moveToTrash.mockReset().mockRejectedValue(new Error("the real trash must never be used by the tests"));
  ({ tmp, root } = await makeTmpRoot());
  await seedLibrary(root);
  ({ ctx, term, app } = await openApp(root, tmp));
});

afterEach(async () => {
  // Let background work (tasks, the log) finish before the folder disappears.
  await eventually(() => app.tasks.size === 0, "background tasks to finish at the end of the test", app).catch(() => undefined);
  await ctx.logger.log("INFO", "test", "done");
  await ctx.dispose();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("suspending with Ctrl-Z", () => {
  it("is refused while a sync runs (the lock would be held by a stopped process)", () => {
    const stopJob = jest.spyOn(term, "stopJob");
    jest.spyOn(ctx.sync, "status").mockReturnValue({ state: "syncing" });
    press(app, "C-z");
    expect(stopJob).not.toHaveBeenCalled();
    expect(app.message?.text).toContain("Wait for the sync");
  });

  it("suspends otherwise", () => {
    const stopJob = jest.spyOn(term, "stopJob");
    press(app, "C-z");
    expect(stopJob).toHaveBeenCalledTimes(1);
  });
});

describe("App initial frame", () => {
  it("shows the header, the folders, the papers and the preview of the first paper", () => {
    const text = screenText(app);
    expect(pane(app, "header")).toContain("LabShelf");
    expect(pane(app, "header")).toContain("All papers");
    expect(pane(app, "header")).toContain("library");
    for (const folder of ["All papers", "Unfiled", "Empty", "ML", "Transformers", "Physics"]) {
      expect(pane(app, "folders")).toContain(folder);
    }
    for (const title of ["Attention Is All You Need", "BERT: Pre-training", "Gradient-Based Learning", "On the Electrodynamics", "Zebra Study of Stripes"]) {
      expect(pane(app, "papers")).toContain(title);
    }
    expect(pane(app, "preview")).toContain("Attention Is All You Need");
    expect(pane(app, "preview")).toContain("Status ○ unread");
    expect(text).toContain("NORMAL");
  });

  it("starts on All papers with focus on the papers and nothing selected", () => {
    expect(app.focus).toBe("papers");
    expect(app.folder).toBe(ALL);
    expect(app.search).toBeUndefined();
    expect(app.filter).toBe("");
    expect(app.flatten).toBe(false);
    expect(app.selection.size).toBe(0);
    expect(app.previewTab).toBe(0);
    expect(app.overlay).toBeUndefined();
    expect(app.inline).toBeUndefined();
  });

  it("sorts the papers by title and hovers the first one", () => {
    expect(ids(app)).toEqual([ATTENTION, BERT, LECUN, EINSTEIN, ZEBRA]);
    expect(hoveredId(app)).toBe(ATTENTION);
    expect(pane(app, "status")).toContain("1/5");
    expect(pane(app, "status")).toContain("title↑");
  });

  it("lists All papers, Unfiled and then the folder tree with counts", () => {
    expect(app.folderRows()).toEqual([
      { key: ALL, label: "All papers", depth: 0, count: 5, pseudo: true },
      { key: "", label: "Unfiled", depth: 0, count: 1, pseudo: true },
      { key: "Empty", label: "Empty", depth: 0, count: 0 },
      { key: "ML", label: "ML", depth: 0, count: 3 },
      { key: "ML/Transformers", label: "Transformers", depth: 1, count: 2 },
      { key: "Physics", label: "Physics", depth: 0, count: 1 },
    ]);
  });

  it("shows the sync state and the help hint in the status bar", () => {
    expect(pane(app, "status")).toContain("Drive:");
    expect(pane(app, "status")).toContain("? help");
  });

  it("marks papers without a PDF on this device in the Info tab", () => {
    press(app, "G", "k");
    expect(hoveredId(app)).toBe(EINSTEIN);
    expect(pane(app, "preview")).toContain("PDF    not on this device");
  });

  it("draws a frame on the terminal after every input event", () => {
    const before = term.frames.length;
    press(app, "j");
    expect(term.frames.length).toBe(before + 1);
    expect(term.frames[term.frames.length - 1]!.toText()).toBe(screenText(app));
    press(app, "k");
    expect(term.frames.length).toBe(before + 2);
  });

  it("replaces every OS-level side effect, so the tests cannot open viewers or touch the trash", () => {
    expect(jest.isMockFunction(system.openExternal)).toBe(true);
    expect(jest.isMockFunction(system.copyToClipboard)).toBe(true);
    expect(jest.isMockFunction(system.moveToTrash)).toBe(true);
  });
});

describe("App reacting to changes made elsewhere", () => {
  it("shows a paper added on disk after the library reloads, and draws a new frame by itself", async () => {
    const frames = term.frames.length;
    await writePaper(root, { id: "new2021paper", folder: "Physics", title: "A Brand New Paper", year: 2021, pdf: true });
    await ctx.store.reload();
    await eventually(() => term.frames.length > frames, "a redraw", app);
    expect(app.folderRows().find((row) => row.key === "Physics")?.count).toBe(2);
    expect(pane(app, "papers")).toContain("A Brand New Paper");
  });

  it("reloads with R", async () => {
    await writePaper(root, { id: "new2021paper", folder: "", title: "A Brand New Paper", year: 2021, pdf: true });
    press(app, "R");
    await eventually(() => app.message?.text === "Library reloaded", "the reload", app);
    expect(pane(app, "papers")).toContain("A Brand New Paper");
    expect(pane(app, "folders")).toContain("Unfiled");
  });

  it("follows the hovered paper when the list changes under it", async () => {
    press(app, "j");
    expect(hoveredId(app)).toBe(BERT);
    await writePaper(root, { id: "aaa2000first", folder: "", title: "AAA Sorts First", year: 2000, pdf: true });
    await ctx.store.reload();
    expect(hoveredId(app)).toBe(BERT);
    expect(ids(app)[0]).toBe("aaa2000first");
    expect(pane(app, "status")).toContain("3/6");
  });

  it("falls back to the nearest existing folder when the current one is removed", async () => {
    goToFolder(app, "ML/Transformers");
    await fs.rm(folderDir(root, "ML/Transformers"), { recursive: true });
    await ctx.store.reload();
    expect(app.folder).toBe("ML");
    await fs.rm(folderDir(root, "ML"), { recursive: true });
    await ctx.store.reload();
    expect(app.folder).toBe(ALL);
  });

  it("leaves the Unfiled row when its last paper is removed", async () => {
    goToFolder(app, "");
    await fs.rm(paperDir(root, "", ZEBRA), { recursive: true });
    await ctx.store.reload();
    expect(app.folder).toBe(ALL);
  });

  it("shows an edit made by another app to a paper's metadata", async () => {
    await fs.writeFile(
      path.join(paperDir(root, "ML/Transformers", ATTENTION), "metadata.yaml"),
      yamlOf({ ...PAPERS[0]!, status: "done", tags: ["from-vscode"] }),
    );
    await ctx.store.reload();
    expect(pane(app, "preview")).toContain("Status ● done");
    expect(pane(app, "preview")).toContain("#from-vscode");
  });

  it("keeps a tag edit that VS Code made after the last scan when writing the status", async () => {
    await fs.writeFile(
      path.join(paperDir(root, "ML/Transformers", ATTENTION), "metadata.yaml"),
      yamlOf({ ...PAPERS[0]!, tags: ["edited-elsewhere"] }),
    );
    press(app, "m", "d");
    await idle(app);
    expect(await readMeta(root, "ML/Transformers", ATTENTION)).toMatchObject({ status: "done", tags: ["edited-elsewhere"] });
  });
});
