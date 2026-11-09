/** @jest-environment jsdom */
/**
 * The deck toolbar of a LaTeX or Typst talk or poster on a real CodeMirror view: the talk and poster groups, no groups for an article,
 * Insert slide as one undo step, every change applied as the smallest splice, and Aspect ratio rewriting the class options.
 */
// These tests run Typst decks, which are off in the product.
jest.mock("../../../src/decks/typstDecks", () => ({ TYPST_DECKS_ENABLED: true }));
import { EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, undoDepth } from "@codemirror/commands";
import { scaffoldSourceDeck } from "../../../src/decks/sourceDeckScaffold";
import { readSourceDeckOutline } from "../../../src/decks/sourceDeckOutline";
import { createDeckEditing, createDeckToolbarGroups, readDeckKindOf } from "../../../src/writing/dom/sourceEditor/deckTools";
import type { SourceToolbarDropdown, SourceToolbarItem, SourceToolbarMenu } from "../../../src/writing/dom/sourceEditor/toolbar";
import type { MenuEntry } from "../../../src/ui/dom/index";

const views: EditorView[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.innerHTML = "";
});

const hooks = { present: jest.fn(), posterPreview: jest.fn() };

function mount(doc: string, cursor = 0, seen?: Transaction[]): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [history()] }),
    ...(seen ? { dispatchTransactions: (trs: readonly Transaction[], v: EditorView) => { seen.push(...trs); v.update(trs); } } : {}),
  });
  views.push(view);
  return view;
}

const labels = (groups: SourceToolbarItem[][]): string[][] => groups.map((group) => group.map((item) => item.label));
const find = (groups: SourceToolbarItem[][], label: string): SourceToolbarItem => groups.flat().find((item) => item.label === label)!;
const entry = (entries: MenuEntry[], label: string) => entries.find((e) => e !== "separator" && e.label === label) as Exclude<MenuEntry, "separator">;

const beamer = scaffoldSourceDeck("latex", "T", { kind: "talk", aspect: "16:9" });
const typstTalk = scaffoldSourceDeck("typst", "T", { kind: "talk", aspect: "16:9" });
const tikz = scaffoldSourceDeck("latex", "T", { kind: "poster", size: { w: 841, h: 1189, unit: "mm" }, paper: "a0" });
const ARTICLE = "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n";

describe("createDeckToolbarGroups", () => {
  it("gives a talk Present, the slide tools and Aspect ratio", () => {
    const view = mount(beamer);
    expect(labels(createDeckToolbarGroups("talks/t/main.tex", createDeckEditing(view), hooks))).toEqual([
      ["Present"], ["Insert slide", "Go to slide", "Slide at the cursor"], ["Aspect ratio"],
    ]);
    const typst = mount(typstTalk);
    expect(labels(createDeckToolbarGroups("talks/t/main.typ", createDeckEditing(typst), hooks))[0]).toEqual(["Present"]);
  });

  it("gives a poster Real size, the block tools and Poster size", () => {
    const view = mount(tikz);
    const groups = createDeckToolbarGroups("posters/p/main.tex", createDeckEditing(view), hooks);
    expect(labels(groups)).toEqual([["Real size"], ["Insert block", "Go to block"], ["Poster size"]]);
    (find(groups, "Real size") as { run(): void }).run();
    expect(hooks.posterPreview).toHaveBeenCalled();
  });

  it("gives an article, or no editor, no groups", () => {
    const view = mount(ARTICLE);
    expect(createDeckToolbarGroups("paper/main.tex", createDeckEditing(view), hooks)).toEqual([]);
    expect(createDeckToolbarGroups("talks/t/main.tex", undefined, hooks)).toEqual([]);
    expect(readDeckKindOf("notes/a.md", beamer)).toBeUndefined();
    expect(readDeckKindOf("projects/x/talks/t/main.typ", "= Intro\n")).toBe("talk");
  });
});

describe("Insert slide", () => {
  it("adds the slide after the one at the cursor as one undo step", () => {
    const view = mount(beamer, beamer.indexOf("Motivation"));
    const groups = createDeckToolbarGroups("talks/t/main.tex", createDeckEditing(view), hooks);
    const before = readSourceDeckOutline("latex", "talk", beamer).length;
    const menu = (find(groups, "Insert slide") as SourceToolbarMenu).menu();
    (menu[0] as Exclude<MenuEntry, "separator">).onSelect();
    const after = view.state.doc.toString();
    expect(readSourceDeckOutline("latex", "talk", after)).toHaveLength(before + 1);
    expect(undoDepth(view.state)).toBe(1);
    undo(view);
    expect(view.state.doc.toString()).toBe(beamer);
  });
});

describe("createDeckEditing.apply", () => {
  it("dispatches only the changed range", () => {
    const seen: Transaction[] = [];
    const view = mount("abcdefgh", 0, seen);
    createDeckEditing(view).apply({ text: "abcXYfgh", cursor: 5 });
    expect(seen).toHaveLength(1);
    const ranges: [number, number, string][] = [];
    seen[0]!.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => ranges.push([fromA, toA, inserted.toString()]));
    expect(ranges).toEqual([[3, 5, "XY"]]);
    expect(view.state.doc.toString()).toBe("abcXYfgh");
    expect(view.state.selection.main.head).toBe(5);
  });

  it("splices a pure insertion and a repeated character without touching the rest", () => {
    const seen: Transaction[] = [];
    const view = mount("aaaa", 0, seen);
    createDeckEditing(view).apply({ text: "aaaaa", cursor: 5 });
    const ranges: [number, number, string][] = [];
    seen[0]!.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => ranges.push([fromA, toA, inserted.toString()]));
    expect(ranges).toEqual([[4, 4, "a"]]);
    expect(view.state.doc.toString()).toBe("aaaaa");
  });

  it("splices a Move slide down within the moved slides", () => {
    const seen: Transaction[] = [];
    const at = beamer.indexOf("Motivation");
    const view = mount(beamer, at, seen);
    const groups = createDeckToolbarGroups("talks/t/main.tex", createDeckEditing(view), hooks);
    entry((find(groups, "Slide at the cursor") as SourceToolbarMenu).menu(), "Move slide down").onSelect();
    const slides = readSourceDeckOutline("latex", "talk", beamer);
    const text = view.state.doc.toString();
    expect(readSourceDeckOutline("latex", "talk", text).map((s) => s.title)).toEqual(["Title page", "Results", "Motivation", "Conclusion"]);
    const ranges: [number, number][] = [];
    seen.at(-1)!.changes.iterChanges((fromA, toA) => ranges.push([fromA, toA]));
    expect(ranges).toHaveLength(1);
    expect(ranges[0]![0]).toBeGreaterThanOrEqual(slides[1]!.start);
    expect(ranges[0]![1]).toBeLessThanOrEqual(slides[3]!.start);
  });
});

describe("Aspect ratio", () => {
  it("reads the current ratio and rewrites the class options", () => {
    const view = mount(beamer);
    const dropdown = find(createDeckToolbarGroups("talks/t/main.tex", createDeckEditing(view), hooks), "Aspect ratio") as SourceToolbarDropdown;
    expect(dropdown.options.map((o) => o.value)).toEqual(["16:9", "4:3"]);
    expect(dropdown.current()).toBe("16:9");
    dropdown.pick("4:3");
    expect(view.state.doc.toString()).toContain("\\documentclass[aspectratio=43]{beamer}");
    expect(dropdown.current()).toBe("4:3");
    expect(undoDepth(view.state)).toBe(1);
    dropdown.pick("4:3");
    expect(undoDepth(view.state)).toBe(1);
  });
});
