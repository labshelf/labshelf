import { promises as fs } from "node:fs";

import type { AppContext } from "../../../../src/compositionRoot";
import * as system from "../../../../src/platform/system";
import { ALL, App } from "../../../../src/libraryUi/libraryScreen";
import { ATTENTION, BERT, EINSTEIN, LECUN, click, hoveredId, idle, makeTmpRoot, openApp, seedLibrary, wheel } from "../../../fixtures/appHarness";

jest.mock("../../../../src/platform/system", () => ({
  ...jest.requireActual<typeof import("../../../../src/platform/system")>("../../../../src/platform/system"),
  openExternal: jest.fn(),
}));

const mocked = { openExternal: jest.mocked(system.openExternal) };

let tmp: string;
let root: string;
let ctx: AppContext;
let app: App;

beforeEach(async () => {
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

describe("App mouse", () => {
  const layout = () => app.layout;

  it("hovers the paper that is clicked", () => {
    const papers = layout().papers!;
    click(app, papers.x + 5, papers.y + 2);
    expect(hoveredId(app)).toBe(LECUN);
    expect(app.focus).toBe("papers");
  });

  it("selects the folder that is clicked and focuses the folders pane", () => {
    const folders = layout().folders!;
    click(app, folders.x + 2, folders.y + 3);
    expect(app.focus).toBe("folders");
    expect(app.folder).toBe("ML");
  });

  it("opens the PDF of the hovered paper when it is clicked again", () => {
    const papers = layout().papers!;
    click(app, papers.x + 5, papers.y + 1);
    expect(hoveredId(app)).toBe(BERT);
    expect(mocked.openExternal).not.toHaveBeenCalled();
    click(app, papers.x + 5, papers.y + 1);
    expect(mocked.openExternal).toHaveBeenCalledTimes(1);
  });

  it("ignores a click below the last paper", () => {
    const papers = layout().papers!;
    click(app, papers.x + 5, papers.y + 20);
    expect(hoveredId(app)).toBe(ATTENTION);
  });

  it("scrolls the list with the wheel", () => {
    const papers = layout().papers!;
    wheel(app, "wheel-down", papers.x + 5, papers.y + 1);
    expect(hoveredId(app)).toBe(EINSTEIN);
    wheel(app, "wheel-up", papers.x + 5, papers.y + 1);
    expect(hoveredId(app)).toBe(ATTENTION);
  });

  it("scrolls the folders with the wheel and focuses that pane", () => {
    const folders = layout().folders!;
    wheel(app, "wheel-down", folders.x + 2, folders.y + 1);
    expect(app.focus).toBe("folders");
    expect(app.folder).toBe("ML");
    wheel(app, "wheel-up", folders.x + 2, folders.y + 1);
    expect(app.folder).toBe(ALL);
  });

  it("scrolls the preview with the wheel over it", () => {
    const preview = layout().preview!;
    wheel(app, "wheel-down", preview.x + 5, preview.y + 3);
    expect(app.previewScroll).toBe(3);
    wheel(app, "wheel-up", preview.x + 5, preview.y + 3);
    expect(app.previewScroll).toBe(0);
    expect(hoveredId(app)).toBe(ATTENTION);
  });
});
