/** @jest-environment jsdom */
/** Tests the live mode of mountNoteFile: one item editor per item of a qmd doc, bound to the item's fragment without awareness, following the doc's items in place. */
import * as Y from "yjs";
import { mountNoteFile, type NoteFileOptions } from "../../../src/qmd/dom/mountNoteFile";
import { listQmdItems } from "../../../src/qmd/qmdDocItems";
import { readQmdDoc, setQmdDocText } from "../../../src/qmd/sharedQmdDoc";

// jsdom cannot build an EditorView with ySyncPlugin, so the item editors are fakes that record what they were given.
interface FakeMount { root: HTMLElement; options: Record<string, any>; handle: Record<string, jest.Mock>; destroyed: boolean }
const mockMounts: FakeMount[] = [];

jest.mock("../../../src/qmd/dom/qmdEditor", () => {
  const actual = jest.requireActual("../../../src/qmd/dom/qmdEditor");
  return {
    ...actual,
    mountQmdEditor: (root: HTMLElement, options: Record<string, any>) => {
      let advanced = false;
      const mount: FakeMount = { root, options, destroyed: false, handle: {} };
      mount.handle = {
        setBody: jest.fn(), flush: jest.fn(), focus: jest.fn(),
        destroy: jest.fn(() => { mount.destroyed = true; }),
        notebook: jest.fn((itemId?: string) => [{
          key: `${itemId ?? ""}#c1`, itemId: itemId ?? "", language: "python", sectionKeys: [],
          run: async () => "ok", cancel: () => undefined, setQueue: () => undefined,
        }]),
        sections: jest.fn(() => []), markUpstreamChange: jest.fn(), collapseAll: jest.fn(), expandAll: jest.fn(),
        setAdvanced: jest.fn((value: boolean) => { advanced = value; }), advanced: jest.fn(() => advanced),
        foldState: jest.fn(() => ({ cells: new Set<string>(), sections: new Set<string>(), advanced })),
        revealProblem: jest.fn(() => false), outline: jest.fn(() => []), reveal: jest.fn(),
        outlineOpen: jest.fn(() => false), setOutlineOpen: jest.fn(), insertText: jest.fn(), insertInlineMath: jest.fn(), openInsertMenu: jest.fn(),
      };
      mockMounts.push(mount);
      return mount.handle;
    },
  };
});

const A = "n-AAA";
const B = "n-BBB";
const C = "n-CCC";
const item = (id: string, body: string, attrs = ` author="Ana"`): string => `::: {#${id} .labshelf-item${attrs}}\n${body}\n:::\n`;
const FILE = `Intro.\n\n${item(A, "First item", ` author="Ana" created="2026-03-04T10:00:00Z"`)}\n${item(B, "Second item")}`;

const bodies = (doc: Y.Doc): Y.Map<Y.XmlFragment> => readQmdDoc(doc).get("bodies") as Y.Map<Y.XmlFragment>;
const mountsOf = (): FakeMount[] => mockMounts.filter((mount) => !mount.destroyed);

interface Setup { host: HTMLElement; doc: Y.Doc; handle: ReturnType<typeof mountNoteFile>; save: jest.Mock; persist: jest.Mock }

function mount(text: string, extra: Partial<NoteFileOptions> = {}, persist: jest.Mock = jest.fn()): Setup {
  const doc = new Y.Doc();
  setQmdDocText(doc, text, "seed");
  const host = document.body.appendChild(document.createElement("div"));
  const save = jest.fn();
  const handle = mountNoteFile(host, { text: "", noteKey: "paper:p1", save, live: { doc, persist }, ...extra });
  return { host, doc, handle, save, persist };
}

const cardIds = (host: HTMLElement): (string | undefined)[] => [...host.querySelectorAll<HTMLElement>(".qmd-note-file-item")].map((card) => card.dataset["itemId"]);
const until = async (check: () => boolean, ms = 2000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

beforeEach(() => { mockMounts.length = 0; });
afterEach(() => { document.body.replaceChildren(); jest.useRealTimers(); });

describe("mountNoteFile with live", () => {
  it("4.1d mounts one editor per item of the doc, in doc order, in cards named by the item ids", () => {
    const { host, handle } = mount(FILE);
    expect(mockMounts).toHaveLength(2);
    expect(cardIds(host)).toEqual([A, B]);
    expect(handle.editors.map((editor) => editor.itemId)).toEqual([A, B]);
  });

  it("4.1d binds each editor to its item's fragment of the doc", () => {
    const { doc, handle } = mount(FILE);
    const items = listQmdItems(doc);
    expect(mockMounts[0]!.options["collab"].fragment).toBe(items[0]!.fragment);
    expect(mockMounts[1]!.options["collab"].fragment).toBe(items[1]!.fragment);
    expect(mockMounts[0]!.options["collab"].fragment).toBe(bodies(doc).get(A));
    expect(handle.editors[1]!.handle).toBe(mockMounts[1]!.handle);
  });

  it("4.1d gives the editors no awareness", () => {
    mount(FILE);
    for (const { options } of mockMounts) {
      expect(options["collab"]).toBeDefined();
      expect(options["collab"].awareness).toBeUndefined();
    }
  });

  it("4.1d takes each editor's header from the item's fence", () => {
    mount(FILE);
    expect(mockMounts[0]!.options["meta"]).toEqual({ author: "Ana", date: "2026-03-04" });
    expect(mockMounts[1]!.options["meta"]).toEqual({ author: "Ana" });
  });

  it("4.1d ignores options.text and takes the items from the doc", () => {
    const { host } = mount(FILE, { text: item("n-ZZZ", "From the text option") });
    expect(cardIds(host)).toEqual([A, B]);
    expect(mockMounts).toHaveLength(2);
  });

  it("4.1d never calls save when an editor reports an edit", () => {
    const { save } = mount(FILE);
    for (const { options } of mockMounts) { options["onChange"]?.("An edited body\n"); }
    expect(save).not.toHaveBeenCalled();
  });

  it("4.1d mounts only the editor of an added item and keeps the others", () => {
    const { host, doc, handle } = mount(FILE);
    const before = handle.editors.map((editor) => editor.handle);
    setQmdDocText(doc, `${FILE}\n${item(C, "Third item")}`, "edit");
    expect(mockMounts).toHaveLength(3);
    expect(mockMounts[2]!.options["collab"].fragment).toBe(bodies(doc).get(C));
    expect(mockMounts[0]!.destroyed).toBe(false);
    expect(mockMounts[1]!.destroyed).toBe(false);
    expect(cardIds(host)).toEqual([A, B, C]);
    expect(handle.editors.map((editor) => editor.itemId)).toEqual([A, B, C]);
    expect(handle.editors[0]!.handle).toBe(before[0]);
    expect(handle.editors[1]!.handle).toBe(before[1]);
  });

  it("4.1d destroys only the editor of a removed item and keeps the others", () => {
    const { host, doc, handle } = mount(`${FILE}\n${item(C, "Third item")}`);
    expect(mockMounts).toHaveLength(3);
    const kept = [handle.editors[0]!.handle, handle.editors[2]!.handle];
    setQmdDocText(doc, `Intro.\n\n${item(A, "First item", ` author="Ana" created="2026-03-04T10:00:00Z"`)}\n${item(C, "Third item")}`, "edit");
    expect(mockMounts).toHaveLength(3);
    expect(mockMounts.map((mount) => mount.destroyed)).toEqual([false, true, false]);
    expect(cardIds(host)).toEqual([A, C]);
    expect(handle.editors.map((editor) => editor.itemId)).toEqual([A, C]);
    expect(handle.editors[0]!.handle).toBe(kept[0]);
    expect(handle.editors[1]!.handle).toBe(kept[1]);
  });

  it("4.1d follows a reorder of the doc without mounting or destroying an editor", () => {
    const { host, doc, handle } = mount(FILE);
    const before = new Map(handle.editors.map((editor) => [editor.itemId, editor.handle]));
    setQmdDocText(doc, `${item(B, "Second item")}\n${item(A, "First item", ` author="Ana" created="2026-03-04T10:00:00Z"`)}`, "edit");
    expect(mockMounts).toHaveLength(2);
    expect(mountsOf()).toHaveLength(2);
    expect(cardIds(host)).toEqual([B, A]);
    expect(handle.editors.map((editor) => editor.itemId)).toEqual([B, A]);
    expect(handle.editors[0]!.handle).toBe(before.get(B));
    expect(handle.editors[1]!.handle).toBe(before.get(A));
  });

  it("4.1d keeps every editor when an item's body changes in place", () => {
    const { doc, handle } = mount(FILE);
    const before = handle.editors.map((editor) => editor.handle);
    setQmdDocText(doc, FILE.replace("Second item", "Second item, changed"), "edit");
    expect(mockMounts).toHaveLength(2);
    expect(mountsOf()).toHaveLength(2);
    expect(handle.editors.map((editor) => editor.handle)).toEqual(before);
  });

  it("4.1d remounts an item whose fragment instance changed and keeps the others", () => {
    const { doc, handle } = mount(FILE);
    const other = handle.editors[0]!.handle;
    const replacement = new Y.XmlFragment();
    doc.transact(() => { bodies(doc).set(B, replacement); });
    expect(mockMounts).toHaveLength(3);
    expect(mockMounts[1]!.destroyed).toBe(true);
    expect(mockMounts[0]!.destroyed).toBe(false);
    expect(mockMounts[2]!.options["collab"].fragment).toBe(replacement);
    expect(handle.editors.map((editor) => editor.itemId)).toEqual([A, B]);
    expect(handle.editors[0]!.handle).toBe(other);
    expect(handle.editors[1]!.handle).toBe(mockMounts[2]!.handle);
  });

  it("4.1d does not call save when the doc's items change", () => {
    const { doc, save } = mount(FILE);
    setQmdDocText(doc, `${FILE}\n${item(C, "Third item")}`, "edit");
    expect(save).not.toHaveBeenCalled();
  });

  it("4.1d calls live.persist when the note bar flushes before Run all, without options.flush", async () => {
    // Run all is disabled without a cell runner, so the mount gets one.
    const runCell = jest.fn(async () => ({ status: "ok" as const, language: "python" as const, text: "ok", durationMs: 1 }));
    const { host, persist } = mount(FILE, { cells: { runCell } });
    host.querySelector<HTMLButtonElement>(".qmd-note-run-all")!.click();
    await until(() => persist.mock.calls.length > 0);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("4.1d does not call live.persist on mounting or on item changes", () => {
    const { doc, persist } = mount(FILE);
    setQmdDocText(doc, `${FILE}\n${item(C, "Third item")}`, "edit");
    expect(persist).not.toHaveBeenCalled();
  });

  it("4.1d destroy destroys the editors, removes the mount and stops following the doc", () => {
    const { host, doc, handle } = mount(FILE);
    handle.destroy();
    expect(mockMounts.every((mount) => mount.destroyed)).toBe(true);
    expect(host.children).toHaveLength(0);
    setQmdDocText(doc, `${FILE}\n${item(C, "Third item")}`, "edit");
    expect(mockMounts).toHaveLength(2);
    expect(host.children).toHaveLength(0);
  });

  it("4.1d says the note is empty for an empty doc when the host cannot add items", () => {
    const { host } = mount("");
    expect(mockMounts).toHaveLength(0);
    expect(host.textContent).toContain("is empty");
  });

  it("4.1d offers an editor on an empty doc when the host can add items, and reports its first text through create", () => {
    const create = jest.fn();
    const { host } = mount("", { create });
    expect(mockMounts).toHaveLength(1);
    expect(host.querySelectorAll(".qmd-note-file-item.is-new")).toHaveLength(1);
    mockMounts[0]!.options["onChange"]("First words\n");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![1]).toBe("First words\n");
  });

  it("4.1d mounts the editors of items that arrive in an empty doc", () => {
    const { host, doc } = mount("");
    setQmdDocText(doc, FILE, "peer");
    expect(cardIds(host)).toEqual([A, B]);
    expect(mockMounts.filter((mount) => mount.options["collab"]).map((mount) => mount.options["collab"].fragment)).toEqual([bodies(doc).get(A), bodies(doc).get(B)]);
  });
});
