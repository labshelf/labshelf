/**
 * @jest-environment jsdom
 */
// Tests that separators in a quick pick are skipped by the arrow keys, not picked, and hidden when nothing under them matches.
import { quickPick, type QuickPickEntry } from "../../../../src/ui/dom/widgets/quickInput";

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
