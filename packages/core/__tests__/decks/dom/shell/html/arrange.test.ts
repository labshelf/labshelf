/**
 * @jest-environment jsdom
 */
// Spec 8.3 (A8): copy, paste and duplicate of the selection, group and ungroup, and the panel's align and distribute for several blocks.
import { parseDeck } from "../../../../../src/decks/deckParse";
import { blockIds, DECK, host, lastChange, MOD, named, openWs, press, settle, workspace } from "./shellHarness";

const blocksOf = (html: string, slide = 0) => parseDeck(html).model!.slides[slide]!.blocks;
const rectOf = (html: string, id: string) => blocksOf(html).find((block) => block.id === id)?.rect;
const selected = (): string[] =>
  Array.from(host.querySelectorAll<HTMLElement>("[data-block-box]")).filter((el) => el.classList.contains("is-selected")).map((el) => el.getAttribute("data-block-box")!);
const panelButton = (text: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll<HTMLButtonElement>(".dsh-props button")).find((b) => b.textContent?.trim() === text);

async function choose(ids: string[]): Promise<void> {
  workspace!.selectBlocks(ids);
  await settle();
}

describe("8.3c clipboard and groups", () => {
  it("Mod+C then Mod+V on the same slide adds offset copies with fresh ids, selected, as one Paste step", async () => {
    const onChange = await openWs();
    await choose(["a", "b"]);
    press("c", MOD);
    press("v", MOD);
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const { html, label } = lastChange(onChange);
    expect(label).toBe("Paste");
    const ids = blockIds(html)!;
    expect(ids).toHaveLength(5);
    const fresh = ids.slice(3);
    expect(fresh.every((id) => !["title", "a", "b"].includes(id))).toBe(true);
    expect(rectOf(html, fresh[0]!)).toEqual({ left: 264, top: 424, width: 400, height: 160 });
    expect(rectOf(html, fresh[1]!)).toEqual({ left: 1224, top: 664, width: 480, height: 240 });
    expect(selected().sort()).toEqual([...fresh].sort());
    workspace!.undo();
    await settle();
    expect(lastChange(onChange).html).toBe(DECK);
  });

  it("Mod+V on a slide without the same rects pastes without offset", async () => {
    const onChange = await openWs();
    await choose(["a"]);
    press("c", MOD);
    workspace!.selectSlide(1);
    await settle();
    press("v", MOD);
    await settle();
    const html = lastChange(onChange).html;
    const pasted = blocksOf(html, 1).find((block) => block.id !== "body")!;
    expect(pasted.rect).toEqual({ left: 240, top: 400, width: 400, height: 160 });
  });

  it("Mod+D duplicates the whole selection and leaves the clipboard alone", async () => {
    const onChange = await openWs();
    await choose(["a"]);
    press("c", MOD);
    await choose(["title", "b"]);
    press("d", MOD);
    await settle();
    const dup = lastChange(onChange);
    expect(dup.label).toBe("Duplicate");
    expect(blockIds(dup.html)).toHaveLength(5);
    press("v", MOD);
    await settle();
    const pasted = lastChange(onChange).html;
    const added = blocksOf(pasted).slice(5);
    expect(added).toHaveLength(1);
    expect(pasted.slice(added[0]!.range.from, added[0]!.range.to)).toContain("Alpha");
  });

  it("Mod+G groups two selected blocks and Shift+Mod+G ungroups them, one step each", async () => {
    const onChange = await openWs();
    await choose(["a", "b"]);
    press("g", MOD);
    await settle();
    const grouped = lastChange(onChange);
    expect(grouped.label).toBe("Group");
    const groups = blocksOf(grouped.html).map((block) => block.group);
    expect(groups[0]).toBeUndefined();
    expect(groups[1]).toBeTruthy();
    expect(groups[2]).toBe(groups[1]);
    await choose(["a", "b"]);
    press("G", { ...MOD, shiftKey: true });
    await settle();
    const ungrouped = lastChange(onChange);
    expect(ungrouped.label).toBe("Ungroup");
    expect(ungrouped.html).toBe(DECK);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("Mod+G with one block selected does nothing", async () => {
    const onChange = await openWs();
    await choose(["a"]);
    press("g", MOD);
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("8.3d the panel with several blocks", () => {
  it("titles the panel with the count and aligns the selection to its own union as one step", async () => {
    const onChange = await openWs();
    await choose(["title", "a", "b"]);
    expect(host.querySelector(".dsh-props .dw-props-title")?.textContent).toBe("3 blocks");
    named("Align left")!.click();
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const { html } = lastChange(onChange);
    expect(blocksOf(html).map((block) => block.rect!.left)).toEqual([120, 120, 120]);
    expect(selected().sort()).toEqual(["a", "b", "title"]);
  });

  it("distributes three blocks evenly as one step; with two units Distribute is disabled", async () => {
    const onChange = await openWs();
    await choose(["title", "a", "b"]);
    panelButton("Vertically")!.click();
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(rectOf(lastChange(onChange).html, "a")!.top).toBe(380);
    await choose(["a", "b"]);
    expect(panelButton("Horizontally")!.disabled).toBe(true);
    expect(panelButton("Vertically")!.disabled).toBe(true);
  });

  it("Group in the panel groups, and Ungroup is enabled only when a selected block has a group", async () => {
    const onChange = await openWs();
    await choose(["a", "b"]);
    expect(panelButton("Ungroup")!.disabled).toBe(true);
    panelButton("Group")!.click();
    await settle();
    expect(lastChange(onChange).label).toBe("Group");
    await choose(["a", "b"]);
    expect(panelButton("Ungroup")!.disabled).toBe(false);
  });

  it("one selected block still aligns on the slide", async () => {
    const onChange = await openWs();
    await choose(["a"]);
    Array.from(host.querySelectorAll<HTMLButtonElement>("[role='tab']")).find((tab) => tab.textContent === "Arrange")!.click();
    named("Align left")!.click();
    await settle();
    expect(rectOf(lastChange(onChange).html, "a")!.left).toBe(0);
  });
});
