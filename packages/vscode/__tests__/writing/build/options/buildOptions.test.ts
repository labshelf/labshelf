// Tests the build options a preview shows and the writes behind them: the auto compile setting and the LaTeX engine.
import * as vscode from "vscode";

import type { LatexEngine } from "@labshelf/core";
import { buildOptions, setAutoCompile, setEngine } from "../../../../src/writing/build/options";
import { saveEngine } from "../../../../src/writing/build/toolchain";
import type { ReadyProject } from "../../../../src/writing/mainDocument";
import { fakeHost, fakeLogger, fakeProjects, readyEntry } from "../../../support/writingFixtures";

jest.mock("../../../../src/writing/build/toolchain", () => ({ saveEngine: jest.fn() }));

const workspace = vscode.workspace as unknown as { _config: Record<string, Record<string, unknown>>; _configUpdate: jest.Mock };
const save = saveEngine as jest.Mock;
const latex = (engine?: LatexEngine) => readyEntry("/p/tex", { settings: { id: "tex", format: "latex", ...(engine ? { engine } : {}) } }) as ReadyProject;
const typst = readyEntry("/p/typ", { main: "main.typ", settings: { id: "typ", format: "typst" } }) as ReadyProject;

beforeEach(() => {
  jest.clearAllMocks();
  delete workspace._config["labshelf.writing"];
});

describe("buildOptions", () => {
  it("omits the engine for a Typst project", () => {
    expect(buildOptions(typst)).toEqual({ autoCompile: true });
    expect("engine" in buildOptions(typst)).toBe(false);
  });

  it("reports the engine a LaTeX project stores", () => {
    expect(buildOptions(latex("xelatex"))).toEqual({ autoCompile: true, engine: "xelatex" });
  });

  it("reports a null engine for a LaTeX project that has not chosen one", () => {
    expect(buildOptions(latex())).toEqual({ autoCompile: true, engine: null });
  });

  it("reflects the auto compile setting", () => {
    workspace._config["labshelf.writing"] = { autoCompile: false };
    expect(buildOptions(typst).autoCompile).toBe(false);
  });
});

describe("setAutoCompile", () => {
  it("writes the setting at the global target", async () => {
    await setAutoCompile(false);
    expect(workspace._configUpdate).toHaveBeenCalledWith("labshelf.writing", "autoCompile", false, vscode.ConfigurationTarget.Global);
  });
});

describe("setEngine", () => {
  it("saves the engine through the toolchain and reports success", async () => {
    save.mockResolvedValue(true);
    const deps = { host: fakeHost(), projects: fakeProjects() as never };
    const project = latex();
    await expect(setEngine(deps, project, "xelatex")).resolves.toBe(true);
    expect(save).toHaveBeenCalledWith(deps, project, "xelatex");
  });

  it("logs the project and engine when the engine could not be saved", async () => {
    save.mockResolvedValue(false);
    const logger = fakeLogger();
    await expect(setEngine({ host: fakeHost(logger), projects: fakeProjects() as never }, latex(), "xelatex")).resolves.toBe(false);
    expect(logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.stringContaining("/p/tex"), expect.objectContaining({ engine: "xelatex" }));
  });
});
