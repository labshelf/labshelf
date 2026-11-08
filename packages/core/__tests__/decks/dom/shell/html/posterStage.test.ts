/**
 * @jest-environment jsdom
 */
// Spec 10.2 (A10, HTML half): the poster stage of a sectioned HTML poster: section drag with a drop indicator, gap handles that resize the neighbours,
// locked section and header boxes, and the controller's html+theme replace. jsdom has no layout: the editor's scale is 1 and every stage offset is 0,
// so a pointer at (x, y) is the slide point (x, y). Rects come from readPosterLayout; expected edits from the 10.1 edit functions.
import { parseDeck } from "../../../../../src/decks/deckParse";
import { readPosterLayout, type PosterGap, type PosterLayout } from "../../../../../src/decks/posterSections";
import { movePosterSection, reflowPoster, resizePosterGap } from "../../../../../src/decks/posterSectionEdits";
import { DECK, host, lastChange, openWs, POSTER, settle, workspace } from "./shellHarness";

const THEME = ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; --poster-columns: 1 1 1; }\n";
const section = (id: string, column: number, title: string): string =>
  `<div data-block="${id}" data-poster="section" data-column="${column}" style="left: 0px; top: 0px; width: 10px; height: 10px;"><h2>${title}</h2><p>Text of ${title}.</p></div>`;
const RAW = [
  "<!doctype html>",
  '<html lang="en" data-deck="poster" data-deck-version="1" data-deck-size="841x1189mm">',
  '<head>\n<meta charset="utf-8">\n<title>Poster</title>\n<link rel="stylesheet" href="theme.css" data-deck-theme>\n</head>',
  "<body>",
  [
    "<section data-slide>",
    '<div data-block="head" data-poster="header" style="left: 0px; top: 0px; width: 10px; height: 10px;"><h1>Poster</h1><p>Authors</p></div>',
    section("s1", 0, "One"),
    section("s2", 0, "Two"),
    section("s3", 1, "Three"),
    section("s4", 2, "Four"),
    '<div data-block="logo" style="left: 40px; top: 40px; width: 120px; height: 120px;"><p>Logo</p></div>',
    "</section>",
  ].join("\n"),
  "</body>",
  "</html>",
  "",
].join("\n");

function fixture(): { html: string; theme: string } {
  const result = reflowPoster(RAW, THEME);
  if (!result.ok) throw new Error(result.error);
  return { html: result.html, theme: result.theme };
}
const START = fixture();
const layoutOf = (html: string = START.html, theme: string = START.theme): PosterLayout => {
  const layout = readPosterLayout(html, theme);
  if (!layout) throw new Error("not a sectioned poster");
  return layout;
};
const idsOf = (layout: PosterLayout): string[][] => layout.columns.map((column) => column.map((box) => box.id));
const rectOf = (html: string, id: string) => parseDeck(html).model!.slides[0]!.blocks.find((block) => block.id === id)?.rect;
const centre = (rect: { left: number; top: number; width: number; height: number }) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

const openPoster = (): ReturnType<typeof openWs> => openWs(START.html, { theme: START.theme });
const boxOf = (id: string): HTMLElement => host.querySelector<HTMLElement>(`[data-block-box="${id}"]`)!;
const gapEls = (): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>(".dsh-poster-gap"));
const gapEl = (gap: PosterGap): HTMLElement =>
  gapEls().find((el) => el.getAttribute("data-gap-kind") === gap.kind && el.getAttribute("data-gap-index") === String(gap.index) && el.getAttribute("data-gap-column") === String(gap.column))!;
const dropVisible = (): boolean => {
  const el = host.querySelector<HTMLElement>(".dsh-poster-drop");
  return el !== null && !el.hidden && el.style.display !== "none" && el.style.visibility !== "hidden";
};
const selected = (): string[] =>
  Array.from(host.querySelectorAll<HTMLElement>("[data-block-box]")).filter((el) => el.classList.contains("is-selected")).map((el) => el.getAttribute("data-block-box")!);

function fire(type: string, target: Element, x: number, y: number): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
}
/** A gesture on the element found by `find` (looked up again for each event, as a redraw may replace it): press, a first small move, a move to the end point, optionally release. */
function drag(find: () => Element, from: { x: number; y: number }, to: { x: number; y: number }, release = true): void {
  fire("pointerdown", find(), from.x, from.y);
  fire("pointermove", find(), from.x + Math.sign(to.x - from.x) * 6, from.y + Math.sign(to.y - from.y) * 6);
  fire("pointermove", find(), to.x, to.y);
  if (release) fire("pointerup", find(), to.x, to.y);
}
const escape = (): void => void boxOf("s1").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

describe("10.2a dragging a section", () => {
  it("10.2a releasing a section over another column moves it there as one change labelled Move section", async () => {
    const onChange = await openPoster();
    const layout = layoutOf();
    const target = layout.columns[2]![0]!.rect;
    drag(() => boxOf("s1"), centre(layout.columns[0]![0]!.rect), { x: centre(target).x, y: target.top + 5 });
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Move section");
    expect(idsOf(layoutOf(change.html, change.theme))).toEqual([["s2"], ["s3"], ["s1", "s4"]]);
    const moved = movePosterSection(START.html, START.theme, "s1", 2, 0);
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(change.html).toBe(moved.html);
      expect(change.theme).toBe(moved.theme);
    }
  });

  it("10.2a the moved section is reflowed into its new column's cell", async () => {
    const onChange = await openPoster();
    const layout = layoutOf();
    const target = layout.columns[2]![0]!.rect;
    drag(() => boxOf("s1"), centre(layout.columns[0]![0]!.rect), { x: centre(target).x, y: target.top + 5 });
    await settle();
    const { html, theme } = lastChange(onChange);
    const after = layoutOf(html, theme);
    expect(rectOf(html, "s1")).toEqual(after.columns[2]![0]!.rect);
    expect(rectOf(html, "s4")).toEqual(after.columns[2]![1]!.rect);
  });

  it("10.2a a pointer below a column's last section centre drops after it", async () => {
    const onChange = await openPoster();
    const layout = layoutOf();
    const target = layout.columns[2]![0]!.rect;
    drag(() => boxOf("s1"), centre(layout.columns[0]![0]!.rect), { x: centre(target).x, y: target.top + target.height - 5 });
    await settle();
    const change = lastChange(onChange);
    expect(idsOf(layoutOf(change.html, change.theme))).toEqual([["s2"], ["s3"], ["s4", "s1"]]);
  });

  it("10.2a a pointer between two sections drops between them", async () => {
    const onChange = await openPoster();
    const layout = layoutOf();
    const second = layout.columns[0]![1]!.rect;
    drag(() => boxOf("s4"), centre(layout.columns[2]![0]!.rect), { x: centre(second).x, y: second.top + 5 });
    await settle();
    const change = lastChange(onChange);
    expect(change.label).toBe("Move section");
    expect(idsOf(layoutOf(change.html, change.theme))).toEqual([["s1", "s4", "s2"], ["s3"], []]);
  });

  it("10.2a the drop indicator shows during the drag, the root is dragging, and both clear on release", async () => {
    await openPoster();
    const layout = layoutOf();
    const target = layout.columns[2]![0]!.rect;
    expect(dropVisible()).toBe(false);
    drag(() => boxOf("s1"), centre(layout.columns[0]![0]!.rect), { x: centre(target).x, y: target.top + 5 }, false);
    expect(dropVisible()).toBe(true);
    expect(workspace!.element.classList.contains("is-dragging")).toBe(true);
    fire("pointerup", boxOf("s1"), centre(target).x, target.top + 5);
    await settle();
    expect(dropVisible()).toBe(false);
    expect(workspace!.element.classList.contains("is-dragging")).toBe(false);
  });

  it("10.2a a movement under 4 px shows no indicator", async () => {
    await openPoster();
    const start = centre(layoutOf().columns[0]![0]!.rect);
    fire("pointerdown", boxOf("s1"), start.x, start.y);
    fire("pointermove", boxOf("s1"), start.x + 2, start.y + 1);
    expect(dropVisible()).toBe(false);
    fire("pointerup", boxOf("s1"), start.x + 2, start.y + 1);
  });

  it("10.2a Escape during the drag cancels it and commits nothing", async () => {
    const onChange = await openPoster();
    const layout = layoutOf();
    const target = layout.columns[2]![0]!.rect;
    drag(() => boxOf("s1"), centre(layout.columns[0]![0]!.rect), { x: centre(target).x, y: target.top + 5 }, false);
    escape();
    fire("pointerup", boxOf("s1"), centre(target).x, target.top + 5);
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    expect(dropVisible()).toBe(false);
    expect(workspace!.element.classList.contains("is-dragging")).toBe(false);
  });

  it("10.2a pointercancel during the drag cancels it and commits nothing", async () => {
    const onChange = await openPoster();
    const layout = layoutOf();
    const target = layout.columns[2]![0]!.rect;
    drag(() => boxOf("s1"), centre(layout.columns[0]![0]!.rect), { x: centre(target).x, y: target.top + 5 }, false);
    fire("pointercancel", boxOf("s1"), centre(target).x, target.top + 5);
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    expect(dropVisible()).toBe(false);
  });

  it("10.2a releasing without movement is a plain select and commits nothing", async () => {
    const onChange = await openPoster();
    const start = centre(layoutOf().columns[0]![1]!.rect);
    fire("pointerdown", boxOf("s2"), start.x, start.y);
    fire("pointerup", boxOf("s2"), start.x, start.y);
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    expect(selected()).toEqual(["s2"]);
  });

  it("10.2a the move is one undo step", async () => {
    const onChange = await openPoster();
    const layout = layoutOf();
    const target = layout.columns[2]![0]!.rect;
    drag(() => boxOf("s1"), centre(layout.columns[0]![0]!.rect), { x: centre(target).x, y: target.top + 5 });
    await settle();
    workspace!.undo();
    await settle();
    const back = lastChange(onChange);
    expect(back.html).toBe(START.html);
    expect(back.theme).toBe(START.theme);
  });

  it("10.2a controller replace commits the html and theme as one labelled change and undoes as one step", async () => {
    const onChange = await openPoster();
    const gap = layoutOf().gaps.find((g) => g.kind === "column")!;
    const resized = resizePosterGap(START.html, START.theme, gap, 120);
    if (!resized.ok) throw new Error(resized.error);
    expect(resized.theme).not.toBe(START.theme);
    workspace!.replace(resized.html, resized.theme, "Test replace");
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastChange(onChange)).toEqual({ html: resized.html, theme: resized.theme, label: "Test replace" });
    workspace!.undo();
    await settle();
    expect(lastChange(onChange).theme).toBe(START.theme);
    expect(lastChange(onChange).html).toBe(START.html);
  });
});

describe("10.2b section and header boxes are not free", () => {
  it("10.2b a press and move on a section box inside its own slot never moves it freely", async () => {
    const onChange = await openPoster();
    const own = layoutOf().columns[0]![0]!.rect;
    const start = centre(own);
    drag(() => boxOf("s1"), start, { x: start.x + 20, y: own.top + 10 }, false);
    expect(boxOf("s1").style.transform ?? "").toBe("");
    fire("pointerup", boxOf("s1"), start.x + 20, own.top + 10);
    await settle();
    for (const [change] of onChange.mock.calls) {
      expect(change.label).not.toBe("Move block");
      expect(rectOf(change.html, "s1")).toEqual(own);
    }
  });

  it("10.2b a section box takes no resize from its handles", async () => {
    const onChange = await openPoster();
    const own = layoutOf().columns[0]![0]!.rect;
    const handle = boxOf("s1").querySelector<HTMLElement>("[data-handle]");
    if (handle) {
      const at = { x: own.left + own.width, y: own.top + own.height };
      drag(() => boxOf("s1").querySelector("[data-handle]")!, at, { x: at.x + 80, y: at.y + 80 });
    }
    await settle();
    for (const [change] of onChange.mock.calls) {
      expect(change.label).not.toBe("Resize block");
      expect(rectOf(change.html, "s1")).toEqual(own);
    }
  });

  it("10.2b a header press with a move selects it and commits nothing", async () => {
    const onChange = await openPoster();
    const layout = layoutOf();
    const target = layout.columns[2]![0]!.rect;
    drag(() => boxOf("head"), centre(layout.header!.rect), { x: centre(target).x, y: target.top + 5 });
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    expect(dropVisible()).toBe(false);
    expect(selected()).toEqual(["head"]);
  });

  it("10.2b section and header boxes carry dsh-poster-locked and a free block does not", async () => {
    await openPoster();
    for (const id of ["head", "s1", "s2", "s3", "s4"]) expect(boxOf(id).classList.contains("dsh-poster-locked")).toBe(true);
    expect(boxOf("logo").classList.contains("dsh-poster-locked")).toBe(false);
  });

  it("10.2b the locked class survives a redraw", async () => {
    await openPoster();
    workspace!.selectBlocks(["s3"]);
    await settle();
    expect(boxOf("s3").classList.contains("dsh-poster-locked")).toBe(true);
    expect(boxOf("logo").classList.contains("dsh-poster-locked")).toBe(false);
  });

  it("10.2b a free block still drags as one Move block change", async () => {
    const onChange = await openPoster();
    const before = rectOf(START.html, "logo")!;
    const start = centre(before);
    drag(() => boxOf("logo"), start, { x: start.x + 200, y: start.y + 120 });
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Move block");
    expect(rectOf(change.html, "logo")!.left).toBeGreaterThan(before.left + 100);
    expect(rectOf(change.html, "logo")!.top).toBeGreaterThan(before.top + 50);
  });

  it("10.2b a free block drag shows no drop indicator and leaves the sections where they were", async () => {
    const onChange = await openPoster();
    const start = centre(rectOf(START.html, "logo")!);
    drag(() => boxOf("logo"), start, { x: start.x + 200, y: start.y + 120 }, false);
    expect(dropVisible()).toBe(false);
    fire("pointerup", boxOf("logo"), start.x + 200, start.y + 120);
    await settle();
    const { html } = lastChange(onChange);
    for (const id of ["head", "s1", "s2", "s3", "s4"]) expect(rectOf(html, id)).toEqual(rectOf(START.html, id));
  });
});

describe("10.2c gap handles", () => {
  it("10.2c the stage shows one gap handle per gap with its kind, index, column and label", async () => {
    await openPoster();
    const { gaps } = layoutOf();
    expect(gaps).toHaveLength(3);
    expect(gapEls()).toHaveLength(gaps.length);
    for (const gap of gaps) {
      const el = gapEl(gap);
      expect(el).toBeDefined();
      expect(el.getAttribute("aria-label")).toBe(gap.kind === "column" ? "Resize columns" : "Resize sections");
    }
  });

  it("10.2c dragging a column gap writes --poster-columns in theme.css as one change labelled Resize columns", async () => {
    const onChange = await openPoster();
    const gap = layoutOf().gaps.find((g) => g.kind === "column" && g.index === 0)!;
    const at = centre(gap.rect);
    drag(() => gapEl(gap), at, { x: at.x + 150, y: at.y });
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Resize columns");
    expect(change.theme).not.toBe(START.theme);
    expect(change.theme).toMatch(/--poster-columns:/);
    const columns = layoutOf(change.html, change.theme).settings.columns;
    expect(columns[0]!).toBeGreaterThan(columns[1]!);
    const expected = resizePosterGap(START.html, START.theme, gap, 150);
    expect(expected.ok).toBe(true);
    if (expected.ok) {
      expect(change.theme).toBe(expected.theme);
      expect(change.html).toBe(expected.html);
    }
  });

  it("10.2c dragging a section gap writes data-weight as one change labelled Resize sections", async () => {
    const onChange = await openPoster();
    const gap = layoutOf().gaps.find((g) => g.kind === "section")!;
    expect(gap.column).toBe(0);
    const at = centre(gap.rect);
    drag(() => gapEl(gap), at, { x: at.x, y: at.y + 90 });
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Resize sections");
    expect(change.html).toMatch(/data-weight="/);
    expect(change.theme).toBe(START.theme);
    const sections = layoutOf(change.html, change.theme).columns[0]!;
    expect(sections[0]!.weight).toBeGreaterThan(sections[1]!.weight);
    const expected = resizePosterGap(START.html, START.theme, gap, 90);
    expect(expected.ok).toBe(true);
    if (expected.ok) expect(change.html).toBe(expected.html);
  });

  it("10.2c dragging the other way shrinks the first neighbour", async () => {
    const onChange = await openPoster();
    const gap = layoutOf().gaps.find((g) => g.kind === "column" && g.index === 1)!;
    const at = centre(gap.rect);
    drag(() => gapEl(gap), at, { x: at.x - 100, y: at.y });
    await settle();
    const change = lastChange(onChange);
    const columns = layoutOf(change.html, change.theme).settings.columns;
    expect(columns[1]!).toBeLessThan(columns[2]!);
  });

  it("10.2c a gap drag is one undo step", async () => {
    const onChange = await openPoster();
    const gap = layoutOf().gaps.find((g) => g.kind === "column" && g.index === 0)!;
    const at = centre(gap.rect);
    drag(() => gapEl(gap), at, { x: at.x + 150, y: at.y });
    await settle();
    workspace!.undo();
    await settle();
    expect(lastChange(onChange).theme).toBe(START.theme);
    expect(lastChange(onChange).html).toBe(START.html);
  });

  it("10.2c a press and release on a gap with no movement commits nothing", async () => {
    const onChange = await openPoster();
    const gap = layoutOf().gaps[0]!;
    const at = centre(gap.rect);
    fire("pointerdown", gapEl(gap), at.x, at.y);
    fire("pointerup", gapEl(gap), at.x, at.y);
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("10.2c a drag that returns to its start commits nothing", async () => {
    const onChange = await openPoster();
    const gap = layoutOf().gaps.find((g) => g.kind === "column" && g.index === 0)!;
    const at = centre(gap.rect);
    fire("pointerdown", gapEl(gap), at.x, at.y);
    fire("pointermove", gapEl(gap), at.x + 80, at.y);
    fire("pointermove", gapEl(gap), at.x, at.y);
    fire("pointerup", gapEl(gap), at.x, at.y);
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("10.2c a gap drag does not select, move or resize any block freely", async () => {
    const onChange = await openPoster();
    const gap = layoutOf().gaps.find((g) => g.kind === "column" && g.index === 0)!;
    const at = centre(gap.rect);
    drag(() => gapEl(gap), at, { x: at.x + 150, y: at.y });
    await settle();
    expect(onChange.mock.calls.map(([c]) => c.label)).toEqual(["Resize columns"]);
    expect(rectOf(lastChange(onChange).html, "logo")).toEqual(rectOf(START.html, "logo"));
  });
});

describe("10.2d no poster stage for other decks", () => {
  it("10.2d an unsectioned poster shows no gap handles and no drop indicator", async () => {
    await openWs(POSTER);
    expect(gapEls()).toHaveLength(0);
    expect(host.querySelectorAll(".dsh-poster-locked")).toHaveLength(0);
    expect(dropVisible()).toBe(false);
  });

  it("10.2d dragging a block of an unsectioned poster shows no drop indicator", async () => {
    const onChange = await openWs(POSTER);
    fire("pointerdown", boxOf("title"), 1000, 250);
    fire("pointermove", boxOf("title"), 1100, 300);
    expect(dropVisible()).toBe(false);
    fire("pointerup", boxOf("title"), 1100, 300);
    await settle();
    expect(lastChange(onChange).label).toBe("Move block");
  });

  it("10.2d a talk shows no gap handles and no drop indicator", async () => {
    const onChange = await openWs(DECK);
    expect(gapEls()).toHaveLength(0);
    expect(dropVisible()).toBe(false);
    fire("pointerdown", boxOf("a"), 440, 480);
    fire("pointermove", boxOf("a"), 520, 520);
    expect(dropVisible()).toBe(false);
    fire("pointerup", boxOf("a"), 520, 520);
    await settle();
    expect(lastChange(onChange).label).toBe("Move block");
  });
});

describe("A10 poster stage, HTML half", () => {
  it("A10 a section reorders across columns by drag and a gap resizes by drag, each one undoable change", async () => {
    const onChange = await openPoster();
    const layout = layoutOf();
    const target = layout.columns[1]![0]!.rect;
    drag(() => boxOf("s2"), centre(layout.columns[0]![1]!.rect), { x: centre(target).x, y: target.top + target.height - 5 });
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const moved = lastChange(onChange);
    expect(moved.label).toBe("Move section");
    const afterMove = layoutOf(moved.html, moved.theme);
    expect(idsOf(afterMove)).toEqual([["s1"], ["s3", "s2"], ["s4"]]);
    await settle();
    const gap = afterMove.gaps.find((g) => g.kind === "section" && g.column === 1)!;
    expect(gap).toBeDefined();
    const at = centre(gap.rect);
    drag(() => gapEl(gap), at, { x: at.x, y: at.y + 60 });
    await settle();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(lastChange(onChange).label).toBe("Resize sections");
    workspace!.undo();
    await settle();
    expect(lastChange(onChange).html).toBe(moved.html);
    workspace!.undo();
    await settle();
    expect(lastChange(onChange).html).toBe(START.html);
  });
});
