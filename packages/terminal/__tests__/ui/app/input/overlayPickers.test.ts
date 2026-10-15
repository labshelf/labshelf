import { promises as fs } from "node:fs";

import type { AppContext } from "../../../../src/app/context";
import { ALL, App } from "../../../../src/ui/app";
import { BERT, hoveredId, idle, makeTmpRoot, openApp, press, screenText, seedLibrary, typeText } from "../../../fixtures/appHarness";

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

describe("App folder history and jumps", () => {
  it("opens a folder picker with z and jumps to the chosen folder", () => {
    press(app, "z");
    expect(app.overlay?.kind).toBe("picker");
    expect(screenText(app)).toContain("Jump to folder (6)");
    typeText(app, "phys");
    expect(screenText(app)).toContain("Jump to folder (1)");
    press(app, "enter");
    expect(app.overlay).toBeUndefined();
    expect(app.folder).toBe("Physics");
    expect(app.focus).toBe("papers");
  });

  it("matches folder names fuzzily, subfolders by their full path", () => {
    press(app, "z");
    typeText(app, "trns");
    press(app, "enter");
    expect(app.folder).toBe("ML/Transformers");
  });

  it("moves through the picker with the arrow keys", () => {
    press(app, "z", "down", "down", "enter");
    expect(app.folder).toBe("ML");
    press(app, "z", "down", "down", "down", "up", "enter");
    expect(app.folder).toBe("ML");
  });

  it("includes All papers and the library root in the picker", () => {
    press(app, "z");
    expect(screenText(app)).toContain("All papers");
    expect(screenText(app)).toContain("Library root (unfiled)");
    typeText(app, "unfiled");
    press(app, "enter");
    expect(app.folder).toBe("");
  });

  it("closes the picker with Esc without moving", () => {
    press(app, "z", "esc");
    expect(app.overlay).toBeUndefined();
    expect(app.folder).toBe(ALL);
  });

  it("says when nothing matches in the picker", () => {
    press(app, "z");
    typeText(app, "qqqq");
    expect(screenText(app)).toContain("No match");
    press(app, "enter");
    expect(app.folder).toBe(ALL);
  });

  it("jumps to a paper with Z and reveals it in its folder", () => {
    press(app, "Z");
    expect(app.overlay?.kind).toBe("picker");
    expect(screenText(app)).toContain("Jump to paper (5)");
    typeText(app, "bert");
    press(app, "enter");
    expect(app.folder).toBe("ML/Transformers");
    expect(hoveredId(app)).toBe(BERT);
    expect(app.focus).toBe("papers");
  });
});
