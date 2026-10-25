import { promises as fs } from "node:fs";

import type { AppContext } from "../../../../src/compositionRoot";
import * as system from "../../../../src/platform/system";
import { ALL, App } from "../../../../src/libraryUi/libraryScreen";
import {
  ATTENTION, BERT, LECUN, ZEBRA, goToFolder, hoveredId, idle, ids, makeTmpRoot, openApp, pane, press, seedLibrary,
} from "../../../fixtures/appHarness";

jest.mock("../../../../src/platform/system", () => ({
  ...jest.requireActual<typeof import("../../../../src/platform/system")>("../../../../src/platform/system"),
  openExternal: jest.fn(),
  revealInFileManager: jest.fn(),
  copyToClipboard: jest.fn(),
  runEditor: jest.fn(),
  trashSupported: jest.fn(),
  moveToTrash: jest.fn(),
}));

const mocked = {
  openExternal: jest.mocked(system.openExternal),
  moveToTrash: jest.mocked(system.moveToTrash),
};

let tmp: string;
let root: string;
let ctx: AppContext;
let app: App;

beforeEach(async () => {
  mocked.openExternal.mockReset();
  mocked.moveToTrash.mockReset().mockRejectedValue(new Error("the real trash must never be used by the tests"));
  ({ tmp, root } = await makeTmpRoot());
  await seedLibrary(root);
  ({ ctx, app } = await openApp(root, tmp));
});

afterEach(async () => {
  await idle(app).catch(() => undefined);
  await ctx.dispose();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("App papers pane navigation", () => {
  it("moves the cursor with j and k", () => {
    press(app, "j");
    expect(hoveredId(app)).toBe(BERT);
    expect(pane(app, "status")).toContain("2/5");
    expect(pane(app, "preview")).toContain("BERT: Pre-training of Deep Bidirectional");
    press(app, "k");
    expect(hoveredId(app)).toBe(ATTENTION);
  });

  it("accepts the arrow keys", () => {
    press(app, "down", "down");
    expect(hoveredId(app)).toBe(LECUN);
    press(app, "up");
    expect(hoveredId(app)).toBe(BERT);
  });

  it("stops at the first and the last paper", () => {
    press(app, "k", "k");
    expect(hoveredId(app)).toBe(ATTENTION);
    press(app, "G", "j", "j");
    expect(hoveredId(app)).toBe(ZEBRA);
    expect(pane(app, "status")).toContain("5/5");
  });

  it("jumps with G and gg", () => {
    press(app, "G");
    expect(hoveredId(app)).toBe(ZEBRA);
    press(app, "g", "g");
    expect(hoveredId(app)).toBe(ATTENTION);
    press(app, "end");
    expect(hoveredId(app)).toBe(ZEBRA);
    press(app, "home");
    expect(hoveredId(app)).toBe(ATTENTION);
  });

  it("moves by half pages and pages, clamped to the list", () => {
    press(app, "C-d");
    expect(hoveredId(app)).toBe(ZEBRA);
    press(app, "C-u");
    expect(hoveredId(app)).toBe(ATTENTION);
    press(app, "pagedown");
    expect(hoveredId(app)).toBe(ZEBRA);
    press(app, "pageup");
    expect(hoveredId(app)).toBe(ATTENTION);
  });

  it("shows which key sequences can follow a prefix while one is pending", () => {
    press(app, "g");
    expect(app.pending).toEqual(["g"]);
    expect(pane(app, "status")).toContain("g →");
    press(app, "g");
    expect(app.pending).toEqual([]);
    press(app, "m");
    expect(app.pending).toEqual(["m"]);
    expect(pane(app, "status")).toContain("m →");
    expect(pane(app, "status")).toContain("unread");
    expect(pane(app, "status")).toContain("reading");
    expect(pane(app, "status")).toContain("done");
  });

  it("goes back to All papers with ga", () => {
    goToFolder(app, "Physics");
    press(app, "l");
    expect(app.folder).toBe("Physics");
    press(app, "g", "a");
    expect(app.folder).toBe(ALL);
    expect(app.focus).toBe("papers");
  });

  it("scrolls the preview with J and K and resets the scroll when the paper changes", () => {
    press(app, "J");
    expect(app.previewScroll).toBe(3);
    expect(pane(app, "preview")).not.toContain("Attention Is All You Need");
    press(app, "K");
    expect(app.previewScroll).toBe(0);
    press(app, "K");
    expect(app.previewScroll).toBe(0);
    expect(pane(app, "preview")).toContain("Attention Is All You Need");
    press(app, "J", "j");
    expect(app.previewScroll).toBe(0);
  });
});

describe("App folders pane", () => {
  it("moves focus to the folders with h and back to the papers with l", () => {
    press(app, "h");
    expect(app.focus).toBe("folders");
    expect(pane(app, "status")).toContain("folder 1/6");
    press(app, "l");
    expect(app.focus).toBe("papers");
  });

  it("selects a folder with j and the papers pane follows", () => {
    press(app, "h", "j");
    expect(app.folder).toBe("");
    expect(pane(app, "papers")).toContain("Zebra Study of Stripes");
    expect(pane(app, "papers")).not.toContain("Attention Is All You Need");
    press(app, "j");
    expect(app.folder).toBe("Empty");
    expect(pane(app, "papers")).toContain("No papers here.");
    press(app, "j");
    expect(app.folder).toBe("ML");
    expect(pane(app, "papers")).toContain("Gradient-Based Learning");
    expect(pane(app, "papers")).not.toContain("Attention Is All You Need");
    press(app, "j");
    expect(app.folder).toBe("ML/Transformers");
    expect(pane(app, "papers")).toContain("Attention Is All You Need");
    expect(pane(app, "papers")).toContain("BERT: Pre-training");
    expect(pane(app, "papers")).not.toContain("Gradient-Based Learning");
    expect(pane(app, "status")).toContain("folder 5/6");
  });

  it("shows the hovered folder's summary in the preview", () => {
    press(app, "h", "j", "j", "j");
    expect(app.folder).toBe("ML");
    const preview = pane(app, "preview");
    expect(preview).toContain("3 papers · 1 subfolder");
    expect(preview).toContain("Transformers/ 2");
    expect(preview).toContain("Gradient-Based Learning");
  });

  it("shows a library overview in the preview while All papers is hovered", () => {
    press(app, "h");
    const preview = pane(app, "preview");
    expect(preview).toContain("Library");
    expect(preview).toContain("5 papers");
    expect(preview).toContain("4 with PDF");
  });

  it("moves back up with k and stops at the ends", () => {
    press(app, "h", "j", "j", "k");
    expect(app.folder).toBe("");
    press(app, "k", "k");
    expect(app.folder).toBe(ALL);
    press(app, "G");
    expect(app.folder).toBe("Physics");
    press(app, "j");
    expect(app.folder).toBe("Physics");
    press(app, "g", "g");
    expect(app.folder).toBe(ALL);
  });

  it("climbs to the parent folder with h and ends at All papers", () => {
    goToFolder(app, "ML/Transformers");
    expect(app.folder).toBe("ML/Transformers");
    press(app, "h");
    expect(app.folder).toBe("ML");
    press(app, "h");
    expect(app.folder).toBe(ALL);
    press(app, "h");
    expect(app.folder).toBe(ALL);
    expect(app.focus).toBe("folders");
  });

  it("lands on the first paper of the folder when returning to the papers pane", () => {
    goToFolder(app, "ML/Transformers");
    press(app, "l");
    expect(app.focus).toBe("papers");
    expect(hoveredId(app)).toBe(ATTENTION);
  });

  it("shows the folder path in the header", () => {
    goToFolder(app, "ML/Transformers");
    expect(pane(app, "header")).toContain("ML › Transformers");
  });

  it("remembers the cursor of each folder", () => {
    goToFolder(app, "ML/Transformers");
    press(app, "l", "j");
    expect(hoveredId(app)).toBe(BERT);
    press(app, "h", "k");
    expect(app.folder).toBe("ML");
    press(app, "j");
    expect(app.folder).toBe("ML/Transformers");
    press(app, "l");
    expect(hoveredId(app)).toBe(BERT);
  });

  it("toggles the papers of subfolders with a dot", () => {
    goToFolder(app, "ML");
    press(app, "l");
    expect(ids(app)).toEqual([LECUN]);
    press(app, ".");
    expect(app.flatten).toBe(true);
    expect(ids(app)).toEqual([ATTENTION, BERT, LECUN]);
    expect(pane(app, "header")).toContain("+ subfolders");
    expect(pane(app, "status")).toContain("Including papers from subfolders");
    press(app, ".");
    expect(app.flatten).toBe(false);
    expect(ids(app)).toEqual([LECUN]);
    expect(pane(app, "header")).not.toContain("+ subfolders");
    expect(pane(app, "status")).toContain("Showing only the papers directly in each folder");
  });

  it("names the folder each paper lives in when listing several folders at once", () => {
    expect(pane(app, "papers")).toContain("Transformers");
    expect(pane(app, "papers")).toContain("Physics");
    expect(pane(app, "papers")).toContain("unfiled");
  });
});
