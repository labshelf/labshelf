/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The marks on inserted equations, "Update from note" as one undo step, no write on a diverged copy, the picker's groups and the insert on its own lines.
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { buildInsert, listNoteInsertables, type ILogger, type NoteInsertable, type NoteInsertSource, type PaperRecord } from "@labshelf/core";
import { pickQuickEntry, showToast, type QuickPickEntry } from "@labshelf/core/dom";
import { createNoteLinks } from "../../src/writing/noteLinks";

jest.mock("@labshelf/core/dom", () => ({ ...jest.requireActual("@labshelf/core/dom"), pickQuickEntry: jest.fn(), showToast: jest.fn() }));
jest.mock("@labshelf/core", () => {
  const actual = jest.requireActual("@labshelf/core");
  return { ...actual, listNoteInsertables: jest.fn(actual.listNoteInsertables) };
});

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const NOTE_PATH = "notes/energy.qmd";
const note = (formula: string, label = "eq-energy"): string => `Energy.\n\n$$ ${formula} $$ {#${label}}\n`;

function sourceOf(notes: { text: string }): NoteInsertSource {
  return {
    listProjectNotes: async () => (notes.text === "" ? [] : [{ path: NOTE_PATH, title: "Energy" }]),
    readProjectNote: async () => notes.text,
    listCitedPaperIds: async () => [],
    readPaperNote: async () => undefined,
  };
}

/** The manuscript text of the first equation of `notes`, as "Insert from note" writes it. */
async function insertedBlock(notes: { text: string }): Promise<string> {
  const [item] = await listNoteInsertables(sourceOf(notes));
  return buildInsert(item!, "latex");
}

function setup(doc: string, notes: { text: string }, papers: PaperRecord[] = [], cursor = 0) {
  const links = createNoteLinks({ language: "latex", source: sourceOf(notes), papers: async () => papers, logger });
  const view = new EditorView({ parent: document.createElement("div"), state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [history(), links.extension] }) });
  return { links, view, actions: links.actionsFor(view) };
}

const marksOf = (view: EditorView, state: string): HTMLElement[] => [...view.dom.querySelectorAll<HTMLElement>(`.ls-origin-${state}`)];

// jsdom has no layout: scrolling the inserted text into view measures ranges.
beforeAll(() => {
  const empty = { length: 0, item: () => null, [Symbol.iterator]: function* () { /* no rects */ } } as unknown as DOMRectList;
  Range.prototype.getClientRects = () => empty;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

afterEach(() => jest.clearAllMocks());

describe("marks", () => {
  it("draws no mark on a fresh copy", async () => {
    const notes = { text: note("E = mc^2") };
    const { links, view } = setup(await insertedBlock(notes), notes);
    await links.refresh(view);
    expect(view.dom.querySelector(".ls-origin-mark")).toBeNull();
  });

  it("marks the origin comment of a stale copy with its sentence", async () => {
    const notes = { text: note("E = mc^2") };
    const { links, view } = setup(await insertedBlock(notes), notes);
    notes.text = note("E = mc^3");
    await links.refresh(view);
    const [mark] = marksOf(view, "stale");
    expect(mark).toBeDefined();
    expect(mark!.textContent).toMatch(/^%/);
    expect(mark!.getAttribute("title")).toBe("eq-energy: the note changed since it was inserted. Update from note replaces this copy.");
  });

  it("marks a copy edited here as diverged", async () => {
    const notes = { text: note("E = mc^2") };
    const { links, view } = setup((await insertedBlock(notes)).replace("E = mc^2", "E = m c^2"), notes);
    await links.refresh(view);
    expect(marksOf(view, "diverged")).toHaveLength(1);
    expect(marksOf(view, "diverged")[0]!.getAttribute("title")).toBe("eq-energy: edited here, so it differs from the note. LabShelf will not overwrite it.");
  });

  it("marks a copy edited here and changed in the note as both", async () => {
    const notes = { text: note("E = mc^2") };
    const { links, view } = setup((await insertedBlock(notes)).replace("E = mc^2", "E = m c^2"), notes);
    notes.text = note("E = mc^3");
    await links.refresh(view);
    expect(marksOf(view, "both")).toHaveLength(1);
    expect(marksOf(view, "both")[0]!.getAttribute("title")).toBe("eq-energy: edited here and changed in the note. LabShelf will not overwrite it.");
  });

  it("marks a copy whose label left the note as missing, naming the note", async () => {
    const notes = { text: note("E = mc^2") };
    const { links, view } = setup(await insertedBlock(notes), notes);
    notes.text = note("E = mc^2", "eq-other");
    await links.refresh(view);
    expect(marksOf(view, "missing")[0]!.getAttribute("title")).toBe(`eq-energy: not found in ${NOTE_PATH}. The note or its label was removed or renamed.`);
  });
});

describe("Update from note", () => {
  it("replaces a stale copy in one transaction, and one undo restores it", async () => {
    const notes = { text: note("E = mc^2") };
    const original = await insertedBlock(notes);
    const { links, view, actions } = setup(original, notes);
    notes.text = note("E = mc^3");
    await links.refresh(view);
    const updated = await insertedBlock(notes);

    await actions.update();

    expect(view.state.doc.toString()).toBe(updated);
    expect(view.state.doc.toString()).toContain("E = mc^3");
    expect(view.dom.querySelector(".ls-origin-mark")).toBeNull();
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(original);
    expect(undo(view)).toBe(false);
  });

  it("writes nothing for a diverged copy", async () => {
    const notes = { text: note("E = mc^2") };
    const edited = (await insertedBlock(notes)).replace("E = mc^2", "E = m c^2");
    const { links, view, actions } = setup(edited, notes);
    notes.text = note("E = mc^3");
    await links.refresh(view);
    const before = view.state.doc;

    await actions.update();

    expect(view.state.doc).toBe(before);
    expect(view.state.doc.toString()).toBe(edited);
    expect(undo(view)).toBe(false);
    expect(showToast).toHaveBeenCalledWith("eq-energy: edited here and changed in the note. LabShelf will not overwrite it.", "info");
  });

  it("writes nothing for a diverged copy whose note did not change", async () => {
    const notes = { text: note("E = mc^2") };
    const edited = (await insertedBlock(notes)).replace("E = mc^2", "E = m c^2");
    const { view, actions } = setup(edited, notes);

    await actions.update();

    expect(view.state.doc.toString()).toBe(edited);
  });

  it("writes nothing for a missing copy", async () => {
    const notes = { text: note("E = mc^2") };
    const original = await insertedBlock(notes);
    const { view, actions } = setup(original, notes);
    notes.text = note("E = mc^2", "eq-other");

    await actions.update();

    expect(view.state.doc.toString()).toBe(original);
  });
});

describe("Insert from note", () => {
  const items: NoteInsertable[] = [
    { notePath: NOTE_PATH, label: "eq-energy", latex: "E = mc^2", source: "equation", title: "Energy" },
    { notePath: "paper:p1/notes.qmd", label: "eq-paper", latex: "a = b", source: "equation", title: "p1" },
    { notePath: "paper:p2/notes.qmd", label: "eq-untitled", latex: "c = d", source: "equation", title: "p2" },
    { notePath: NOTE_PATH, label: "fig-fit", latex: "y = x", source: "output", title: "Energy" },
    { notePath: NOTE_PATH, label: "fig-old", latex: "z = x", source: "output", title: "Energy", outOfDate: true },
  ];
  const papers = [{ id: "p1", title: "A paper on things" }] as unknown as PaperRecord[];

  it("offers Equations then Outputs with the note or paper title and the out of date flag", async () => {
    const notes = { text: note("E = mc^2") };
    const { listNoteInsertables: list } = jest.requireMock("@labshelf/core") as { listNoteInsertables: jest.Mock };
    list.mockResolvedValueOnce(items);
    (pickQuickEntry as jest.Mock).mockResolvedValueOnce(undefined);
    const { actions } = setup("", notes, papers);

    await actions.insert();

    const [entries, options] = (pickQuickEntry as jest.Mock).mock.calls[0] as [QuickPickEntry<NoteInsertable>[], unknown];
    expect(options).toEqual({ title: "Insert from note", placeholder: "Search equations and outputs by label or note" });
    expect(entries.map((entry) => ("kind" in entry ? `-- ${entry.label}` : `${entry.label} | ${entry.description}`))).toEqual([
      "-- Equations",
      "eq-energy | Energy",
      "eq-paper | A paper on things",
      "eq-untitled | p2",
      "-- Outputs",
      "fig-fit | Energy",
      "fig-old | Energy · out of date",
    ]);
  });

  it("omits a group with no items", async () => {
    const { listNoteInsertables: list } = jest.requireMock("@labshelf/core") as { listNoteInsertables: jest.Mock };
    list.mockResolvedValueOnce([items[3]]);
    (pickQuickEntry as jest.Mock).mockResolvedValueOnce(undefined);
    const { actions } = setup("", { text: "" });

    await actions.insert();

    const [entries] = (pickQuickEntry as jest.Mock).mock.calls[0] as [QuickPickEntry<NoteInsertable>[]];
    expect(entries.filter((entry) => "kind" in entry).map((entry) => entry.label)).toEqual(["Outputs"]);
  });

  it("opens no picker and says so when the notes have nothing to insert", async () => {
    const { actions, view } = setup("text", { text: "" });

    await actions.insert();

    expect(pickQuickEntry).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("No equations or outputs found in this project's notes or the cited papers' notes.", "info");
    expect(view.state.doc.toString()).toBe("text");
  });

  it("inserts nothing when the picker is dismissed", async () => {
    const { actions, view } = setup("text", { text: note("E = mc^2") });
    (pickQuickEntry as jest.Mock).mockResolvedValueOnce(undefined);

    await actions.insert();

    expect(view.state.doc.toString()).toBe("text");
  });

  it("inserts nothing for an out-of-date output and shows why", async () => {
    const { listNoteInsertables: list } = jest.requireMock("@labshelf/core") as { listNoteInsertables: jest.Mock };
    list.mockResolvedValueOnce([items[4]]);
    (pickQuickEntry as jest.Mock).mockResolvedValueOnce(items[4]);
    const { actions, view } = setup("text", { text: "" });

    await actions.insert();

    expect(view.state.doc.toString()).toBe("text");
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("fig-old is out of date"), expect.any(String));
  });

  it("puts the block and its origin comment on their own lines inside a line of text", async () => {
    const notes = { text: note("E = mc^2") };
    const block = await insertedBlock(notes);
    const [item] = await listNoteInsertables(sourceOf(notes));
    (pickQuickEntry as jest.Mock).mockResolvedValueOnce(item);
    const { actions, view } = setup("alpha beta", notes, [], 6);

    await actions.insert();

    const lines = view.state.doc.toString().split("\n");
    expect(lines[0]).toBe("alpha ");
    expect(lines.slice(1, -1).join("\n")).toBe(block);
    expect(lines.at(-1)).toBe("beta");
    expect(view.dom.querySelector(".ls-origin-mark")).toBeNull();
  });

  it("adds no line breaks on an empty line", async () => {
    const notes = { text: note("E = mc^2") };
    const block = await insertedBlock(notes);
    const [item] = await listNoteInsertables(sourceOf(notes));
    (pickQuickEntry as jest.Mock).mockResolvedValueOnce(item);
    const { actions, view } = setup("one\n\ntwo", notes, [], 4);

    await actions.insert();

    expect(view.state.doc.toString()).toBe(`one\n${block}\ntwo`);
  });

  it("shows the Typst error and inserts nothing in a Typst file", async () => {
    const notes = { text: note("E = mc^2") };
    const [item] = await listNoteInsertables(sourceOf(notes));
    (pickQuickEntry as jest.Mock).mockResolvedValueOnce(item);
    const links = createNoteLinks({ language: "typst", source: sourceOf(notes), papers: async () => [], logger });
    const view = new EditorView({ parent: document.createElement("div"), state: EditorState.create({ doc: "x", extensions: [links.extension] }) });

    await links.actionsFor(view).insert();

    expect(view.state.doc.toString()).toBe("x");
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Typst"), expect.any(String));
  });

  it("logs and shows an error when the notes cannot be read", async () => {
    const { listNoteInsertables: list } = jest.requireMock("@labshelf/core") as { listNoteInsertables: jest.Mock };
    list.mockRejectedValueOnce(new Error("disk gone"));
    const { actions } = setup("x", { text: "" });

    await actions.insert();

    expect(pickQuickEntry).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("Could not read the notes: disk gone", "error");
    expect(logger.error).toHaveBeenCalled();
  });
});
