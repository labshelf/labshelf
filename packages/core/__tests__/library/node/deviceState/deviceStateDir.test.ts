/** Verifies where the per-user state directory resolves on each platform. */
import * as os from "node:os";
import * as path from "node:path";

import { resolveDeviceStateDir } from "../../../../src/library/node/index";

describe("stateDir", () => {
  it("uses $XDG_STATE_HOME/labshelf when set, on every platform", () => {
    expect(resolveDeviceStateDir({ XDG_STATE_HOME: "/xdg/state" }, "darwin")).toBe(path.join("/xdg/state", "labshelf"));
    expect(resolveDeviceStateDir({ XDG_STATE_HOME: "/xdg/state" }, "linux")).toBe(path.join("/xdg/state", "labshelf"));
  });

  it("defaults to ~/Library/Application Support/labshelf on macOS", () => {
    expect(resolveDeviceStateDir({}, "darwin")).toBe(path.join(os.homedir(), "Library", "Application Support", "labshelf"));
  });

  it("defaults to ~/.local/state/labshelf elsewhere, and treats an empty XDG_STATE_HOME as unset", () => {
    expect(resolveDeviceStateDir({}, "linux")).toBe(path.join(os.homedir(), ".local", "state", "labshelf"));
    expect(resolveDeviceStateDir({ XDG_STATE_HOME: "" }, "linux")).toBe(path.join(os.homedir(), ".local", "state", "labshelf"));
  });
});
