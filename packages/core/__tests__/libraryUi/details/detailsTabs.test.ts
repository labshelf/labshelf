// Tests the Details tab state: the preview that follows targets, pinning, selecting, closing and pruning pinned tabs.
import {
  closeTab, createInitialTabs, isPinnable, movePreviewToPinned, removeStaleTabs, applyDetailsSelection, setActiveTab, deriveShownSelection, type DetailsTabsState, type DetailsSelection,
} from "../../../src/libraryUi/details";

const paperA: DetailsSelection = { kind: "paper", ids: ["a"] };
const paperB: DetailsSelection = { kind: "paper", ids: ["b"] };
const project: DetailsSelection = { kind: "project", id: "p" };
const pinsAB = (): DetailsTabsState => createInitialTabs([{ kind: "paper", id: "a" }, { kind: "paper", id: "b" }]);

describe("isPinnable", () => {
  it("pins one paper or a project, never several papers or nothing", () => {
    expect(isPinnable(paperA)).toBe(true);
    expect(isPinnable(project)).toBe(true);
    expect(isPinnable({ kind: "paper", ids: ["a", "b"] })).toBe(false);
    expect(isPinnable({ kind: "paper", ids: [] })).toBe(false);
    expect(isPinnable(null)).toBe(false);
  });
});

describe("receiveTarget", () => {
  it("puts the target in the preview and activates it", () => {
    const s = applyDetailsSelection(createInitialTabs([]), paperA);
    expect(s).toEqual({ pins: [], preview: paperA, active: null });
    expect(deriveShownSelection(s)).toEqual(paperA);
  });

  it("activates the pinned tab of a pinned target and leaves the preview as it was", () => {
    const s = applyDetailsSelection(applyDetailsSelection(pinsAB(), project), { kind: "paper", ids: ["b"] });
    expect(s.active).toBe(1);
    expect(s.preview).toEqual(project);
    expect(deriveShownSelection(s)).toEqual({ kind: "paper", ids: ["b"] });
  });

  it("clears the preview on null and keeps an active pinned tab", () => {
    expect(applyDetailsSelection(applyDetailsSelection(createInitialTabs([]), paperA), null)).toEqual({ pins: [], preview: null, active: null });
    const pinned = setActiveTab(applyDetailsSelection(pinsAB(), project), 0);
    expect(applyDetailsSelection(pinned, null)).toEqual({ ...pinned, preview: null, active: 0 });
  });

  it("previews several papers even when one of them is pinned", () => {
    const several: DetailsSelection = { kind: "paper", ids: ["a", "c"] };
    expect(applyDetailsSelection(pinsAB(), several)).toMatchObject({ preview: several, active: null });
  });
});

describe("pinPreview", () => {
  it("turns the preview into an active pinned tab and empties the preview", () => {
    const s = movePreviewToPinned(applyDetailsSelection(pinsAB(), project));
    expect(s).toEqual({ pins: [...pinsAB().pins, { kind: "project", id: "p" }], preview: null, active: 2 });
  });

  it("does nothing for a preview that cannot be pinned", () => {
    const several = applyDetailsSelection(createInitialTabs([]), { kind: "paper", ids: ["a", "b"] });
    expect(movePreviewToPinned(several)).toBe(several);
    const empty = createInitialTabs([]);
    expect(movePreviewToPinned(empty)).toBe(empty);
  });
});

describe("closeTab", () => {
  const three = (): DetailsTabsState => movePreviewToPinned(applyDetailsSelection(pinsAB(), project));

  it("moves from the closed active tab to the next one, else the previous one, else the preview", () => {
    expect(closeTab(setActiveTab(three(), 1), 1)).toMatchObject({ active: 1, pins: [{ id: "a" }, { id: "p" }] });
    expect(closeTab(three(), 2)).toMatchObject({ active: 1 });
    expect(closeTab(setActiveTab(pinsAB(), 0), 0).active).toBe(0);
    expect(closeTab(closeTab(setActiveTab(pinsAB(), 0), 0), 0)).toEqual({ pins: [], preview: null, active: null });
  });

  it("keeps the active tab when another one closes", () => {
    expect(closeTab(three(), 0)).toMatchObject({ active: 1, pins: [{ id: "b" }, { id: "p" }] });
    expect(closeTab(setActiveTab(three(), 0), 2).active).toBe(0);
    expect(closeTab(applyDetailsSelection(three(), paperB), 0)).toMatchObject({ active: 0 });
  });

  it("keeps the preview active when a pinned tab closes", () => {
    const s = applyDetailsSelection(pinsAB(), project);
    expect(closeTab(s, 0)).toMatchObject({ active: null, preview: project });
  });
});

describe("pruneTabs", () => {
  it("drops pins of the kind whose ids are gone and keeps the others", () => {
    const s = movePreviewToPinned(applyDetailsSelection(pinsAB(), project));
    expect(removeStaleTabs(s, "paper", new Set(["b"]))).toEqual({ pins: [{ kind: "paper", id: "b" }, { kind: "project", id: "p" }], preview: null, active: 1 });
    expect(removeStaleTabs(s, "project", new Set())).toMatchObject({ pins: pinsAB().pins, active: null });
  });

  it("returns the same state when nothing is gone", () => {
    const s = pinsAB();
    expect(removeStaleTabs(s, "paper", new Set(["a", "b"]))).toBe(s);
  });
});

describe("selectTab", () => {
  it("activates a pinned tab or the preview", () => {
    expect(setActiveTab(pinsAB(), 1).active).toBe(1);
    expect(deriveShownSelection(setActiveTab(pinsAB(), 1))).toEqual(paperB);
    expect(setActiveTab(setActiveTab(pinsAB(), 1), null).active).toBeNull();
  });
});
