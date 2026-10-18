/**
 * @jest-environment jsdom
 */
// Tests the editor area through its mount handle: open, activate, close, lazy mount, dispose, groups, sash width and keyboard.
import { mountEditorArea, type EditorArea, type EditorAreaOptions, type EditorTab } from "../../../../src/library-ui/dom";

interface Probe { tab: EditorTab; mounts: number; disposes: number; body: HTMLElement | null }

function probe(id: string, group: 0 | 1 = 0, dirty = false): Probe {
  const p: Probe = { mounts: 0, disposes: 0, body: null, tab: null as unknown as EditorTab };
  p.tab = {
    id, title: `Title ${id}`, icon: "file-text", group, dirty,
    mount: (el) => { p.mounts++; p.body = el; el.textContent = `body ${id}`; return { dispose: () => { p.disposes++; } }; },
  };
  return p;
}

let slot: HTMLElement;
let area: EditorArea;
const mount = (options: EditorAreaOptions = {}): EditorArea => (area = mountEditorArea(slot, options));
const groups = (): HTMLElement[] => [...slot.querySelectorAll<HTMLElement>(".ls-editor-group")];
const tabEl = (id: string): HTMLElement => slot.querySelector<HTMLElement>(`[role="tab"][data-tab-id="${id}"]`)!;
const key = (target: HTMLElement, k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

beforeEach(() => { slot = document.createElement("div"); document.body.append(slot); });
afterEach(() => { area.dispose(); slot.remove(); });

test("opening a tab shows it in a tablist and mounts its body on first activation only", () => {
  const onActivate = jest.fn();
  mount({ onActivate });
  const a = probe("a"); const b = probe("b");
  area.open(b.tab);
  area.open(a.tab, undefined, { background: true });
  const list = slot.querySelector('[role="tablist"]')!;
  expect([...list.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(["Title b", "Title a"]);
  expect(tabEl("b").getAttribute("aria-selected")).toBe("true");
  expect(tabEl("a").getAttribute("aria-selected")).toBe("false");
  expect(a.mounts).toBe(0);
  expect(b.mounts).toBe(1);
  expect(b.body!.getAttribute("role")).toBe("tabpanel");
  expect(b.body!.getAttribute("aria-labelledby")).toBe(tabEl("b").id);
  area.activate("a");
  area.activate("b");
  area.activate("a");
  expect(a.mounts).toBe(1);
  expect(b.mounts).toBe(1);
  expect(b.body!.hidden).toBe(true);
  expect(a.body!.hidden).toBe(false);
  expect(onActivate.mock.calls.map((c) => c[0])).toEqual(["b", "a", "b", "a"]);
});

test("opening an id that is open updates and activates it without a second mount", () => {
  mount();
  const a = probe("a"); const b = probe("b");
  area.open(a.tab);
  area.open(b.tab);
  area.open({ ...a.tab, title: "Renamed", dirty: true });
  expect(a.mounts).toBe(1);
  expect(slot.querySelectorAll('[role="tab"]')).toHaveLength(2);
  expect(tabEl("a").textContent).toBe("Renamed");
  expect(tabEl("a").classList.contains("dirty")).toBe(true);
  expect(area.tabs().find((t) => t.id === "a")).toMatchObject({ active: true, focused: true, dirty: true });
});

test("closing disposes the body, activates a neighbour and asks onClose first", async () => {
  const onClose = jest.fn((id: string) => id !== "keep");
  mount({ onClose });
  const a = probe("a"); const b = probe("b"); const keep = probe("keep");
  [a, b, keep].forEach((p) => area.open(p.tab));
  area.activate("b");
  expect(await area.close("b")).toBe(true);
  expect(b.disposes).toBe(1);
  expect(tabEl("b")).toBeNull();
  expect(b.body!.isConnected).toBe(false);
  expect(area.tabs().find((t) => t.active)!.id).toBe("keep");
  expect(await area.close("keep")).toBe(false);
  expect(keep.disposes).toBe(0);
  expect(tabEl("keep")).not.toBeNull();
  expect(onClose.mock.calls.map((c) => c[0])).toEqual(["b", "keep"]);
  expect(a.disposes).toBe(0);
});

test("a tab that was never activated closes without mount or dispose", async () => {
  mount();
  const a = probe("a"); const b = probe("b");
  area.open(b.tab);
  area.open(a.tab, 0, { background: true });
  await area.close("a");
  expect(a.mounts).toBe(0);
  expect(a.disposes).toBe(0);
});

test("the close button closes its tab", async () => {
  mount();
  const a = probe("a");
  area.open(a.tab);
  tabEl("a").querySelector<HTMLElement>(".ls-editor-tab-close")!.click();
  await Promise.resolve();
  await Promise.resolve();
  expect(tabEl("a")).toBeNull();
  expect(a.disposes).toBe(1);
});

test("two groups show side by side with a sash; an empty group collapses", async () => {
  mount();
  const a = probe("a", 0); const b = probe("b", 1);
  area.open(a.tab);
  expect(groups().filter((g) => !g.hidden)).toHaveLength(1);
  expect(slot.querySelector<HTMLElement>(".ls-editor-sash")!.hidden).toBe(true);
  area.open(b.tab);
  expect(groups().filter((g) => !g.hidden)).toHaveLength(2);
  expect(slot.querySelector<HTMLElement>(".ls-editor-sash")!.hidden).toBe(false);
  expect(groups()[1]!.contains(tabEl("b"))).toBe(true);
  expect(area.tabs().map((t) => [t.id, t.group, t.focused])).toEqual([["a", 0, false], ["b", 1, true]]);
  await area.close("a");
  expect(groups()[0]!.hidden).toBe(true);
  expect(groups()[1]!.hidden).toBe(false);
  expect(slot.querySelector<HTMLElement>(".ls-editor-sash")!.hidden).toBe(true);
});

test("open with a group moves an open tab and reports onMove; split moves the focused tab", () => {
  const onMove = jest.fn();
  mount({ onMove });
  const a = probe("a"); const b = probe("b");
  area.open(a.tab);
  area.open(b.tab);
  area.open(a.tab, 1);
  expect(groups()[1]!.contains(tabEl("a"))).toBe(true);
  expect(groups()[1]!.contains(a.body!)).toBe(true);
  expect(a.mounts).toBe(1);
  expect(onMove).toHaveBeenLastCalledWith("a", 1);
  area.activate("b");
  area.split();
  expect(onMove).toHaveBeenLastCalledWith("b", 1);
  expect(groups()[0]!.hidden).toBe(true);
  expect(area.tabs().map((t) => t.group)).toEqual([1, 1]);
});

test("the sash width loads from and saves to the prefs port", () => {
  const save = jest.fn();
  mount({ prefs: { load: () => 420, save } });
  area.open(probe("a", 0).tab);
  area.open(probe("b", 1).tab);
  expect(groups()[0]!.style.width).toBe("420px");
  const sash = slot.querySelector<HTMLElement>(".ls-editor-sash")!;
  sash.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  window.dispatchEvent(new MouseEvent("mousemove", { clientX: 300 }));
  window.dispatchEvent(new MouseEvent("mouseup"));
  expect(save).toHaveBeenCalledWith(parseInt(groups()[0]!.style.width, 10));
});

test("Ctrl/Cmd+W closes the focused tab and Ctrl+Tab cycles the group", async () => {
  mount();
  const a = probe("a"); const b = probe("b"); const c = probe("c");
  [a, b, c].forEach((p) => area.open(p.tab));
  const focused = (): string => area.tabs().find((t) => t.focused)!.id;
  expect(key(c.body!, "Tab", { ctrlKey: true }).defaultPrevented).toBe(true);
  expect(focused()).toBe("a");
  key(a.body!, "Tab", { ctrlKey: true, shiftKey: true });
  expect(focused()).toBe("c");
  expect(key(c.body!, "w", { metaKey: true }).defaultPrevented).toBe(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(c.disposes).toBe(1);
  key(tabEl("b"), "W", { ctrlKey: true });
  await Promise.resolve();
  await Promise.resolve();
  expect(area.tabs().map((t) => t.id)).toEqual(["a"]);
});

test("the tablist has one tab stop and arrow keys move focus and activation", () => {
  mount();
  ["a", "b", "c"].forEach((id) => area.open(probe(id).tab));
  area.activate("a");
  const stops = (): string[] => [...slot.querySelectorAll<HTMLElement>('[role="tab"]')].filter((t) => t.tabIndex === 0).map((t) => t.dataset.tabId!);
  expect(stops()).toEqual(["a"]);
  key(tabEl("a"), "ArrowRight");
  expect(document.activeElement).toBe(tabEl("b"));
  expect(stops()).toEqual(["b"]);
  expect(area.tabs().find((t) => t.focused)!.id).toBe("b");
  key(tabEl("b"), "End");
  expect(document.activeElement).toBe(tabEl("c"));
  key(tabEl("c"), "ArrowRight");
  expect(document.activeElement).toBe(tabEl("a"));
  key(tabEl("a"), "ArrowLeft");
  expect(document.activeElement).toBe(tabEl("c"));
  key(tabEl("c"), "Home");
  expect(document.activeElement).toBe(tabEl("a"));
});

test("dispose disposes every mounted body and removes the area", () => {
  mount();
  const a = probe("a"); const b = probe("b"); const c = probe("c");
  [a, b, c].forEach((p) => area.open(p.tab, 0, { background: true }));
  area.activate("c");
  area.dispose();
  expect([a.disposes, b.disposes, c.disposes]).toEqual([1, 0, 1]);
  expect(slot.children).toHaveLength(0);
  area = { dispose: () => {} } as unknown as EditorArea;
});
