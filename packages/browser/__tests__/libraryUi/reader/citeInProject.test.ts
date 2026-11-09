import type { PaperRecord, ProjectEntry } from "@labshelf/core";

jest.mock("webextension-polyfill", () => ({
  runtime: { getURL: (p: string) => `chrome-extension://ext/${p}` },
  extension: { getViews: jest.fn(() => []) },
  tabs: { create: jest.fn(async () => ({})) },
}));

import { applyReaderCite, type CiteInProjectDeps } from "../../../src/libraryUi/reader/citeInProject";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

const paper = { id: "p1", citeKey: "smith2020", doi: "10.1/x", path: "papers/ml/smith2020", title: "T" } as PaperRecord;

function project(papers?: { key: string }[]): ReadyProject {
  return { kind: "ready", folder: "projects/thesis", settings: { id: "thesis", format: "latex", ...(papers ? { papers } : {}) } } as unknown as ReadyProject;
}

function fakeDeps(): CiteInProjectDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    content: {
      updateProjectSettings: jest.fn(async (folder: string, patch) => { calls.push(`settings ${folder} ${JSON.stringify(patch)}`); }),
      updateProjectBibliography: jest.fn(async (target) => {
        calls.push(`bibliography ${JSON.stringify(target.settings.papers)}`);
        return { written: true, papersWritten: false, missing: [], mainLine: "not-needed" as const };
      }),
    },
    writeClipboard: jest.fn(async (text: string) => { calls.push(`clipboard ${text}`); }),
    listPapers: async () => [paper],
  };
}

describe("applyReaderCite", () => {
  it("lists the paper, regenerates labshelf.bib, then copies the citation", async () => {
    const deps = fakeDeps();
    const message = await applyReaderCite(deps, { project: project(), choice: { action: "cite", label: "", description: "" } }, paper, { page: 4 });
    expect(deps.calls).toEqual([
      'settings projects/thesis {"papers":[{"key":"smith2020","doi":"10.1/x"}]}',
      'bibliography [{"key":"smith2020","doi":"10.1/x"}]',
      "clipboard \\cite[p.~4]{smith2020}",
    ]);
    expect(message).toBe("Copied \\cite[p.~4]{smith2020}. thesis's labshelf.bib has the paper.");
  });

  it("copies the quotation with the citation for citeQuoted", async () => {
    const deps = fakeDeps();
    await applyReaderCite(deps, { project: project(), choice: { action: "citeQuoted", label: "", description: "" } }, paper, { page: 2, quote: "a passage" });
    expect(deps.writeClipboard).toHaveBeenCalledWith(expect.stringContaining("a passage"));
  });

  it("only adds the paper for the bibliography action and leaves the clipboard alone", async () => {
    const deps = fakeDeps();
    const message = await applyReaderCite(deps, { project: project(), choice: { action: "bibliography", label: "", description: "" } }, paper, {});
    expect(deps.writeClipboard).not.toHaveBeenCalled();
    expect(deps.content.updateProjectSettings).toHaveBeenCalledTimes(1);
    expect(message).toBe("Added smith2020 to thesis's labshelf.bib.");
  });

  it("writes nothing to the project when the user already listed the paper", async () => {
    const deps = fakeDeps();
    const message = await applyReaderCite(deps, { project: project([{ key: "smith2020" }]), choice: { action: "bibliography", label: "", description: "" } }, paper, {});
    expect(deps.content.updateProjectSettings).not.toHaveBeenCalled();
    expect(deps.content.updateProjectBibliography).not.toHaveBeenCalled();
    expect(message).toBe("Added smith2020 to thesis's labshelf.bib.");
  });
});
