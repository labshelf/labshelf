// Pins that opening a LaTeX project shows the helper setup on its own when the helper or TeX is missing.
import type { HelperStatus } from "@labshelf/core/helper";
import { checkLatexHelper } from "../../../src/editor/host/latexHelperCheck";

function setup(status: HelperStatus | Error) {
  const helper = { connect: jest.fn(async () => { if (status instanceof Error) throw status; return status; }) };
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const showHelperSetup = jest.fn();
  return { helper, logger, showHelperSetup };
}

const ready = (source: "none" | "texlive"): HelperStatus => ({ state: "ready", helperVersion: "1.0.0", tex: { source, complete: source !== "none" } });

describe("checkLatexHelper", () => {
  it.each<[string, HelperStatus]>([
    ["the helper is not installed", { state: "not-installed" }],
    ["the helper needs an update", { state: "update-helper", protocol: 1 }],
    ["the helper has no TeX", ready("none")],
  ])("shows the setup when %s", async (_case, status) => {
    const deps = setup(status);
    await checkLatexHelper({ ...deps, format: "latex", projectId: "survey" });
    expect(deps.showHelperSetup).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the helper and TeX are ready", async () => {
    const deps = setup(ready("texlive"));
    await checkLatexHelper({ ...deps, format: "latex", projectId: "survey" });
    expect(deps.showHelperSetup).not.toHaveBeenCalled();
  });

  it("does not check a Typst project", async () => {
    const deps = setup({ state: "not-installed" });
    await checkLatexHelper({ ...deps, format: "typst", projectId: "cv" });
    expect(deps.helper.connect).not.toHaveBeenCalled();
    expect(deps.showHelperSetup).not.toHaveBeenCalled();
  });

  it("logs a failed connection and still shows the setup", async () => {
    const deps = setup(new Error("native host crashed"));
    await checkLatexHelper({ ...deps, format: "latex", projectId: "survey" });
    expect(deps.logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ project: "survey" }));
    expect(deps.showHelperSetup).toHaveBeenCalledTimes(1);
  });
});
