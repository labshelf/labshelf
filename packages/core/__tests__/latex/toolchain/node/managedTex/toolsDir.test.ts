// Tests the per-user folder that every LabShelf app shares for its managed tools.
import { join } from "node:path";

import { resolveSharedToolsDir } from "../../../../../src/latex/node/index";

const HOME = "/home/ada";

describe("resolveSharedToolsDir", () => {
  it("uses Application Support on macOS", () => {
    expect(resolveSharedToolsDir({}, "darwin", HOME)).toBe(join(HOME, "Library", "Application Support", "LabShelf"));
  });

  it("uses LOCALAPPDATA on Windows, or AppData/Local under the home folder", () => {
    expect(resolveSharedToolsDir({ LOCALAPPDATA: "C:/Users/ada/AppData/Local" }, "win32", HOME)).toBe(join("C:/Users/ada/AppData/Local", "LabShelf"));
    expect(resolveSharedToolsDir({}, "win32", HOME)).toBe(join(HOME, "AppData", "Local", "LabShelf"));
  });

  it("uses XDG_DATA_HOME on Linux, or ~/.local/share when it is unset or empty", () => {
    expect(resolveSharedToolsDir({ XDG_DATA_HOME: "/data" }, "linux", HOME)).toBe(join("/data", "labshelf"));
    expect(resolveSharedToolsDir({}, "linux", HOME)).toBe(join(HOME, ".local", "share", "labshelf"));
    expect(resolveSharedToolsDir({ XDG_DATA_HOME: "" }, "linux", HOME)).toBe(join(HOME, ".local", "share", "labshelf"));
  });
});
