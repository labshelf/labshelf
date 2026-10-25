import { promises as fs } from "node:fs";

import type { AppContext } from "../../../../src/compositionRoot";
import { App } from "../../../../src/libraryUi/libraryScreen";
import {
  ZEBRA, exists, folderDir, goToFolder, idle, makeTmpRoot, openApp, papersDir, press, screenText, seedLibrary, typeText,
} from "../../../fixtures/appHarness";

let tmp: string;
let root: string;
let ctx: AppContext;
let app: App;

beforeEach(async () => {
  ({ tmp, root } = await makeTmpRoot());
  await seedLibrary(root);
  ({ ctx, app } = await openApp(root, tmp));
});

afterEach(async () => {
  await idle(app).catch(() => undefined);
  await ctx.dispose();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("App new folder (a)", () => {
  it("creates a folder on disk from the folders pane", async () => {
    press(app, "h", "a");
    expect(app.overlay?.kind).toBe("prompt");
    expect(screenText(app)).toContain("New folder in the library root");
    typeText(app, "Chemistry");
    press(app, "enter");
    await idle(app);
    expect((await fs.stat(folderDir(root, "Chemistry"))).isDirectory()).toBe(true);
    expect(app.folder).toBe("Chemistry");
    expect(app.focus).toBe("folders");
    expect(app.message?.text).toBe('Folder "Chemistry" created');
  });

  it("creates the folder inside the hovered folder", async () => {
    goToFolder(app, "ML");
    press(app, "a");
    expect(screenText(app)).toContain("New folder in ML");
    typeText(app, "Deep Learning");
    press(app, "enter");
    await idle(app);
    expect((await fs.stat(folderDir(root, "ML/Deep Learning"))).isDirectory()).toBe(true);
    expect(app.folder).toBe("ML/Deep Learning");
  });

  it("creates a folder from the papers pane when the name ends with a slash", async () => {
    press(app, "a");
    expect(screenText(app)).toContain("Add a paper to the library root");
    expect(screenText(app)).toContain("PDF or folder path");
    typeText(app, "Chemistry/");
    press(app, "enter");
    await idle(app);
    expect((await fs.stat(folderDir(root, "Chemistry"))).isDirectory()).toBe(true);
  });

  it("names the target folder in the papers pane prompt", () => {
    goToFolder(app, "Physics");
    press(app, "l", "a");
    expect(screenText(app)).toContain("Add a paper to Physics");
  });

  it("rejects a name with slashes", async () => {
    press(app, "h", "a");
    typeText(app, "bad/name");
    press(app, "enter");
    await idle(app);
    expect(app.message?.text).toBe("Use a name without slashes.");
    expect(app.message?.level).toBe("error");
    expect(await exists(folderDir(root, "bad"))).toBe(false);
  });

  it("rejects a hidden folder name", async () => {
    press(app, "h", "a");
    typeText(app, ".hidden");
    press(app, "enter");
    await idle(app);
    expect(app.message?.text).toBe("A collection name cannot start with a dot.");
    expect(await exists(folderDir(root, ".hidden"))).toBe(false);
  });

  it("rejects a name that already exists", async () => {
    press(app, "h", "a");
    typeText(app, "ML");
    press(app, "enter");
    await idle(app);
    expect(app.message?.text).toBe('"ML" already exists');
    expect(app.message?.level).toBe("error");
  });

  it("does nothing for an empty name", async () => {
    press(app, "h", "a", "enter");
    expect(app.overlay).toBeUndefined();
    expect(app.tasks.size).toBe(0);
    expect(app.message).toBeUndefined();
    expect((await fs.readdir(papersDir(root))).sort()).toEqual(["Empty", "ML", "Physics", ZEBRA]);
  });

  it("closes the prompt with Esc without creating anything", async () => {
    press(app, "h", "a");
    typeText(app, "Nope");
    press(app, "esc");
    expect(app.overlay).toBeUndefined();
    expect(await exists(folderDir(root, "Nope"))).toBe(false);
  });

  it("accepts a pasted name", async () => {
    press(app, "h", "a");
    app.handle({ type: "paste", text: "Pasted Folder\n" });
    press(app, "enter");
    await idle(app);
    expect(await exists(folderDir(root, "Pasted Folder"))).toBe(true);
  });

  it("reports an input that is neither a file, a URL nor an identifier", async () => {
    press(app, "a");
    typeText(app, "not a paper");
    press(app, "enter");
    await idle(app);
    expect(app.message?.level).toBe("warn");
    expect(app.message?.text).toContain("1 failed");
  });
});

describe("App rename (r)", () => {
  it("renames the hovered folder on disk", async () => {
    goToFolder(app, "Physics");
    press(app, "r");
    expect(screenText(app)).toContain("Rename folder");
    expect(app.overlay?.kind === "prompt" && app.overlay.input.value).toBe("Physics");
    press(app, "C-u");
    typeText(app, "Physik");
    press(app, "enter");
    await idle(app);
    expect(await exists(folderDir(root, "Physik"))).toBe(true);
    expect(await exists(folderDir(root, "Physics"))).toBe(false);
    expect(app.folder).toBe("Physik");
    expect(app.message?.text).toBe('Renamed to "Physik"');
  });

  it("renames a subfolder within its parent", async () => {
    goToFolder(app, "ML/Transformers");
    press(app, "r", "C-u");
    typeText(app, "Attention");
    press(app, "enter");
    await idle(app);
    expect(app.folder).toBe("ML/Attention");
  });

  it("keeps the old name when the new one already exists", async () => {
    goToFolder(app, "Physics");
    press(app, "r", "C-u");
    typeText(app, "ML");
    press(app, "enter");
    await idle(app);
    expect(app.message?.text).toBe('"ML" already exists there');
    expect(await exists(folderDir(root, "Physics"))).toBe(true);
  });

  it("explains that paper titles are not renamed", () => {
    press(app, "r");
    expect(app.overlay).toBeUndefined();
    expect(app.message?.text).toContain("Paper titles stay as resolved");
  });

  it("asks to hover a folder at All papers and Unfiled", () => {
    press(app, "h", "r");
    expect(app.message?.text).toBe("Hover a folder to rename it");
    goToFolder(app, "");
    press(app, "r");
    expect(app.message?.text).toBe("Hover a folder to rename it");
  });
});
