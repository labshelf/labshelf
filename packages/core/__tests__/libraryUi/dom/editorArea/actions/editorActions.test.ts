/**
 * @jest-environment jsdom
 */
// Tests the editor actions toolbar at the end of each group's tab strip: per-tab actions, the More menu and hiding.
import { mountEditorArea, type EditorArea, type EditorTab, type EditorTabAction } from "../../../../../src/libraryUi/dom";

let slot: HTMLElement;
let area: EditorArea;

function tabWith(id: string, actions?: EditorTabAction[], group: 0 | 1 = 0): EditorTab {
  return { id, title: id, icon: "file-text", group, mount: () => ({ dispose: () => {}, ...(actions ? { actions } : {}) }) };
}
const act = (id: string, overflow = false): EditorTabAction & { run: jest.Mock } => ({ id, icon: "bold", label: `Do ${id}`, run: jest.fn(), overflow });
const bars = (): HTMLElement[] => [...slot.querySelectorAll<HTMLElement>(".ls-editor-actions")];
const labels = (bar: HTMLElement): (string | null)[] => [...bar.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));

beforeEach(() => { slot = document.createElement("div"); document.body.append(slot); area = mountEditorArea(slot); });
afterEach(() => { area.dispose(); slot.remove(); document.querySelectorAll(".ls-menu, .ls-scrim").forEach((n) => n.remove()); });

test("the group's active tab shows its actions as labelled icon buttons in a toolbar next to the tablist", () => {
  const bold = act("bold");
  area.open(tabWith("a", [bold]));
  const bar = bars()[0]!;
  expect(bar.getAttribute("role")).toBe("toolbar");
  expect(bar.getAttribute("aria-label")).toBe("Editor actions");
  expect(bar.hidden).toBe(false);
  expect(bar.parentElement!.querySelector('[role="tablist"]')).not.toBeNull();
  const button = bar.querySelector("button")!;
  expect(button.type).toBe("button");
  expect(button.title).toBe("Do bold");
  expect(button.querySelector("svg")).not.toBeNull();
  button.click();
  expect(bold.run).toHaveBeenCalledTimes(1);
});

test("switching tabs swaps the actions and a tab without any hides the toolbar", () => {
  area.open(tabWith("a", [act("a1")]));
  area.open(tabWith("b", [act("b1"), act("b2")]));
  area.open(tabWith("c"));
  const bar = bars()[0]!;
  expect(bar.hidden).toBe(true);
  expect(bar.children).toHaveLength(0);
  area.activate("b");
  expect(labels(bar)).toEqual(["Do b1", "Do b2"]);
  expect(bar.hidden).toBe(false);
  area.activate("a");
  expect(labels(bar)).toEqual(["Do a1"]);
});

test("closing the active tab shows the neighbour's actions and closing the last hides the toolbar", async () => {
  area.open(tabWith("a", [act("a1")]));
  area.open(tabWith("b", [act("b1")]));
  await area.close("b");
  expect(labels(bars()[0]!)).toEqual(["Do a1"]);
  await area.close("a");
  expect(bars()[0]!.hidden).toBe(true);
});

test("each group shows the actions of its own active tab, also after a tab moves", () => {
  area.open(tabWith("a", [act("a1")]));
  area.open(tabWith("b", [act("b1")], 1));
  expect(labels(bars()[0]!)).toEqual(["Do a1"]);
  expect(labels(bars()[1]!)).toEqual(["Do b1"]);
  area.open(tabWith("a"), 1);
  expect(bars()[0]!.hidden).toBe(true);
  expect(labels(bars()[1]!)).toEqual(["Do a1"]);
});

test("overflow actions appear only in the More Actions menu", () => {
  const inline = act("inline");
  const extra = act("extra", true);
  area.open(tabWith("a", [inline, extra]));
  const bar = bars()[0]!;
  expect(labels(bar)).toEqual(["Do inline", "More Actions…"]);
  bar.querySelectorAll("button")[1]!.click();
  const items = [...document.querySelectorAll<HTMLElement>(".ls-menu-item")];
  expect(items.map((i) => i.textContent)).toEqual(["Do extra"]);
  items[0]!.click();
  expect(extra.run).toHaveBeenCalledTimes(1);
  expect(inline.run).not.toHaveBeenCalled();
});

test("a tab with only overflow actions shows just the More button", () => {
  area.open(tabWith("a", [act("extra", true)]));
  expect(labels(bars()[0]!)).toEqual(["More Actions…"]);
});

test("a body whose actions arrive after mount shows them once refreshed, and only while its tab is active", () => {
  const late: { dispose: () => void; actions?: EditorTabAction[] } = { dispose: () => {} };
  area.open({ id: "a", title: "a", icon: "file-text", group: 0, mount: () => late });
  const bar = bars()[0]!;
  expect(bar.hidden).toBe(true);
  late.actions = [act("a1")];
  area.refreshActions("a");
  expect(labels(bar)).toEqual(["Do a1"]);
  area.open(tabWith("b"));
  late.actions = [act("a2")];
  area.refreshActions("a");
  expect(bar.hidden).toBe(true);
  area.activate("a");
  expect(labels(bar)).toEqual(["Do a2"]);
});
