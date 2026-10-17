/**
 * @jest-environment jsdom
 */
// Tests the short note on the paper.pdf row: opening the field, saving on Enter or blur, cancelling and keeping keys away from the list.
import type { PaperFile } from "@labshelf/core";
import { mountForTest, paper } from "../../mountHarness";

const MOD = "2026-10-03T12:00:00Z";
const pdf = (description?: string): PaperFile => ({ name: "paper.pdf", kind: "file", size: 1, modified: MOD, ...(description ? { description } : {}) });

type T = ReturnType<typeof mountForTest>;
function opened(description?: string): T {
  const t = mountForTest();
  t.snapshot([paper("a", "papers")], ["papers/a"]);
  t.click(".expand-btn");
  t.files("a", { status: "ready", files: [pdf(description)] });
  t.sent.length = 0;
  return t;
}
const pdfRow = (t: T): HTMLElement => t.container.querySelector<HTMLElement>('.file-row[data-kind="pdf"]')!;
const factButton = (t: T): HTMLButtonElement => pdfRow(t).querySelector<HTMLButtonElement>(".file-fact-btn")!;
const field = (t: T): HTMLInputElement | null => pdfRow(t).querySelector<HTMLInputElement>("input.file-fact-input");
const press = (el: Element, key: string): void => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); };
const written = (t: T): unknown[] => t.sent.filter((m) => m.type === "paper.describeFile");

describe("short note button", () => {
  it("is labelled for a screen reader, with the text when set", () => {
    expect(factButton(opened()).getAttribute("aria-label")).toBe("Edit short note");
    expect(factButton(opened("the one about X")).getAttribute("aria-label")).toBe("Edit short note: the one about X");
  });

  it("opens a field with the current text and does not open the PDF", () => {
    const t = opened("the one about X");
    factButton(t).click();
    expect(field(t)!.value).toBe("the one about X");
    expect(field(t)!.getAttribute("aria-label")).toBe("Short note");
    expect(field(t)!.maxLength).toBe(140);
    expect(t.sent).toEqual([]);
  });
});

describe("saving", () => {
  it("sends the trimmed text on Enter and shows it at once", () => {
    const t = opened();
    factButton(t).click();
    field(t)!.value = "  the one about Y ";
    press(field(t)!, "Enter");
    expect(written(t)).toEqual([{ type: "paper.describeFile", id: "a", name: "paper.pdf", description: "the one about Y" }]);
    expect(field(t)).toBeNull();
    expect(factButton(t).textContent).toBe("the one about Y");
  });

  it("saves on blur", () => {
    const t = opened();
    factButton(t).click();
    field(t)!.value = "kept";
    field(t)!.dispatchEvent(new FocusEvent("blur"));
    expect(written(t)).toEqual([{ type: "paper.describeFile", id: "a", name: "paper.pdf", description: "kept" }]);
  });

  it("sends an empty text to clear the note and shows the placeholder", () => {
    const t = opened("old");
    factButton(t).click();
    field(t)!.value = "   ";
    press(field(t)!, "Enter");
    expect(written(t)).toEqual([{ type: "paper.describeFile", id: "a", name: "paper.pdf", description: "" }]);
    expect(factButton(t).textContent).toBe("Add a short note");
  });

  it("sends nothing when the text did not change", () => {
    const t = opened("same");
    factButton(t).click();
    press(field(t)!, "Enter");
    expect(written(t)).toEqual([]);
  });
});

describe("cancelling and keys", () => {
  it("restores the text on Escape without writing, even when the field then loses focus", () => {
    const t = opened("keep me");
    factButton(t).click();
    field(t)!.value = "typed";
    press(field(t)!, "Escape");
    expect(written(t)).toEqual([]);
    expect(factButton(t).textContent).toBe("keep me");
  });

  it("keeps typed keys from the list shortcuts", () => {
    const t = opened();
    factButton(t).click();
    const input = field(t)!;
    const reached = jest.fn();
    document.addEventListener("keydown", reached);
    press(input, "a");
    press(input, "ArrowDown");
    document.removeEventListener("keydown", reached);
    expect(reached).not.toHaveBeenCalled();
  });
});
