import { promises as fs } from "node:fs";

import type { AppContext } from "../../../../src/app/context";
import { App } from "../../../../src/ui/app";
import { BERT, click, hoveredId, idle, makeTmpRoot, openApp, press, screenText, seedLibrary } from "../../../fixtures/appHarness";

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

describe("App unknown and interrupted key sequences", () => {
  it("ignores an unbound key", () => {
    const before = screenText(app);
    press(app, "w");
    expect(app.pending).toEqual([]);
    expect(screenText(app)).toBe(before);
    expect(app.overlay).toBeUndefined();
  });

  it("ignores an unbound continuation of a prefix", () => {
    const before = screenText(app);
    press(app, "g", "q");
    expect(app.pending).toEqual([]);
    expect(screenText(app)).toBe(before);
    press(app, "m", "q");
    expect(app.pending).toEqual([]);
  });

  it("treats the key that broke a sequence as a fresh key", () => {
    press(app, "g", "j");
    expect(hoveredId(app)).toBe(BERT);
  });

  it("cancels a pending prefix with Esc without clearing the selection", () => {
    press(app, "space");
    press(app, "m", "esc");
    expect(app.pending).toEqual([]);
    expect(app.selection.size).toBe(1);
  });

  it("ignores unbound special keys and mouse buttons other than the left one", () => {
    const before = screenText(app);
    press(app, "f12", "insert", "delete", "C-x", "M-x");
    click(app, 30, 3, 2);
    expect(screenText(app)).toBe(before);
  });
});
