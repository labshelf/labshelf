// Tests the per-user folder that every LabShelf app shares for its managed TeX.
import { join } from "node:path";

import { sharedTexRoot } from "../../../../../../src/writing/latex/toolchain/node/managed/index";

const HOME = "/home/ada";

describe("sharedTexRoot", () => {
  it("uses Application Support on macOS", () => {
    expect(sharedTexRoot({}, "darwin", HOME)).toBe(join(HOME, "Library", "Application Support", "LabShelf", "tex"));
  });

  it("uses LOCALAPPDATA on Windows, or AppData/Local under the home folder", () => {
    expect(sharedTexRoot({ LOCALAPPDATA: "C:/Users/ada/AppData/Local" }, "win32", HOME)).toBe(join("C:/Users/ada/AppData/Local", "LabShelf", "tex"));
    expect(sharedTexRoot({}, "win32", HOME)).toBe(join(HOME, "AppData", "Local", "LabShelf", "tex"));
  });

  it("uses XDG_DATA_HOME on Linux, or ~/.local/share when it is unset or empty", () => {
    expect(sharedTexRoot({ XDG_DATA_HOME: "/data" }, "linux", HOME)).toBe(join("/data", "labshelf", "tex"));
    expect(sharedTexRoot({}, "linux", HOME)).toBe(join(HOME, ".local", "share", "labshelf", "tex"));
    expect(sharedTexRoot({ XDG_DATA_HOME: "" }, "linux", HOME)).toBe(join(HOME, ".local", "share", "labshelf", "tex"));
  });
});
