// Pins the copied environment that puts the toolchain's directory first on PATH.
import { delimiter, dirname, join } from "node:path";

import { withToolchainOnPath } from "../../../../../src/latex/toolchain/node/systemTex/withToolchainOnPath";

const executable = join("/opt", "tex", "bin", "latexmk");
const toolchain = { engine: "pdflatex", executable } as const;
const dir = dirname(executable);

describe("withToolchainOnPath", () => {
  it("puts the toolchain's directory first and keeps the other variables", () => {
    expect(withToolchainOnPath(toolchain, { PATH: ["/usr/bin", "/bin"].join(delimiter), HOME: "/home/a" }))
      .toEqual({ PATH: [dir, "/usr/bin", "/bin"].join(delimiter), HOME: "/home/a" });
  });

  it("is idempotent and moves an existing entry to the front without duplicating it", () => {
    const once = withToolchainOnPath(toolchain, { PATH: ["/usr/bin", dir].join(delimiter) });
    expect(once["PATH"]).toBe([dir, "/usr/bin"].join(delimiter));
    expect(withToolchainOnPath(toolchain, once)).toEqual(once);
  });

  it("handles an empty or missing PATH", () => {
    expect(withToolchainOnPath(toolchain, {})).toEqual({ PATH: dir });
    expect(withToolchainOnPath(toolchain, { PATH: "" })).toEqual({ PATH: dir });
  });

  it("keeps a differently spelled Path key instead of adding PATH", () => {
    expect(withToolchainOnPath(toolchain, { Path: "/usr/bin" })).toEqual({ Path: [dir, "/usr/bin"].join(delimiter) });
  });

  it("returns a copy and leaves the input environment unchanged", () => {
    const env = { PATH: "/usr/bin" };
    expect(withToolchainOnPath(toolchain, env)).not.toBe(env);
    expect(env).toEqual({ PATH: "/usr/bin" });
  });
});
