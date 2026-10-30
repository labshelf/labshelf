/** @jest-environment jsdom */
// Tests the QMD rich editor through mountQmdEditor: typing reaches onChange, the Source toggle round-trips edits,
// and the handle (setBody, focus, destroy) and options (readOnly) behave as documented.
//
// Assumptions about the DOM, since the spec fixes no selectors: the visual surface is the ProseMirror default
// contenteditable `.ProseMirror`; Source mode is a plain <textarea>; the toggle is a <button> in the mount root
// whose text, aria-label or title mentions "source" (to enter Source) or "visual" (to return to Visual).
import { mountQmdEditor, type QmdEditorHandle } from "../../../src/qmd/dom/qmdEditor";
import { QMD_VOCABULARY } from "../../../src/qmd/dom";

const DEBOUNCE_MS = 300;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Lets ProseMirror's MutationObserver callback run. */
const flushDom = () => sleep(30);
const settleDebounce = () => sleep(DEBOUNCE_MS + 150);

let mounted: QmdEditorHandle[] = [];

function setup(body: string, extra: { readOnly?: boolean } = {}) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const changes: string[] = [];
  const handle = mountQmdEditor(root, { body, onChange: (next) => changes.push(next), ...extra });
  mounted.push(handle);
  return { root, handle, changes };
}

afterEach(() => {
  for (const handle of mounted) { try { handle.destroy(); } catch { /* already destroyed */ } }
  mounted = [];
  document.body.innerHTML = "";
});

const surface = (root: HTMLElement) => root.querySelector<HTMLElement>(".ProseMirror");

/** Replaces the first text node of the first paragraph, as typing in the browser would, and puts the caret at its end. */
async function typeText(root: HTMLElement, text: string): Promise<void> {
  const walker = document.createTreeWalker(surface(root)!, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode() as Text;
  node.data = text;
  const range = document.createRange();
  range.setStart(node, text.length);
  range.collapse(true);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  await flushDom();
}

function label(button: HTMLElement): string {
  return `${button.textContent ?? ""} ${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""}`;
}

/** Clicks the toggle that switches to `target`; falls back to the only toggle when a single button flips both ways. */
function toggleTo(root: HTMLElement, target: "source" | "visual"): void {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>("button"));
  const exact = buttons.find((button) => new RegExp(target, "i").test(label(button)));
  const either = buttons.find((button) => /source|visual/i.test(label(button)));
  const button = exact ?? either;
  if (!button) { throw new Error(`no toggle button for ${target} found`); }
  button.click();
}

const sourceArea = (root: HTMLElement) => root.querySelector<HTMLTextAreaElement>("textarea");

describe("mountQmdEditor", () => {
  it("4.2a renders the initial body in an editable surface", () => {
    const { root } = setup("Hello\n");
    const view = surface(root);
    expect(view).not.toBeNull();
    expect(view!.textContent).toContain("Hello");
    expect(view!.getAttribute("contenteditable")).toBe("true");
  });

  it("4.2a does not call onChange on mount", async () => {
    const { changes } = setup("Hello\n");
    await settleDebounce();
    expect(changes).toEqual([]);
  });

  it("4.2a typing text gives onChange the expected body", async () => {
    const { root, changes } = setup("Hello\n");
    await typeText(root, "Hello world");
    await settleDebounce();
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[changes.length - 1]).toBe("Hello world\n");
  });

  it("4.2a debounces onChange by 300 ms and reports once for a burst of edits", async () => {
    const { root, changes } = setup("Hello\n");
    await typeText(root, "Hello w");
    await typeText(root, "Hello wo");
    await typeText(root, "Hello wor");
    await sleep(100);
    expect(changes).toEqual([]);
    await settleDebounce();
    expect(changes).toEqual(["Hello wor\n"]);
  });

  it("4.2b Source mode shows the item body in a textarea", () => {
    const { root } = setup("# Title\n\nSome text.\n");
    toggleTo(root, "source");
    const area = sourceArea(root);
    expect(area).not.toBeNull();
    expect(area!.value).toBe("# Title\n\nSome text.\n");
  });

  it("4.2b an edit made in Source mode is kept after toggling back to Visual", async () => {
    const { root } = setup("Hello\n");
    toggleTo(root, "source");
    const area = sourceArea(root)!;
    area.value = "Hello edited\n";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    toggleTo(root, "visual");
    await flushDom();
    expect(surface(root)!.textContent).toContain("Hello edited");
  });

  it("4.2b Source edits are parsed into rich nodes on return to Visual", async () => {
    const { root } = setup("Hello\n");
    toggleTo(root, "source");
    const area = sourceArea(root)!;
    area.value = "# Big title\n\nBody text.\n";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    toggleTo(root, "visual");
    await flushDom();
    expect(surface(root)!.querySelector("h1")?.textContent).toBe("Big title");
  });

  it("4.2b a Source edit reaches onChange with the edited body", async () => {
    const { root, changes } = setup("Hello\n");
    toggleTo(root, "source");
    const area = sourceArea(root)!;
    area.value = "Hello edited\n";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    toggleTo(root, "visual");
    await settleDebounce();
    expect(changes[changes.length - 1]).toBe("Hello edited\n");
  });

  it("4.2b the textarea is gone and the visual surface is back after toggling to Visual", () => {
    const { root } = setup("Hello\n");
    toggleTo(root, "source");
    toggleTo(root, "visual");
    expect(sourceArea(root)).toBeNull();
    expect(surface(root)).not.toBeNull();
  });

  it("4.2a setBody replaces the shown content", async () => {
    const { root, handle } = setup("Old\n");
    handle.setBody("New content\n");
    await flushDom();
    expect(surface(root)!.textContent).toContain("New content");
    expect(surface(root)!.textContent).not.toContain("Old");
  });

  it("4.2a readOnly makes the surface non-editable", () => {
    const { root } = setup("Hello\n", { readOnly: true });
    expect(surface(root)!.getAttribute("contenteditable")).toBe("false");
  });

  it("4.2a destroy removes the editor from the root and stops onChange", async () => {
    const { root, handle, changes } = setup("Hello\n");
    handle.destroy();
    expect(surface(root)).toBeNull();
    await settleDebounce();
    expect(changes).toEqual([]);
  });

  it("4.2a focus does not throw", () => {
    const { handle } = setup("Hello\n");
    expect(() => handle.focus()).not.toThrow();
  });
});

describe("QMD_VOCABULARY", () => {
  it("4.2a names the item in a non-empty string", () => {
    expect(typeof QMD_VOCABULARY.item).toBe("string");
    expect(QMD_VOCABULARY.item.length).toBeGreaterThan(0);
  });
});


it("offers less frequent content through the labelled Insert menu", () => {
  const { root } = setup("Hello\n");
  root.querySelector<HTMLButtonElement>('button[aria-label="Insert"]')!.click();
  const menu = document.querySelector(".ls-menu")!;
  expect(menu.textContent).toContain("Inline math");
  expect(menu.textContent).toContain("Code cell");
  const source = [...menu.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Edit Markdown source"))!;
  source.click();
  expect(root.querySelector("textarea")).not.toBeNull();
  expect(root.querySelector<HTMLButtonElement>(".qmd-editor-toggle")!.hidden).toBe(false);
  root.querySelector<HTMLButtonElement>(".qmd-editor-toggle")!.click();
  expect(root.querySelector(".ProseMirror")).not.toBeNull();
});

describe("visible controls instead of a toolbar", () => {
  const afterEachCleanup: Array<() => void> = [];
  afterEach(() => { while (afterEachCleanup.length > 0) afterEachCleanup.pop()!(); });
  /** Selects the first `length` characters of the first paragraph, as dragging over them would. */
  async function selectStart(root: HTMLElement, handle: QmdEditorHandle, length: number): Promise<void> {
    handle.focus();
    const node = document.createTreeWalker(surface(root)!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, length);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await flushDom();
  }

  it("has no formatting toolbar", () => {
    const { root } = setup("Hello\n");
    expect(root.querySelector(".qmd-editor-toolbar, [role='toolbar']:not([hidden])")).toBeNull();
  });

  it("shows the formatting bubble over a selection and its Bold button bolds it", async () => {
    const { root, handle, changes } = setup("Hello world\n");
    const bubble = root.querySelector<HTMLElement>(".qmd-bubble")!;
    expect(bubble.hidden).toBe(true);
    await selectStart(root, handle, 5);
    expect(bubble.hidden).toBe(false);
    bubble.querySelector<HTMLButtonElement>('button[aria-label="Bold"]')!.click();
    await settleDebounce();
    expect(changes.at(-1)).toBe("**Hello** world\n");
  });

  it("the round + under the text inserts a code cell at the caret", async () => {
    // The cell's code editor measures text ranges, which jsdom lacks.
    const proto = Range.prototype as unknown as Record<string, unknown>;
    proto.getClientRects = () => [];
    proto.getBoundingClientRect = () => new DOMRect();
    afterEachCleanup.push(() => { delete proto.getClientRects; delete proto.getBoundingClientRect; });
    const { root, handle, changes } = setup("Hello\n");
    handle.focus();
    const insert = root.querySelector<HTMLButtonElement>(".qmd-editor-footer .qmd-editor-insert")!;
    insert.click();
    const item = [...document.querySelectorAll<HTMLButtonElement>(".ls-menu button")].find((button) => button.textContent?.includes("Code cell"))!;
    item.click();
    await settleDebounce();
    expect(root.querySelector(".qmd-cell")).not.toBeNull();
    expect(changes.at(-1)).toContain("```{python}");
  });

  it("a double click on empty space below the text opens the Insert menu and inserts there; on text it does not", async () => {
    const proto = Range.prototype as unknown as Record<string, unknown>;
    proto.getClientRects = () => [];
    proto.getBoundingClientRect = () => new DOMRect();
    afterEachCleanup.push(() => { delete proto.getClientRects; delete proto.getBoundingClientRect; });
    const { root, changes } = setup("Hello\n");
    surface(root)!.querySelector("p")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientY: 1 }));
    expect(document.querySelector(".ls-menu")).toBeNull();
    surface(root)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 40, clientY: 400 }));
    const item = [...document.querySelectorAll<HTMLButtonElement>(".ls-menu button")].find((button) => button.textContent?.includes("Code cell"))!;
    item.click();
    await settleDebounce();
    expect(changes.at(-1)).toMatch(/^Hello\n\n```\{python\}/);
  });

  it("shows the host's status at the right of the Insert row and hides Insert when read-only", () => {
    const status = document.createElement("span");
    status.textContent = "Saved";
    const root = document.createElement("div");
    document.body.append(root);
    mounted.push(mountQmdEditor(root, { body: "Hi\n", onChange: () => undefined, readOnly: true, status }));
    expect(root.querySelector(".qmd-editor-footer")!.lastElementChild).toBe(status);
    expect(root.querySelector(".qmd-editor-insert")).toBeNull();
  });
});
