// Tests the build roots a project's preview panel is told after builds and root switches, and the logs view a failed main build opens.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { rootBuildFolder } from "@labshelf/core";
import { ReaderPanel } from "../../../src/reader";
import { BuildPreviews, CheckCounts } from "../../../src/writing/preview";
import { fakeHost, fakeProjectData, fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

jest.mock("../../../src/reader", () => ({ ReaderPanel: { createOrShow: jest.fn() } }));

const create = ReaderPanel.createOrShow as jest.Mock;
type Project = Parameters<BuildPreviews["finished"]>[0];
type Finished = Parameters<BuildPreviews["finished"]>[2];

let dir: string;
let cache: string;
const ok = (root: string): Finished => ({ status: "succeeded", pdf: path.join(dir, root.replace(/\.\w+$/, ".pdf")), problems: [] });
const bad = (file: string, hint?: string): Finished => ({
  status: "failed",
  problems: [{ severity: "error", message: "Undefined control sequence.", file: path.join(dir, file), line: 4, ...(hint ? { hint } : {}) }],
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(project: Project, buildRootOf = async (_folder: string, main: string, _file: string) => main) {
  const host = fakeHost();
  const controller = { setBuildStatus: jest.fn(), reloadDocument: jest.fn(), setPreviewRoots: jest.fn(), showLogs: jest.fn() };
  create.mockImplementation(() => ({ controller, showDocument: jest.fn(), reveal: jest.fn(), dispose: jest.fn() }));
  const data = fakeProjectData();
  data.projectBuildDir.mockImplementation((id: string) => path.join(cache, id));
  const previews = new BuildPreviews({
    host, paths: path, uriOf: (target: string) => vscode.Uri.file(target), data, listPapers: async () => [], extensionUri: vscode.Uri.file("/ext"), locatePdfjs: () => null, isMac: false,
    buildRootOf, recompile: jest.fn(async () => {}),
  projects: fakeProjects(), checkCounts: new CheckCounts(),
  } as never);
  const show = (root: string) => previews.show(project, root, path.join(dir, root.replace(/\.\w+$/, ".pdf")), { beside: false });
  const lastRoots = () => controller.setPreviewRoots.mock.calls.at(-1)?.[0];
  return { previews, controller, show, lastRoots };
}

function writeLog(root: string): void {
  const file = path.join(cache, "paper", rootBuildFolder(root), `${path.basename(root).replace(/\.\w+$/, "")}.log`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "log");
}

beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-roots-"));
  cache = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-roots-cache-"));
  (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
    if (!fs.existsSync(uri.fsPath) && /\.log$/.test(uri.fsPath)) { throw Object.assign(new Error("FileNotFound"), { code: "FileNotFound" }); }
    return { type: 1, ctime: 0, mtime: 0, size: 0 };
  });
  (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = undefined;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(cache, { recursive: true, force: true });
});

describe("preview roots after a build", () => {
  it("sends main, focused, shown and one entry per built root with project-relative paths", async () => {
    const project = readyEntry(dir, { settings: { id: "paper", format: "latex" } }) as Project;
    const { previews, show, lastRoots } = setup(project);
    show("main.tex");
    writeLog("main.tex");
    previews.finished(project, "main.tex", bad("chapters/a.tex", "Check the spelling."), "save");
    previews.finished(project, "b/main.tex", ok("b/main.tex"), "save");
    await flush();
    expect(lastRoots()).toEqual({
      main: "main.tex", focused: "main.tex", shown: "main.tex", options: { autoCompile: "typing", engine: null, haltOnError: false },
      roots: expect.arrayContaining([
        { path: "main.tex", failed: true, rawLog: true, sourceLinks: true, problems: [{ severity: "error", message: "Undefined control sequence.", hint: "Check the spelling.", file: "chapters/a.tex", line: 4 }], pdfProblems: [], cites: 0, words: 0 },
        { path: "b/main.tex", failed: false, rawLog: false, sourceLinks: true, problems: [], pdfProblems: [], cites: 0, words: 0 },
      ]),
    });
    expect(lastRoots().roots).toHaveLength(2);
  });

  it("resolves the focused root from the active editor's file, and main for an included chapter", async () => {
    const project = readyEntry(dir, { settings: { id: "paper", format: "latex" } }) as Project;
    const rootOf = jest.fn(async (_folder: string, main: string, file: string) => (file.endsWith("b/ch.tex") ? "b/main.tex" : main));
    const { previews, show, lastRoots } = setup(project, rootOf);
    show("main.tex");
    openInEditor(path.join(dir, "b/ch.tex"));
    previews.finished(project, "b/main.tex", ok("b/main.tex"), "save");
    await flush();
    expect(rootOf).toHaveBeenCalledWith(dir, "main.tex", path.join(dir, "b/ch.tex"));
    expect(lastRoots()).toMatchObject({ main: "main.tex", focused: "b/main.tex", shown: "main.tex" });
    openInEditor(path.join(dir, "intro.tex"));
    previews.finished(project, "main.tex", ok("main.tex"), "save");
    await flush();
    expect(lastRoots()).toMatchObject({ focused: "main.tex" });
  });

  it("sends the roots again when the shown root changes", async () => {
    const project = readyEntry(dir, { settings: { id: "paper", format: "latex" } }) as Project;
    const { previews, show, lastRoots } = setup(project);
    show("main.tex");
    previews.finished(project, "b/main.tex", ok("b/main.tex"), "save");
    await flush();
    expect(lastRoots().shown).toBe("main.tex");
    show("b/main.tex");
    await flush();
    expect(lastRoots().shown).toBe("b/main.tex");
  });

  it("reports a raw log only when the root's .log exists in its build folder", async () => {
    const project = readyEntry(dir, { settings: { id: "paper", format: "latex" } }) as Project;
    const { previews, show, lastRoots } = setup(project);
    show("main.tex");
    writeLog("b/main.tex");
    previews.finished(project, "main.tex", bad("main.tex"), "save");
    previews.finished(project, "b/main.tex", bad("b/main.tex"), "save");
    await flush();
    const byPath = Object.fromEntries(lastRoots().roots.map((root: { path: string; rawLog: boolean }) => [root.path, root.rawLog]));
    expect(byPath).toEqual({ "main.tex": false, "b/main.tex": true });
  });

  it("reports no raw log and no source links for a Typst root", async () => {
    const project = readyEntry(dir, { main: "main.typ", settings: { id: "paper", format: "typst" } }) as Project;
    const { previews, show, lastRoots } = setup(project);
    show("main.typ");
    writeLog("main.typ");
    previews.finished(project, "main.typ", { status: "failed", problems: [] } as Finished, "save");
    await flush();
    expect(lastRoots().roots).toEqual([expect.objectContaining({ path: "main.typ", failed: true, rawLog: false, sourceLinks: false })]);
  });
});

describe("logs view after a failed build", () => {
  it("opens the logs of a failed main build and keeps the shown PDF", async () => {
    const project = readyEntry(dir, { settings: { id: "paper", format: "latex" } }) as Project;
    const { previews, show, controller } = setup(project);
    show("main.tex");
    previews.finished(project, "main.tex", bad("main.tex"), "save");
    await flush();
    expect(controller.showLogs).toHaveBeenCalledWith("main.tex");
    expect(controller.reloadDocument).not.toHaveBeenCalled();
  });

  it("does not open the logs for a failed non-main root", async () => {
    const project = readyEntry(dir, { settings: { id: "paper", format: "latex" } }) as Project;
    const { previews, show, controller } = setup(project);
    show("main.tex");
    previews.finished(project, "b/main.tex", bad("b/main.tex"), "save");
    await flush();
    expect(controller.showLogs).not.toHaveBeenCalled();
    expect(controller.reloadDocument).not.toHaveBeenCalled();
  });

  it("does not open the logs after a successful main build", async () => {
    const project = readyEntry(dir, { settings: { id: "paper", format: "latex" } }) as Project;
    const { previews, show, controller } = setup(project);
    show("main.tex");
    previews.finished(project, "main.tex", ok("main.tex"), "save");
    await flush();
    expect(controller.showLogs).not.toHaveBeenCalled();
  });
});
