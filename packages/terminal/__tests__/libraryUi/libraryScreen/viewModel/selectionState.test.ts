import { promises as fs } from "node:fs";

import type { AppContext } from "../../../../src/compositionRoot";
import * as system from "../../../../src/platform/system";
import { App } from "../../../../src/libraryUi/libraryScreen";
import { ATTENTION, BERT, LECUN, ZEBRA, idle, makeTmpRoot, openApp, pane, paperDir, press, seedLibrary } from "../../../fixtures/appHarness";

jest.mock("../../../../src/platform/system", () => ({
  ...jest.requireActual<typeof import("../../../../src/platform/system")>("../../../../src/platform/system"),
  openExternal: jest.fn(),
  showInFileSystem: jest.fn(),
  copyToClipboard: jest.fn(),
  runEditor: jest.fn(),
  canTrash: jest.fn(),
  moveToTrash: jest.fn(),
}));

const mocked = { moveToTrash: jest.mocked(system.moveToTrash) };

let tmp: string;
let root: string;
let ctx: AppContext;
let app: App;

beforeEach(async () => {
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

describe("App selection", () => {
  it("selects the hovered paper with space and moves to the next one", () => {
    press(app, "space");
    expect([...app.selection]).toEqual([ATTENTION]);
    expect(app.hoveredPaper()?.record.id).toBe(BERT);
    expect(pane(app, "status")).toContain("1 selected");
    expect(pane(app, "papers").split("\n")[0]!.startsWith("▌")).toBe(true);
    press(app, "space");
    expect([...app.selection]).toEqual([ATTENTION, BERT]);
    expect(pane(app, "status")).toContain("2 selected");
  });

  it("unselects a selected paper when space is pressed on it again", () => {
    press(app, "space", "k", "space");
    expect(app.selection.size).toBe(0);
    expect(pane(app, "status")).not.toContain("selected");
  });

  it("selects a range in visual mode and leaves it with Esc", () => {
    press(app, "v");
    expect(pane(app, "status")).toContain("VISUAL");
    press(app, "j", "j");
    expect([...app.selection].sort()).toEqual([ATTENTION, BERT, LECUN].sort());
    press(app, "k");
    expect([...app.selection].sort()).toEqual([ATTENTION, BERT].sort());
    press(app, "esc");
    expect(pane(app, "status")).not.toContain("VISUAL");
    expect(app.selection.size).toBe(2);
    press(app, "esc");
    expect(app.selection.size).toBe(0);
  });

  it("leaves visual mode with v again, keeping the selection", () => {
    press(app, "v", "j", "v");
    expect(pane(app, "status")).not.toContain("VISUAL");
    expect(app.selection.size).toBe(2);
  });

  it("selects everything with C-a and clears it with Esc", () => {
    press(app, "C-a");
    expect(app.selection.size).toBe(5);
    expect(pane(app, "status")).toContain("5 selected");
    press(app, "esc");
    expect(app.selection.size).toBe(0);
  });

  it("only selects while the papers pane has focus", () => {
    press(app, "h", "space", "C-a", "v");
    expect(app.selection.size).toBe(0);
  });

  it("drops papers that disappear from the library from the selection", async () => {
    press(app, "G", "space");
    expect([...app.selection]).toEqual([ZEBRA]);
    await fs.rm(paperDir(root, "", ZEBRA), { recursive: true });
    await ctx.store.reload();
    expect(app.selection.size).toBe(0);
  });
});
