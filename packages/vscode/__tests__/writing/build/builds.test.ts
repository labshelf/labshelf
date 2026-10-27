// Tests the build module: the build options and their writes, the record of the last builds and Build Project.
import * as vscode from "vscode";

import type { LatexEngine } from "@labshelf/core";
import { BUILD_COMMAND, BuildOutcomes, buildOptions, registerBuildCommand, setAutoCompile, setEngine, setHaltOnError } from "../../../src/writing/build/builds";
import { writeEngine } from "../../../src/writing/build/toolchain";
import type { ReadyProject } from "../../../src/writing/buildRootDocument";
import { commandHandler, fakeHost, fakeLogger, fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

jest.mock("../../../src/writing/build/toolchain", () => ({ writeEngine: jest.fn() }));

// Tests the build options a preview shows and the writes behind them: the auto compile setting and the LaTeX engine.
describe("buildOptions", () => {
  const workspace = vscode.workspace as unknown as { _config: Record<string, Record<string, unknown>>; _configUpdate: jest.Mock };
  const save = writeEngine as jest.Mock;
  const latex = (engine?: LatexEngine) => readyEntry("/p/tex", { settings: { id: "tex", format: "latex", ...(engine ? { engine } : {}) } }) as ReadyProject;
  const typst = readyEntry("/p/typ", { main: "main.typ", settings: { id: "typ", format: "typst" } }) as ReadyProject;

  beforeEach(() => {
    jest.clearAllMocks();
    delete workspace._config["labshelf.writing"];
  });

  describe("buildOptions", () => {
    it("omits the engine for a Typst project", () => {
      expect(buildOptions(typst)).toEqual({ autoCompile: "typing" });
      expect("engine" in buildOptions(typst)).toBe(false);
    });

    it("reports the engine a LaTeX project stores", () => {
      expect(buildOptions(latex("xelatex"))).toEqual({ autoCompile: "typing", engine: "xelatex", haltOnError: false });
    });

    it("reports a null engine for a LaTeX project that has not chosen one", () => {
      expect(buildOptions(latex())).toEqual({ autoCompile: "typing", engine: null, haltOnError: false });
    });

    it("reflects the auto compile setting", () => {
      workspace._config["labshelf.writing"] = { autoCompile: "save" };
      expect(buildOptions(typst).autoCompile).toBe("save");
    });

    it("reads an unknown auto compile value as typing", () => {
      workspace._config["labshelf.writing"] = { autoCompile: false };
      expect(buildOptions(typst).autoCompile).toBe("typing");
    });

    it("reports the halt-on-error setting for LaTeX only", () => {
      workspace._config["labshelf.writing"] = { haltOnError: true };
      expect(buildOptions(latex()).haltOnError).toBe(true);
      expect("haltOnError" in buildOptions(typst)).toBe(false);
    });
  });

  describe("setAutoCompile", () => {
    it("writes the setting at the global target", async () => {
      await setAutoCompile("off");
      expect(workspace._configUpdate).toHaveBeenCalledWith("labshelf.writing", "autoCompile", "off", vscode.ConfigurationTarget.Global);
    });
  });

  describe("setHaltOnError", () => {
    it("writes the setting at the global target", async () => {
      await setHaltOnError(true);
      expect(workspace._configUpdate).toHaveBeenCalledWith("labshelf.writing", "haltOnError", true, vscode.ConfigurationTarget.Global);
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
});

// Tests that the last build of each project folder is remembered for the session and announced when it ends.
describe("BuildOutcomes", () => {
  // Seam: new BuildOutcomes(now?: () => Date) implements BuildListener; last(folder): { ok: boolean; at: Date } | undefined; onDidChange: Event<string> (the folder).
  const project = readyEntry("/lib/projects/a") as never;
  const at = new Date(2026, 0, 1, 14, 5);

  describe("BuildOutcomes", () => {
    it("knows nothing about a project that was never built", () => {
      expect(new BuildOutcomes(() => at).last("/lib/projects/a")).toBeUndefined();
    });

    it("records a failed build with its time", () => {
      const outcomes = new BuildOutcomes(() => at);
      outcomes.finished(project, "main.tex", { status: "failed", problems: [] }, "command");
      expect(outcomes.last("/lib/projects/a")).toEqual({ ok: false, at });
    });

    it("keeps only the latest build of a folder", () => {
      const outcomes = new BuildOutcomes(() => at);
      outcomes.finished(project, "main.tex", { status: "failed", problems: [] }, "save");
      outcomes.finished(project, "main.tex", { status: "succeeded", pdf: "/x.pdf", problems: [] }, "save");
      expect(outcomes.last("/lib/projects/a")).toEqual({ ok: true, at });
      expect(outcomes.last("/lib/projects/b")).toBeUndefined();
    });

    it("announces the folder when a build finishes", () => {
      const outcomes = new BuildOutcomes(() => at);
      const changed = jest.fn();
      outcomes.onDidChange(changed);
      outcomes.building("/lib/projects/a", "main.tex");
      expect(changed).not.toHaveBeenCalled();
      outcomes.finished(project, "main.tex", { status: "failed", problems: [] }, "focus");
      expect(changed).toHaveBeenCalledWith("/lib/projects/a");
    });
  });
});

// Tests Build Project: it saves every editor and hands the active file's project to the builder of its format.
describe("registerBuildCommand", () => {
  const window = vscode.window as unknown as Record<string, jest.Mock>;
  const saveAll = (vscode.workspace as unknown as { saveAll: jest.Mock }).saveAll;

  function setup() {
    const order: string[] = [];
    const builders = {
      latex: { request: jest.fn(async () => { order.push("latex"); return undefined; }) },
      typst: { request: jest.fn(async () => { order.push("typst"); return undefined; }) },
    };
    saveAll.mockImplementation(async () => { order.push("saveAll"); return true; });
    const projects = fakeProjects([
      readyEntry("/p/tex"),
      readyEntry("/p/typ", { main: "main.typ", settings: { id: "typ", format: "typst" } }),
    ]);
    const buildRootOf = jest.fn(async (_folder: string, main: string, _file: string) => main);
    registerBuildCommand({ context: { subscriptions: [] } as never, projects, builders, buildRootOf });
    return { builders, order, buildRootOf };
  }

  beforeEach(() => jest.clearAllMocks());

  describe("registerBuildCommand", () => {
    it.each([["/p/typ/main.typ", "typst", "/p/typ", "main.typ"], ["/p/tex/main.tex", "latex", "/p/tex", "main.tex"]] as const)(
      "saves all editors, then builds %s with the %s builder", async (file, format, folder, root) => {
        const { builders, order } = setup();
        openInEditor(file);
        await commandHandler(BUILD_COMMAND)();
        expect(builders[format].request).toHaveBeenCalledWith(folder, root, "command");
        expect(order).toEqual(["saveAll", format]);
      });

    it("builds the root the injected buildRootOf resolves for a chapter that is not a root", async () => {
      const { builders, buildRootOf } = setup();
      buildRootOf.mockResolvedValue("book.tex");
      openInEditor("/p/tex/chapters/one.tex");
      await commandHandler(BUILD_COMMAND)();
      expect(buildRootOf).toHaveBeenCalledWith("/p/tex", "main.tex", "/p/tex/chapters/one.tex");
      expect(builders.latex.request).toHaveBeenCalledWith("/p/tex", "book.tex", "command");
    });

    it("tells the user to open a project file when the active file is outside every project", async () => {
      const { builders } = setup();
      openInEditor("/elsewhere/a.typ");
      await commandHandler(BUILD_COMMAND)();
      expect(window["showInformationMessage"]).toHaveBeenCalledWith(expect.stringContaining("writing project"));
      expect(builders.typst.request).not.toHaveBeenCalled();
      expect(saveAll).not.toHaveBeenCalled();
    });

    it("does the same for a non-file document", async () => {
      setup();
      openInEditor("/p/typ/main.typ", "untitled");
      await commandHandler(BUILD_COMMAND)();
      expect(window["showInformationMessage"]).toHaveBeenCalledTimes(1);
    });
  });
});
