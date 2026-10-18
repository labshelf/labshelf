// Tests the All projects actions on any project: build, preview, open log, create file and set target.
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { updateProjectSettings, type ProjectSettingsPatch } from "@labshelf/core";
import { nodeProjectReadContext } from "@labshelf/core/node";
import { createProjectHostActions } from "../../../src/writing/allProjects/projectHostActions";
import { fakeLogger, fakeProjects, readyEntry } from "../../support/writingFixtures";

let folder: string;

beforeEach(async () => {
  jest.clearAllMocks();
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-host-actions-"));
});
afterEach(async () => { await fs.rm(folder, { recursive: true, force: true }); });

function setup(hasMain = true) {
  const entry = readyEntry(folder) as Extract<ReturnType<typeof readyEntry>, { kind: "ready" }>;
  if (!hasMain) { entry.main = undefined; }
  const projects = fakeProjects([entry]);
  const deps = {
    projects: projects as never,
    findReady: jest.fn(() => entry),
    recompile: jest.fn(async () => undefined),
    open: jest.fn(async () => {}),
    openFile: jest.fn(async () => {}),
    edit: jest.fn(async (_id: string, _patch: ProjectSettingsPatch) => {}),
  };
  return { actions: createProjectHostActions(deps), deps, projects, entry };
}

describe("createProjectHostActions", () => {
  it("builds the main root of the given project", async () => {
    const { actions, deps } = setup();
    await actions.build(folder);
    expect(deps.recompile).toHaveBeenCalledWith(folder, "main.tex");
  });

  it("refuses to build a project without a main file, naming the folder", async () => {
    const { actions } = setup(false);
    await expect(actions.build(folder)).rejects.toThrow(folder);
  });

  it("opens the project and then shows its preview", async () => {
    const { actions, deps } = setup();
    await actions.preview(folder);
    expect(deps.open).toHaveBeenCalledWith(folder);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("labshelf.writing.showPreview");
  });

  describe("openLog", () => {
    it("opens the raw log of the main root", async () => {
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({});
      await setup().actions.openLog(folder);
      const [command, uri] = (vscode.commands.executeCommand as jest.Mock).mock.calls[0];
      expect(command).toBe("vscode.open");
      expect(uri.fsPath).toMatch(/main\.log$/);
    });

    it("fails with 'No build log yet' when the build left none", async () => {
      (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error("missing"));
      await expect(setup().actions.openLog(folder)).rejects.toThrow(`No build log yet for ${folder}`);
    });
  });

  describe("createFile", () => {
    it("creates the parent folders and an empty file, then opens it", async () => {
      const { actions, deps } = setup();
      await actions.createFile(folder, "chapters/intro.tex");
      expect(await fs.readFile(path.join(folder, "chapters", "intro.tex"), "utf8")).toBe("");
      expect(deps.openFile).toHaveBeenCalledWith(folder, "chapters/intro.tex");
    });

    it("refuses an existing file and leaves its content", async () => {
      await fs.writeFile(path.join(folder, "notes.md"), "keep me");
      const { actions, deps } = setup();
      await expect(actions.createFile(folder, "notes.md")).rejects.toThrow(`notes.md already exists in ${folder}`);
      expect(await fs.readFile(path.join(folder, "notes.md"), "utf8")).toBe("keep me");
      expect(deps.openFile).not.toHaveBeenCalled();
    });

    it.each(["../outside.tex", "a/../../outside.tex", "/etc/passwd", "..", ""])("refuses %j, which resolves outside the folder", async (file) => {
      const { actions, deps } = setup();
      await expect(actions.createFile(folder, file)).rejects.toThrow(folder);
      await expect(fs.stat(path.join(folder, "..", "outside.tex"))).rejects.toThrow();
      expect(deps.openFile).not.toHaveBeenCalled();
    });
  });

  describe("setTarget", () => {
    const writeYaml = (text: string) => fs.writeFile(path.join(folder, "labshelf.yaml"), text);
    

    it("passes the target to the project file edit", async () => {
      const { actions, deps } = setup();
      await actions.setTarget(folder, { venue: "NeurIPS" });
      expect(deps.edit).toHaveBeenCalledWith(folder, { target: { venue: "NeurIPS" } });
    });

    it("removes the target key from labshelf.yaml when given null", async () => {
      await writeYaml("id: a\nformat: latex\ntarget:\n  venue: NeurIPS\n  deadline: 2027-05-01\n");
      const { actions, deps } = setup();
      deps.edit.mockImplementation((id, patch) => updateProjectSettings(nodeProjectReadContext(fakeLogger()), id, patch));
      await actions.setTarget(folder, null);
      expect(await fs.readFile(path.join(folder, "labshelf.yaml"), "utf8")).not.toContain("target");
    });
  });
});
