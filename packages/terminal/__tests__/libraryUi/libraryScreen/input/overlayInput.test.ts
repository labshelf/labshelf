import { promises as fs } from "node:fs";

import type { AppContext } from "../../../../src/compositionRoot";
import { App } from "../../../../src/libraryUi/libraryScreen";
import { helpRows } from "../../../../src/libraryUi/overlays";
import {
  ATTENTION, click, hoveredId, idle, makeTmpRoot, openApp, press, screenText, seedLibrary, typeText, wheel,
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

describe("App help (?)", () => {
  it("shows the key help and Esc closes it", () => {
    press(app, "?");
    expect(app.overlay?.kind).toBe("help");
    expect(screenText(app)).toContain("LabShelf keys");
    expect(screenText(app)).toContain("Navigate");
    expect(screenText(app)).toContain("Move down");
    press(app, "esc");
    expect(app.overlay).toBeUndefined();
  });

  it("closes with ?, q and Enter as well", () => {
    for (const key of ["?", "q", "enter"]) {
      press(app, "?");
      expect(app.overlay?.kind).toBe("help");
      press(app, key);
      expect(app.overlay).toBeUndefined();
    }
  });

  it("opens with F1", () => {
    press(app, "f1");
    expect(app.overlay?.kind).toBe("help");
  });

  it("scrolls with j and k and pages with space", () => {
    const target = helpRows().findIndex((row) => row.keys === "m d");
    const pages = Math.floor(target / 10);
    press(app, "?");
    expect(screenText(app)).not.toContain("Mark done");
    for (let i = 0; i < target; i++) { press(app, "j"); }
    expect(screenText(app)).toContain("Mark done");
    for (let i = 0; i < target; i++) { press(app, "k"); }
    expect(screenText(app)).not.toContain("Mark done");
    for (let i = 0; i < pages; i++) { press(app, "space"); }
    expect(screenText(app)).toContain("Mark done");
    for (let i = 0; i < pages; i++) { press(app, "C-u"); }
    expect(screenText(app)).not.toContain("Mark done");
  });

  it("does not move the list while open", () => {
    press(app, "?", "j", "j", "esc");
    expect(hoveredId(app)).toBe(ATTENTION);
  });

  it("opens from the command line too", () => {
    press(app, ":");
    typeText(app, "help");
    press(app, "enter");
    expect(app.overlay?.kind).toBe("help");
  });
});

describe("App overlays and input routing", () => {
  it("routes pasted text to an open prompt", () => {
    press(app, "h", "a");
    app.handle({ type: "paste", text: "line one\nline two" });
    expect(app.overlay?.kind === "prompt" && app.overlay.input.value).toBe("line one line two");
  });

  it("ignores pasted text in normal mode", () => {
    const before = screenText(app);
    app.handle({ type: "paste", text: "hello" });
    expect(screenText(app)).toBe(before);
  });

  it("ignores the mouse while an overlay is open", () => {
    press(app, "?");
    click(app, 30, 3);
    wheel(app, "wheel-down", 30, 3);
    expect(app.overlay?.kind).toBe("help");
    press(app, "esc");
    expect(hoveredId(app)).toBe(ATTENTION);
  });

  it("closes a prompt with C-c", () => {
    press(app, ":", "C-c");
    expect(app.overlay).toBeUndefined();
  });

  it("shows prompt text edits made with the readline keys", () => {
    press(app, ":");
    typeText(app, "hello world");
    press(app, "C-w");
    expect(app.overlay?.kind === "prompt" && app.overlay.input.value).toBe("hello ");
    press(app, "C-a");
    typeText(app, ">");
    expect(app.overlay?.kind === "prompt" && app.overlay.input.value).toBe(">hello ");
  });
});
