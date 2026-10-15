import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { AppContext } from "../../../../src/app/context";
import * as system from "../../../../src/platform/system";
import { App } from "../../../../src/ui/app";
import {
  ATTENTION, BERT, EINSTEIN, ZEBRA, exists, folderDir, goToFolder, highlight, idle, ids, makeTmpRoot, openApp, pane, paperDir, press,
  screenText, seedLibrary, typeText, writeSidecar,
} from "../../../fixtures/appHarness";

jest.mock("../../../../src/platform/system", () => ({
  ...jest.requireActual<typeof import("../../../../src/platform/system")>("../../../../src/platform/system"),
  trashSupported: jest.fn(),
  moveToTrash: jest.fn(),
  openExternal: jest.fn(),
}));

const mocked = {
  trashSupported: jest.mocked(system.trashSupported),
  moveToTrash: jest.mocked(system.moveToTrash),
  openExternal: jest.mocked(system.openExternal),
};

let tmp: string;
let root: string;
let ctx: AppContext;
let app: App;

beforeEach(async () => {
  mocked.trashSupported.mockReset().mockReturnValue(true);
  mocked.moveToTrash.mockReset().mockRejectedValue(new Error("the real trash must never be used by the tests"));
  mocked.openExternal.mockReset();
  ({ tmp, root } = await makeTmpRoot());
  await seedLibrary(root);
  ({ ctx, app } = await openApp(root, tmp));
});

afterEach(async () => {
  await idle(app).catch(() => undefined);
  await ctx.dispose();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("App cut and paste (x, p)", () => {
  it("moves a paper folder on disk to the folder hovered when p is pressed", async () => {
    press(app, "G", "x");
    expect(app.cut).toEqual([`p:${ZEBRA}`]);
    expect(app.message?.text).toBe("1 paper cut — go to a folder and press p");
    expect(pane(app, "status")).toContain("1 cut");
    press(app, "h", "j", "j");
    expect(app.folder).toBe("Empty");
    press(app, "p");
    await idle(app);
    expect(await exists(path.join(paperDir(root, "Empty", ZEBRA), "metadata.yaml"))).toBe(true);
    expect(await exists(paperDir(root, "", ZEBRA))).toBe(false);
    expect(app.cut).toBeUndefined();
    expect(app.message?.text).toBe("1 item moved to Empty");
  });

  it("keeps the paper's files together when it moves", async () => {
    press(app, "G", "x", "h", "j", "j", "p");
    await idle(app);
    expect((await fs.readdir(paperDir(root, "Empty", ZEBRA))).sort()).toEqual(["metadata.yaml", "paper.pdf"]);
  });

  it("removes the Unfiled row once the last unfiled paper is gone", async () => {
    press(app, "G", "x", "h", "j", "j", "p");
    await idle(app);
    expect(app.folderRows().map((row) => row.key)).not.toContain("");
    expect(pane(app, "folders")).not.toContain("Unfiled");
    expect(pane(app, "folders")).toContain("Empty");
  });

  it("moves several selected papers", async () => {
    press(app, "space", "space", "x");
    expect(app.cut).toEqual([`p:${ATTENTION}`, `p:${BERT}`]);
    expect(app.selection.size).toBe(0);
    goToFolder(app, "Physics");
    press(app, "p");
    await idle(app);
    expect(await exists(paperDir(root, "Physics", ATTENTION))).toBe(true);
    expect(await exists(paperDir(root, "Physics", BERT))).toBe(true);
    expect(app.message?.text).toBe("2 items moved to Physics");
    expect(ids(app).sort()).toEqual([ATTENTION, BERT, EINSTEIN].sort());
  });

  it("keeps the sidecar and the paper's contents when moving", async () => {
    await writeSidecar(root, ZEBRA, [highlight(ZEBRA, 1, "kept")]);
    press(app, "G", "x", "h", "j", "j", "p");
    await idle(app);
    expect(await exists(path.join(root, ".research", "papers", ZEBRA, "data.json"))).toBe(true);
  });

  it("marks the cut paper in the list", () => {
    press(app, "G", "x");
    const rows = pane(app, "papers").split("\n");
    expect(rows[4]!.startsWith("▌")).toBe(true);
  });

  it("clears the cut with Esc", () => {
    press(app, "x");
    expect(app.cut).toBeDefined();
    press(app, "esc");
    expect(app.cut).toBeUndefined();
    expect(app.message?.text).toBe("Cut cleared");
  });

  it("refuses to paste into All papers and keeps the cut", () => {
    press(app, "x", "p");
    expect(app.message?.text).toContain("Choose a folder to paste into");
    expect(app.message?.level).toBe("warn");
    expect(app.cut).toEqual([`p:${ATTENTION}`]);
  });

  it("explains that there is nothing to paste", () => {
    press(app, "p");
    expect(app.message?.text).toBe("Nothing to paste — cut papers or a folder with x first");
  });

  it("moves a whole folder when a folder is cut", async () => {
    goToFolder(app, "Empty");
    press(app, "x");
    expect(app.cut).toEqual(["c:Empty"]);
    expect(app.message?.text).toContain('Folder "Empty" cut');
    press(app, "j", "j", "j");
    expect(app.folder).toBe("Physics");
    press(app, "p");
    await idle(app);
    expect(await exists(folderDir(root, "Physics/Empty"))).toBe(true);
    expect(await exists(folderDir(root, "Empty"))).toBe(false);
    expect(app.folder).toBe("Physics/Empty");
  });

  it("refuses to move a folder into itself", async () => {
    goToFolder(app, "ML");
    press(app, "x", "j");
    expect(app.folder).toBe("ML/Transformers");
    press(app, "p");
    await idle(app);
    expect(app.message?.level).toBe("error");
    expect(app.message?.text).toContain("cannot be moved into itself");
    expect(await exists(folderDir(root, "ML/Transformers"))).toBe(true);
  });

  it("does not cut the Unfiled pseudo folder", () => {
    goToFolder(app, "");
    press(app, "x");
    expect(app.cut).toBeUndefined();
    expect(app.message?.text).toBe("The library root cannot be moved");
  });

  it("drops a cut paper that disappears from the library", async () => {
    press(app, "x");
    await fs.rm(paperDir(root, "ML/Transformers", ATTENTION), { recursive: true });
    await ctx.store.reload();
    expect(app.cut).toBeUndefined();
  });
});

describe("App move to folder (M)", () => {
  it("opens a folder picker and moves the selected papers", async () => {
    press(app, "G", "M");
    expect(app.overlay?.kind).toBe("picker");
    expect(screenText(app)).toContain("Move 1 paper to");
    expect(screenText(app)).not.toContain("All papers (");
    typeText(app, "empty");
    press(app, "enter");
    await idle(app);
    expect(await exists(path.join(paperDir(root, "Empty", ZEBRA), "metadata.yaml"))).toBe(true);
    expect(await exists(paperDir(root, "", ZEBRA))).toBe(false);
  });

  it("moves papers to the library root", async () => {
    press(app, "M");
    typeText(app, "unfiled");
    press(app, "enter");
    await idle(app);
    expect(await exists(path.join(paperDir(root, "", ATTENTION), "metadata.yaml"))).toBe(true);
  });

  it("moves a hovered folder", async () => {
    goToFolder(app, "Empty");
    press(app, "M");
    expect(screenText(app)).toContain('Move folder "Empty" to');
    typeText(app, "physics");
    press(app, "enter");
    await idle(app);
    expect(await exists(folderDir(root, "Physics/Empty"))).toBe(true);
  });

  it("does not offer a folder as its own destination", () => {
    goToFolder(app, "ML");
    press(app, "M");
    typeText(app, "transformers");
    expect(screenText(app)).toContain("No match");
  });
});

describe("App trash (d) asks for confirmation", () => {
  it("shows the confirmation for the hovered paper and cancels with n", async () => {
    press(app, "d");
    expect(app.overlay?.kind).toBe("confirm");
    const text = screenText(app);
    expect(text).toContain("Move to trash");
    expect(text).toContain('Move "Attention Is All You Need" to the trash?');
    expect(text).toContain("The next sync removes them from Drive and from VS Code too.");
    expect(text).toContain("y confirm");
    press(app, "n");
    expect(app.overlay).toBeUndefined();
    expect(await exists(path.join(paperDir(root, "ML/Transformers", ATTENTION), "metadata.yaml"))).toBe(true);
    expect(ids(app)).toHaveLength(5);
    expect(mocked.moveToTrash).not.toHaveBeenCalled();
  });

  it("cancels with Esc too", () => {
    press(app, "d", "esc");
    expect(app.overlay).toBeUndefined();
    expect(ids(app)).toHaveLength(5);
  });

  it("names the number of papers when several are selected", () => {
    press(app, "space", "space", "d");
    expect(screenText(app)).toContain("Move 2 papers to the trash?");
    press(app, "n");
    expect(app.selection.size).toBe(2);
    expect(mocked.moveToTrash).not.toHaveBeenCalled();
  });

  it("asks about the whole folder when a folder is hovered", () => {
    goToFolder(app, "Physics");
    press(app, "d");
    expect(screenText(app)).toContain('Move folder "Physics" and its 1 paper to the trash?');
    press(app, "n");
    expect(app.overlay).toBeUndefined();
    expect(app.folder).toBe("Physics");
    goToFolder(app, "ML");
    press(app, "d");
    expect(screenText(app)).toContain('Move folder "ML" and its 3 papers to the trash?');
    press(app, "n");
    expect(mocked.moveToTrash).not.toHaveBeenCalled();
  });

  it("ignores other keys while the confirmation is open", () => {
    press(app, "d", "j", "G", "x", "q");
    expect(app.overlay).toBeUndefined();
    press(app, "d", "j", "o");
    expect(app.overlay?.kind).toBe("confirm");
    press(app, "esc");
    expect(mocked.openExternal).not.toHaveBeenCalled();
  });

  it("reports when the platform cannot trash", () => {
    mocked.trashSupported.mockReturnValue(false);
    press(app, "d");
    expect(app.overlay).toBeUndefined();
    expect(app.message?.text).toBe("Moving to the trash is not supported on this system");
    expect(app.message?.level).toBe("error");
  });

  it("does nothing in the folders pane at All papers", () => {
    press(app, "h", "d");
    expect(app.overlay).toBeUndefined();
    expect(app.message?.text).toBe("Move to the papers (l) or select some first");
  });
});
