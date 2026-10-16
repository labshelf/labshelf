// Tests the focus follower: the preview tracks the focused file's build root, and focus never rebuilds an existing PDF.
import * as vscode from "vscode";

import { FocusFollower } from "../../../src/writing/preview/focusFollower";
import { fakeHost, fakeProjects, readyEntry } from "../../support/writingFixtures";

import type { ReadyProject } from "../../../src/writing/mainDocument";

const paper = readyEntry("/p/paper") as ReadyProject;
const other = readyEntry("/p/other") as ReadyProject;

function setup(opts: { open: ReadyProject | undefined; pdfs: string[]; roots: Record<string, string> }) {
  (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: { fsPath: string }) => {
    if (!opts.pdfs.includes(uri.fsPath)) { throw Object.assign(new Error("FileNotFound"), { code: "FileNotFound" }); }
    return {};
  });
  const request = jest.fn(async () => {});
  const show = jest.fn();
  const buildRootOf = jest.fn(async (_folder: string, _main: string, file: string) => opts.roots[file] ?? "main.tex");
  const follower = new FocusFollower({
    session: { project: opts.open },
    projects: fakeProjects([paper, other]),
    buildRootOf,
    builders: { latex: { request }, typst: { request: jest.fn() } },
    previews: { show },
    host: fakeHost(),
  });
  return { follower, request, show };
}

beforeEach(() => jest.clearAllMocks());

describe("FocusFollower", () => {
  it("shows the PDF of a focused file that is its own root, without building", async () => {
    const { follower, show, request } = setup({ open: paper, pdfs: ["/p/paper/b/main.pdf"], roots: { "/p/paper/b/main.tex": "b/main.tex" } });
    await follower.follow("/p/paper/b/main.tex");
    expect(show).toHaveBeenCalledWith(paper, "b/main.tex", "/p/paper/b/main.pdf", { beside: true });
    expect(request).not.toHaveBeenCalled();
  });

  it("shows the main PDF for an included chapter", async () => {
    const { follower, show, request } = setup({ open: paper, pdfs: ["/p/paper/main.pdf"], roots: {} });
    await follower.follow("/p/paper/chapters/intro.tex");
    expect(show).toHaveBeenCalledWith(paper, "main.tex", "/p/paper/main.pdf", { beside: true });
    expect(request).not.toHaveBeenCalled();
  });

  it("ignores files of no project, of another project, and any file when no project is open", async () => {
    const a = setup({ open: paper, pdfs: ["/p/paper/main.pdf", "/p/other/main.pdf"], roots: {} });
    await a.follower.follow("/elsewhere/x.tex");
    await a.follower.follow("/p/other/main.tex");
    const b = setup({ open: undefined, pdfs: ["/p/paper/main.pdf"], roots: {} });
    await b.follower.follow("/p/paper/main.tex");
    for (const { show, request } of [a, b]) {
      expect(show).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    }
  });

  it("shows the main PDF and requests a focus build when the focused root is not built", async () => {
    const { follower, show, request } = setup({ open: paper, pdfs: ["/p/paper/main.pdf"], roots: { "/p/paper/b/main.tex": "b/main.tex" } });
    await follower.follow("/p/paper/b/main.tex");
    expect(show).toHaveBeenCalledWith(paper, "main.tex", "/p/paper/main.pdf", { beside: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/p/paper", "b/main.tex", "focus");
  });

  it("builds without showing when neither the root nor main has a PDF", async () => {
    const { follower, show, request } = setup({ open: paper, pdfs: [], roots: { "/p/paper/b/main.tex": "b/main.tex" } });
    await follower.follow("/p/paper/b/main.tex");
    expect(show).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("/p/paper", "b/main.tex", "focus");
  });

  it("does not build when focus switches between roots that both have a PDF", async () => {
    const { follower, show, request } = setup({
      open: paper, pdfs: ["/p/paper/main.pdf", "/p/paper/b/main.pdf"], roots: { "/p/paper/b/main.tex": "b/main.tex" },
    });
    await follower.follow("/p/paper/main.tex");
    await follower.follow("/p/paper/b/main.tex");
    expect(show).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenLastCalledWith(paper, "b/main.tex", "/p/paper/b/main.pdf", { beside: true });
    expect(request).not.toHaveBeenCalled();
  });

  it("follows the active editor and ignores an editor that is not a file", async () => {
    const { show } = setup({ open: paper, pdfs: ["/p/paper/main.pdf"], roots: {} });
    const w = vscode.window as unknown as { activeTextEditor: unknown; _fireActiveEditorChange(): void };
    w.activeTextEditor = undefined;
    w._fireActiveEditorChange();
    await new Promise((r) => setImmediate(r));
    expect(show).not.toHaveBeenCalled();
    w.activeTextEditor = { document: { uri: vscode.Uri.file("/p/paper/main.tex") } };
    w._fireActiveEditorChange();
    await new Promise((r) => setImmediate(r));
    expect(show).toHaveBeenCalledTimes(1);
    w.activeTextEditor = undefined;
  });
});
