import { delimiter, dirname, join } from "node:path";

import { withToolchainOnPath } from "../../../../src/helper/build/toolchain/withToolchainOnPath";

const executable = join("/opt", "tex", "bin", "latexmk");
const toolchain = { engine: "pdflatex", executable } as const;
const dir = dirname(executable);

describe("withToolchainOnPath", () => {
  it("puts the toolchain's directory first", () => {
    expect(withToolchainOnPath(toolchain, { PATH: ["/usr/bin", "/bin"].join(delimiter) }))
      .toBe([dir, "/usr/bin", "/bin"].join(delimiter));
  });

  it("is idempotent and moves an existing entry to the front without duplicating it", () => {
    const once = withToolchainOnPath(toolchain, { PATH: ["/usr/bin", dir].join(delimiter) });
    expect(once).toBe([dir, "/usr/bin"].join(delimiter));
    expect(withToolchainOnPath(toolchain, { PATH: once })).toBe(once);
  });

  it("handles an empty or missing PATH", () => {
    expect(withToolchainOnPath(toolchain, {})).toBe(dir);
  });

  it("reads a differently spelled Path key", () => {
    expect(withToolchainOnPath(toolchain, { Path: "/usr/bin" })).toBe([dir, "/usr/bin"].join(delimiter));
  });
});
