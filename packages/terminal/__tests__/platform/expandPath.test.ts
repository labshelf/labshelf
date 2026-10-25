import * as os from "node:os";
import * as path from "node:path";

import { resolveHomePath } from "../../src/platform/expandPath";

describe("home expansion", () => {
  it("expands a leading ~ to the home directory", () => {
    expect(resolveHomePath("~")).toBe(os.homedir());
    expect(resolveHomePath("~/papers")).toBe(path.join(os.homedir(), "papers"));
    expect(resolveHomePath("/abs/~/papers")).toBe("/abs/~/papers");
    expect(resolveHomePath("~other/x")).toBe("~other/x");
    expect(resolveHomePath("relative/path")).toBe("relative/path");
    expect(resolveHomePath("~/")).toBe(`${os.homedir()}/`);
  });
});
