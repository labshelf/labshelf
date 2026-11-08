/** @jest-environment jsdom */
// Spec 6.3: the files of a multi-file talk in the workspace: with a files port the included file's slides appear, an edit of one is written
// to that file at once (never through the main editor), a failed write keeps the old text; without the port the tree is the main file's.
// Acceptance ids: 6.3a, A7.
import { closeMenu } from "../../../../src/ui/dom/index.js";
import { mountDeckWorkspace } from "../../../../src/decks/dom/workspace/index";
import type { DeckWorkspace, DeckWorkspacePorts } from "../../../../src/decks/dom/workspace/types";
import { deleteSourceDeckNode, readSourceDeckBlocks } from "../../../../src/decks/index.js";
import { flush } from "./workspaceHarness";

const MAIN = "% labshelf: talk\n\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}{One}\nHello\n\\end{frame}\n\\input{part}\n\\begin{frame}{Three}\nBye\n\\end{frame}\n\\end{document}\n";
const PART = "\\begin{frame}{Two}\nMiddle\n\\end{frame}\n";

interface FilesRig { root: HTMLElement; workspace: DeckWorkspace; applied: string[]; writes: Array<[string, string]>; reads: string[]; builds(): number }
const mounted: Array<{ workspace: DeckWorkspace; host: HTMLElement }> = [];
afterEach(() => { closeMenu(); for (const { workspace, host } of mounted.splice(0)) { workspace.dispose(); host.remove(); } });

function mountFiles(options: { files?: boolean; failWrite?: boolean } = {}): FilesRig {
  const host = document.createElement("div");
  document.body.append(host);
  let current = MAIN;
  const disk = new Map([["talks/demo/part.tex", PART]]);
  const applied: string[] = []; const writes: Array<[string, string]> = []; const reads: string[] = [];
  let buildRuns = 0;
  const ports: DeckWorkspacePorts = {
    path: "talks/demo/main.tex",
    editing: { text: () => current, cursor: () => 0, apply: (change) => { applied.push(change.text); current = change.text; }, reveal: () => undefined, select: () => undefined, undo: () => undefined, redo: () => undefined } as DeckWorkspacePorts["editing"],
    editor: document.createElement("div"),
    subscribe: () => () => undefined,
    pdf: { assets: { pdfjsUrl: "pdfjs.mjs", workerUrl: "worker.mjs" }, read: async () => undefined },
    build: { run: () => { buildRuns++; }, onState: (listener) => { listener({ state: "none", errors: 0 }); return () => undefined; } },
    present: () => undefined, posterPreview: () => undefined, exportPdf: () => undefined, showProblems: () => undefined,
    mode: { read: () => "grid", write: () => undefined },
    ...(options.files === false ? {} : {
      files: {
        read: async (path: string) => { reads.push(path); return disk.get(path); },
        write: async (path: string, text: string) => { writes.push([path, text]); if (options.failWrite) throw new Error("disk full"); disk.set(path, text); },
      },
    }),
  };
  const workspace = mountDeckWorkspace(host, ports)!;
  mounted.push({ workspace, host });
  return { root: host.querySelector<HTMLElement>(".dw")!, workspace, applied, writes, reads, builds: () => buildRuns };
}

const titles = (rig: FilesRig): string[] => [...rig.root.querySelectorAll('[role="listbox"][aria-label="Slide grid"] [role="option"] .dsh-grid-title')].map((title) => title.textContent ?? "");
const menuItem = (label: string): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>(".ls-menu .ls-menu-item")].find((item) => item.textContent?.trim() === label)!;
const deleteCell = (rig: FilesRig, cell: number): void => {
  rig.root.querySelectorAll('.dsh-grid button[aria-label="Slide actions"]')[cell]!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  menuItem("Delete").click();
};

describe("a talk with an included file", () => {
  it("6.3a shows the included file's slides in place, read through the files port", async () => {
    const rig = mountFiles();
    await flush();
    expect(rig.reads).toContain("talks/demo/part.tex");
    expect(titles(rig)).toEqual(["One", "Two", "Three"]);
  });

  it("6.3a deleting an included slide writes that file once and leaves editing.apply untouched", async () => {
    const rig = mountFiles();
    await flush();
    deleteCell(rig, 1);
    await flush();
    const part = readSourceDeckBlocks("latex", "talk", PART)[0]!;
    expect(rig.writes).toEqual([["talks/demo/part.tex", deleteSourceDeckNode(PART, part)!.text]]);
    expect(rig.applied).toEqual([]);
    expect(titles(rig)).toEqual(["One", "Three"]);
    expect(rig.root.textContent).toContain("Saved to talks/demo/part.tex");
  });

  it("6.3a deleting a main-file slide still goes through editing.apply and writes no file", async () => {
    const rig = mountFiles();
    await flush();
    deleteCell(rig, 0);
    await flush();
    expect(rig.applied).toHaveLength(1);
    expect(rig.writes).toEqual([]);
    expect(titles(rig)).toEqual(["Two", "Three"]);
  });

  it("6.3a a failed write shows its message and keeps the old text", async () => {
    const rig = mountFiles({ failWrite: true });
    await flush();
    deleteCell(rig, 1);
    await flush();
    expect(rig.writes).toHaveLength(1);
    expect(rig.root.textContent).toContain("disk full");
    expect(titles(rig)).toEqual(["One", "Two", "Three"]);
  });

  it("6.3a without a files port the tree is the main file's alone", async () => {
    const rig = mountFiles({ files: false });
    await flush();
    expect(titles(rig)).toEqual(["One", "Three"]);
  });
});
