import { promises as fs } from "node:fs";

import type { AppContext } from "../../../../src/compositionRoot";
import * as system from "../../../../src/platform/system";
import { ALL, App } from "../../../../src/libraryUi/libraryScreen";
import { idle, makeTmpRoot, openApp, press, seedLibrary, typeText } from "../../../fixtures/appHarness";

jest.mock("../../../../src/platform/system", () => ({
  ...jest.requireActual<typeof import("../../../../src/platform/system")>("../../../../src/platform/system"),
  openExternal: jest.fn(),
  revealInFileManager: jest.fn(),
  copyToClipboard: jest.fn(),
  runEditor: jest.fn(),
  trashSupported: jest.fn(),
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

describe("App folder history and jumps", () => {
  it("goes back and forward through the folders visited with H and L", () => {
    press(app, ":");
    typeText(app, "cd Physics");
    press(app, "enter");
    expect(app.folder).toBe("Physics");
    press(app, ":");
    typeText(app, "cd ML");
    press(app, "enter");
    expect(app.folder).toBe("ML");
    press(app, "H");
    expect(app.folder).toBe("Physics");
    press(app, "H");
    expect(app.folder).toBe(ALL);
    press(app, "H");
    expect(app.folder).toBe(ALL);
    press(app, "L");
    expect(app.folder).toBe("Physics");
    press(app, "L");
    expect(app.folder).toBe("ML");
  });
});
