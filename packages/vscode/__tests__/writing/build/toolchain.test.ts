// Tests the build toolchain: the VS Code prompt, the compiler pick and the compiler status bar.
import * as path from "node:path";
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import { createVscodeToolchainAsk, registerCompilerStatusBar, registerPickCompiler } from "../../../src/writing/build/toolchain";
import { commandHandler, fakeHost, fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

// Tests the VS Code toolchain prompt: the install choice and the install progress notification.
describe("askToolchain", () => {
  const window = vscode.window as unknown as Record<string, jest.Mock>;

  beforeEach(() => { window["showInformationMessage"]!.mockReset(); window["withProgress"]!.mockReset(); });

  describe("chooseInstall", () => {
    it("asks in a modal and maps Light to TinyTeX and Full to TeX Live", async () => {
      window["showInformationMessage"]!.mockResolvedValueOnce("Install Light").mockResolvedValueOnce("Install Full");

      expect(await createVscodeToolchainAsk().chooseInstall()).toBe("tinytex");
      expect(await createVscodeToolchainAsk().chooseInstall()).toBe("texlive");

      const [message, options, ...buttons] = window["showInformationMessage"]!.mock.calls[0]!;
      expect(message).toMatch(/LaTeX is not installed/);
      expect(options).toMatchObject({ modal: true });
      expect(buttons).toEqual(["Install Light", "Install Full"]);
    });

    it("declines when the modal is dismissed", async () => {
      window["showInformationMessage"]!.mockResolvedValue(undefined);
      expect(await createVscodeToolchainAsk().chooseInstall()).toBeUndefined();
    });
  });

  describe("progress", () => {
    it("shows a notification titled after the work and forwards its messages", async () => {
      const report = jest.fn();
      window["withProgress"]!.mockImplementation(async (_options, task) => task({ report }));

      const result = await createVscodeToolchainAsk().progress("Installing TinyTeX", async (say) => { say("40%"); return "done"; });

      expect(result).toBe("done");
      expect(window["withProgress"]).toHaveBeenCalledWith(expect.objectContaining({ title: "Installing TinyTeX", cancellable: false }), expect.any(Function));
      expect(report).toHaveBeenCalledWith({ message: "40%" });
    });
  });
});

// Tests the compiler status bar item: the engine of the active LaTeX project, hidden for Typst and outside projects.
describe("compilerStatusBar", () => {
  function setup(entries: ProjectEntry[]) {
    const changes = new vscode.EventEmitter<void>();
    let current = entries;
    registerCompilerStatusBar({ subscriptions: [] } as never, { list: () => current, paths: path, onDidChange: changes.event });
    const item = (vscode.window.createStatusBarItem as jest.Mock).mock.results[0]!.value;
    return { item, setProjects: (next: ProjectEntry[]) => { current = next; changes.fire(); } };
  }

  const latex = (engine?: "xelatex" | "pdflatex") => readyEntry("/code/repo", {
    settings: { id: "repo", format: "latex", ...(engine ? { engine } : {}) },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = undefined;
  });

  describe("registerCompilerStatusBar", () => {
    it("sits right after the main item and opens the compiler pick on click", () => {
      const { item } = setup([latex("xelatex")]);
      expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(vscode.StatusBarAlignment.Left, 49);
      expect(item.command).toBe("labshelf.writing.pickCompiler");
      expect(item.hide).toHaveBeenCalled();
    });

    it("shows the engine of the project that owns the active file", () => {
      const { item } = setup([latex("pdflatex")]);
      openInEditor("/code/repo/sections/intro.tex");
      expect(item.text).toBe("$(gear) pdfLaTeX $(chevron-down)");
      expect(item.tooltip).toBe("LaTeX compiler of repo. Click to change it.");
      expect(item.show).toHaveBeenCalled();
    });

    it("invites a choice when labshelf.yaml has no engine", () => {
      const { item } = setup([latex()]);
      openInEditor("/code/repo/a.tex");
      expect(item.text).toBe("$(gear) Choose compiler");
    });

    it("hides for Typst projects, files outside projects and non-file documents", () => {
      const { item } = setup([readyEntry("/code/repo", { settings: { id: "repo", format: "typst" } })]);
      openInEditor("/code/repo/a.typ");
      expect(item.show).not.toHaveBeenCalled();
      expect(item.hide).toHaveBeenCalledTimes(2);
      openInEditor("/elsewhere/a.tex");
      expect(item.hide).toHaveBeenCalledTimes(3);
      openInEditor("/code/repo/a.typ", "untitled");
      expect(item.hide).toHaveBeenCalledTimes(4);
    });

    it("follows the project list when it reloads", () => {
      const { item, setProjects } = setup([latex()]);
      openInEditor("/code/repo/a.tex");
      setProjects([latex("xelatex")]);
      expect(item.text).toBe("$(gear) XeLaTeX $(chevron-down)");
      setProjects([]);
      expect(item.hide).toHaveBeenCalled();
    });
  });
});

// Tests the compiler pick: it lists the three engines, writes a different choice and ignores the current one and Escape.
describe("pickCompiler", () => {
  const quickPick = vscode.window.showQuickPick as jest.Mock;

  function setup(settings: { format: "latex" | "typst"; engine?: "pdflatex" | "lualatex" }) {
    const projects = fakeProjects([readyEntry("/code/repo", { settings: { id: "repo", ...settings } })]);
    const host = fakeHost();
    registerPickCompiler({ context: { subscriptions: [] } as never, host, projects });
    return { projects, update: projects.data.updateProjectSettings, run: commandHandler("labshelf.writing.pickCompiler") };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    openInEditor("/code/repo/a.tex");
  });

  describe("labshelf.writing.pickCompiler", () => {
    it("lists the three engines and marks the current one", async () => {
      quickPick.mockResolvedValueOnce(undefined);
      await setup({ format: "latex", engine: "pdflatex" }).run();
      const items = quickPick.mock.calls[0][0];
      expect(items.map((item: { label: string }) => item.label)).toEqual(["pdfLaTeX", "XeLaTeX", "LuaLaTeX"]);
      expect(items[0]).toMatchObject({ description: "current" });
      expect(items[1]).toMatchObject({ description: "" });
    });

    it("writes the picked engine to labshelf.yaml and reloads the projects", async () => {
      quickPick.mockImplementationOnce(async (items) => items.find((item: { engine: string }) => item.engine === "lualatex"));
      const { projects, update, run } = setup({ format: "latex", engine: "pdflatex" });
      await run();
      expect(update).toHaveBeenCalledWith("/code/repo", { engine: "lualatex" });
      expect(projects.reload).toHaveBeenCalled();
    });

    it("writes any pick when the project has no engine yet", async () => {
      quickPick.mockImplementationOnce(async (items) => items[0]);
      const { update, run } = setup({ format: "latex" });
      await run();
      expect(update).toHaveBeenCalledWith("/code/repo", { engine: "pdflatex" });
    });

    it("does nothing when the current engine is picked or the pick is dismissed", async () => {
      const { update, run } = setup({ format: "latex", engine: "pdflatex" });
      quickPick.mockImplementationOnce(async (items) => items[0]);
      await run();
      quickPick.mockResolvedValueOnce(undefined);
      await run();
      expect(update).not.toHaveBeenCalled();
    });

    it("does nothing outside a LaTeX project", async () => {
      await setup({ format: "typst" }).run();
      expect(quickPick).not.toHaveBeenCalled();
    });
  });
});
