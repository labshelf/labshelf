/**
 * @jest-environment jsdom
 */
// Tests quick pick separators (skipped by the arrow keys, hidden when nothing under them matches) and quick input accessible names.
import { inputBox, quickPick, type QuickPickEntry } from "../../../../src/ui/dom/widgets/quickInput";

const entries: QuickPickEntry<string>[] = [
  { kind: "separator", label: "Greek" },
  { label: "alpha", value: "a" },
  { label: "beta", value: "b" },
  { kind: "separator", label: "Arrows" },
  { label: "rightarrow", value: "r" },
];

const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>(".ls-quick input")!;
const key = (name: string): void => { input().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); };
const headings = (): string[] => [...document.querySelectorAll(".ls-quick-sep")].map((row) => row.textContent ?? "");

// jsdom does not implement scrollIntoView.
Element.prototype.scrollIntoView = (): void => undefined;

afterEach(() => { document.body.innerHTML = ""; });

describe("quickPick separators", () => {
  it("renders separators as presentation rows, not options", () => {
    void quickPick(entries);
    expect(headings()).toEqual(["Greek", "Arrows"]);
    expect(document.querySelectorAll('.ls-quick-sep[role="presentation"]')).toHaveLength(2);
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(3);
  });

  it("moves the arrow keys across items only and picks the active item", async () => {
    const picked = quickPick(entries);
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowDown");
    key("Enter");
    expect(await picked).toBe("r");
  });

  it("hides a separator when filtering leaves no item under it", () => {
    void quickPick(entries);
    input().value = "arrow";
    input().dispatchEvent(new Event("input"));
    expect(headings()).toEqual(["Arrows"]);
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
  });

  it("shows the empty message when nothing matches", () => {
    void quickPick(entries);
    input().value = "zzz";
    input().dispatchEvent(new Event("input"));
    expect(headings()).toEqual([]);
    expect(document.querySelector(".ls-quick-empty")).not.toBeNull();
  });
});

describe("quick input accessible name", () => {
  const box = (): Element => document.querySelector('.ls-quick[role="dialog"]')!;
  const textOf = (attr: string): string => document.getElementById(box().getAttribute(attr) ?? "")?.textContent ?? "";

  it("labels a quick pick with its title", () => {
    void quickPick(entries, { title: "Shared Links", placeholder: "Pick a shared folder" });
    expect(textOf("aria-labelledby")).toBe("Shared Links");
  });

  it("labels an untitled quick pick with its placeholder", () => {
    void quickPick(entries, { placeholder: "Move paper to…" });
    expect(box().getAttribute("aria-label")).toBe("Move paper to…");
  });

  it("labels an input box with its title and describes it with its prompt", () => {
    void inputBox({ title: "Import Shared Link", prompt: "Paste a share link" });
    expect(textOf("aria-labelledby")).toBe("Import Shared Link");
    expect(textOf("aria-describedby")).toBe("Paste a share link");
  });
});

describe('quick input cancellation', () => {
  const openers = [
    (signal: AbortSignal) => inputBox({ signal }),
    (signal: AbortSignal) => quickPick(entries, { signal }),
  ];
  test.each(openers)('dismisses on abort and releases overlay listeners', async open => {
    const controller = new AbortController();
    const removeAbort = jest.spyOn(controller.signal, 'removeEventListener');
    const removeKey = jest.spyOn(document, 'removeEventListener');
    const result = open(controller.signal);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    controller.abort();
    expect(await result).toBeUndefined();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('.ls-scrim')).toBeNull();
    expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(removeKey).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    removeAbort.mockRestore(); removeKey.mockRestore();
  });
  test.each(openers)('does not mount for an already aborted signal', async open => {
    const controller = new AbortController(); controller.abort();
    expect(await open(controller.signal)).toBeUndefined();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  test('releases its abort listener when a value is accepted', async () => {
    const controller = new AbortController();
    const removeAbort = jest.spyOn(controller.signal, 'removeEventListener');
    const result = inputBox({ signal: controller.signal });
    input().value = 'Keep'; key('Enter');
    expect(await result).toBe('Keep');
    expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort();
    removeAbort.mockRestore();
  });
});
