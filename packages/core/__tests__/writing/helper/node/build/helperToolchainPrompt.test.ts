// Pins the helper's TeX setup prompt: it declines installing TeX and reports package installs as progress for its build.
import type { ToPageMessage } from "../../../../../src/writing/helper/index";
import { helperToolchainPrompt } from "../../../../../src/writing/helper/node/build/helperToolchainPrompt";

describe("helperToolchainPrompt", () => {
  it("never chooses a TeX install", async () => {
    expect(await helperToolchainPrompt("b1", () => undefined).chooseInstall()).toBeUndefined();
  });

  it("sends installing-package progress for its build id and returns what the work returns", async () => {
    const sent: ToPageMessage[] = [];
    const result = await helperToolchainPrompt("b1", (frame) => sent.push(frame))
      .progress("Installing the LaTeX package for foo.sty", async (report) => { report("50%"); return true; });
    expect(result).toBe(true);
    expect(sent).toEqual([
      { v: 1, id: "b1", type: "progress", phase: "installing-package", message: "Installing the LaTeX package for foo.sty" },
      { v: 1, id: "b1", type: "progress", phase: "installing-package", message: "Installing the LaTeX package for foo.sty: 50%" },
    ]);
  });
});
