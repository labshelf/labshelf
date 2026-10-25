// Tests for servedHost: the binary serves the bridge host when started under the bridge name or with --host=bridge.
import { detectServedHost } from "../../../src/helper/nativeHost";

describe("detectServedHost", () => {
  it("serves the bridge for the labshelf-bridge name on macOS and Linux", () => {
    expect(detectServedHost("/home/u/.local/share/labshelf-helper/bin/labshelf-bridge", [])).toBe("bridge");
  });

  it("serves the bridge when the first argument is --host=bridge, whatever the binary is called", () => {
    expect(detectServedHost("C:\\Users\\u\\AppData\\Local\\LabShelf Helper\\bin\\labshelf-helper.exe", ["--host=bridge", "chrome-extension://abc/"])).toBe("bridge");
  });

  it("serves the bridge for a labshelf-bridge.exe or .cmd name", () => {
    expect(detectServedHost("C:\\bin\\labshelf-bridge.exe", [])).toBe("bridge");
    expect(detectServedHost("C:\\bin\\LabShelf-Bridge.cmd", [])).toBe("bridge");
  });

  it("serves the helper for any other name and arguments", () => {
    expect(detectServedHost("/bin/labshelf-helper", ["chrome-extension://abc/"])).toBe("helper");
    expect(detectServedHost("/bin/labshelf-helper-macos-arm64", [])).toBe("helper");
    expect(detectServedHost("/bin/labshelf-helper", ["x", "--host=bridge"])).toBe("helper");
  });
});
