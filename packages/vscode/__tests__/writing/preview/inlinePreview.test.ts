// Tests the previews shown inside article tabs: no separate panel while one is attached, the build status and reloads reach every tab, one-off requests go to the focused tab, and the shared shown state.
import * as path from "node:path";
import * as vscode from "vscode";

import { CheckCounts } from "@labshelf/core";
import { ReaderPanel } from "../../../src/reader";
import { BuildPreviews, previewVisibility } from "../../../src/writing/preview";
import { INLINE_SHOWN_KEY, registerShowPreview, type InlinePreviewEndpoint } from "../../../src/writing/preview/panel";
import { commandHandler, fakeHost, fakeProjectData, fakeProjects, readyEntry } from "../../support/writingFixtures";

jest.mock("../../../src/reader", () => ({ ReaderPanel: { createOrShow: jest.fn() } }));

describe("inline previews", () => {
  const create = ReaderPanel.createOrShow as jest.Mock;
  const project = readyEntry("/p/paper") as Parameters<BuildPreviews["finished"]>[0];
  const succeeded = { status: "succeeded" as const, pdf: "/p/paper/main.pdf", problems: [] };

  function fakeEndpoint() {
    const controller = { setBuildStatus: jest.fn(), reloadDocument: jest.fn(), setPreviewRoots: jest.fn(), revealPoint: jest.fn(), showLogs: jest.fn() };
    return { controller, showDocument: jest.fn(), setShown: jest.fn() } satisfies InlinePreviewEndpoint;
  }

  function setup() {
    const stored = new Map<string, unknown>();
    const state = { get: <T>(key: string) => stored.get(key) as T, update: async (key: string, value: unknown) => { stored.set(key, value); } };
    const panel = { controller: { setBuildStatus: jest.fn(), reloadDocument: jest.fn(), setPreviewRoots: jest.fn(), showLogs: jest.fn() }, showDocument: jest.fn(), reveal: jest.fn(), dispose: jest.fn() };
    create.mockImplementation(() => panel);
    const projects = fakeProjects([project]);
    const previews = new BuildPreviews({ projects, checkCounts: new CheckCounts(), host: fakeHost(), paths: path, uriOf: (target: string) => vscode.Uri.file(target), data: fakeProjectData(), listPapers: async () => [], highlightsOf: async () => [], extensionUri: vscode.Uri.file("/ext"), locatePdfjs: () => null, isMac: false, buildRootOf: async (_folder: string, main: string) => main, recompile: async () => {}, setEngine: async () => {}, fixes: () => undefined, state });
    return { previews, panel, stored, projects };
  }

  beforeEach(() => { jest.clearAllMocks(); jest.spyOn(Date, "now").mockReturnValue(5000); });
  afterEach(() => jest.restoreAllMocks());

  it("opens no panel while an article tab shows the preview, and switches the tab instead", () => {
    const { previews } = setup();
    const endpoint = fakeEndpoint();
    previews.attachInline("/p/paper", endpoint, "main.tex");
    previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: true });
    previews.finished(project, "main.tex", succeeded, "command");
    previews.show(project, "chapter.tex", "/p/paper/chapter.pdf", { beside: true });
    expect(create).not.toHaveBeenCalled();
    expect(endpoint.showDocument).toHaveBeenCalledWith(expect.objectContaining({ fsPath: "/p/paper/chapter.pdf" }), "chapter.pdf");
    expect(previews.hasPreview("/p/paper")).toBe(true);
  });

  it("closes the project's panel when the first article tab attaches", () => {
    const { previews, panel } = setup();
    previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: true });
    expect(create).toHaveBeenCalledTimes(1);
    previews.attachInline("/p/paper", fakeEndpoint(), "main.tex");
    expect(panel.dispose).toHaveBeenCalled();
  });

  it("sends the build status and reloads to every attached tab", () => {
    const { previews } = setup();
    const one = fakeEndpoint();
    const two = fakeEndpoint();
    previews.attachInline("/p/paper", one, "main.tex");
    previews.attachInline("/p/paper", two, "main.tex");
    previews.building("/p/paper", "main.tex");
    for (const endpoint of [one, two]) { expect(endpoint.controller.setBuildStatus).toHaveBeenLastCalledWith("building", 0, {}); }
    previews.finished(project, "main.tex", succeeded, "save");
    for (const endpoint of [one, two]) {
      expect(endpoint.controller.reloadDocument).toHaveBeenCalledTimes(1);
      expect(endpoint.controller.setBuildStatus).toHaveBeenLastCalledWith("succeeded", 0, { stale: false, builtAt: 5000 });
    }
  });

  it("sends a failed main build's logs to the tab focused last", async () => {
    const { previews } = setup();
    const one = fakeEndpoint();
    const two = fakeEndpoint();
    previews.attachInline("/p/paper", one, "main.tex");
    previews.attachInline("/p/paper", two, "main.tex");
    previews.focusInline(one);
    previews.finished(project, "main.tex", { status: "failed", problems: [] }, "command");
    await new Promise((resolve) => setImmediate(resolve));
    expect(one.controller.showLogs).toHaveBeenCalledWith("main.tex");
    expect(two.controller.showLogs).not.toHaveBeenCalled();
  });

  it("opens a panel again once the last tab detaches", () => {
    const { previews } = setup();
    const attached = previews.attachInline("/p/paper", fakeEndpoint(), "main.tex");
    attached.dispose();
    expect(previews.hasPreview("/p/paper")).toBe(false);
    previews.finished(project, "main.tex", succeeded, "command");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("shares and stores the shown state, which the eye toggles for every tab", async () => {
    const { previews, stored, projects } = setup();
    const endpoint = fakeEndpoint();
    previews.attachInline("/p/paper", endpoint, "main.tex");
    expect(endpoint.setShown).toHaveBeenLastCalledWith(true);
    expect(previewVisibility.isOpen("/p/paper")).toBe(true);
    const context = { subscriptions: [] as vscode.Disposable[] };
    registerShowPreview({ context: context as never, projects, previews, activeSource: { current: () => ({ uri: vscode.Uri.file("/p/paper/main.tex"), line: () => 1 }) as never } });
    await commandHandler("labshelf.writing.togglePreview")();
    expect(endpoint.setShown).toHaveBeenLastCalledWith(false);
    expect(stored.get(INLINE_SHOWN_KEY)).toBe(false);
    expect(previewVisibility.isOpen("/p/paper")).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
