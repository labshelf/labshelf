// Tests for servedHost: the binary serves the bridge host when started under the bridge name or with --host=bridge.
import { servedHost } from "../../../src/helper/nativeHost";

describe("servedHost", () => {
  it("serves the bridge for the labshelf-bridge name on macOS and Linux", () => {
    expect(servedHost("/home/u/.local/share/labshelf-helper/bin/labshelf-bridge", [])).toBe("bridge");
  });

  it("serves the bridge when the first argument is --host=bridge, whatever the binary is called", () => {
    expect(servedHost("C:\\Users\\u\\AppData\\Local\\LabShelf Helper\\bin\\labshelf-helper.exe", ["--host=bridge", "chrome-extension://abc/"])).toBe("bridge");
  });

  it("serves the bridge for a labshelf-bridge.exe or .cmd name", () => {
    expect(servedHost("C:\\bin\\labshelf-bridge.exe", [])).toBe("bridge");
    expect(servedHost("C:\\bin\\LabShelf-Bridge.cmd", [])).toBe("bridge");
  });

  it("serves the helper for any other name and arguments", () => {
    expect(servedHost("/bin/labshelf-helper", ["chrome-extension://abc/"])).toBe("helper");
    expect(servedHost("/bin/labshelf-helper-macos-arm64", [])).toBe("helper");
    expect(servedHost("/bin/labshelf-helper", ["x", "--host=bridge"])).toBe("helper");
  });
});
