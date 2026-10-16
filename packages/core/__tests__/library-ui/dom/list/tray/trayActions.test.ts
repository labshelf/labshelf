/**
 * @jest-environment jsdom
 */
// Tests what a tray row does: activation, hover action buttons, the file menu and Describe….
import type { PaperFile } from "@labshelf/core";
import { menuLabels, mountForTest, paper } from "../../mountHarness";

const MOD = "2026-10-03T12:00:00Z";
const FILES: PaperFile[] = [
  { name: "paper.pdf", kind: "file", size: 100, modified: MOD },
  { name: "data.csv", kind: "file", size: 100, modified: MOD, description: "raw runs" },
  { name: "code", kind: "folder", modified: MOD },
];

type T = ReturnType<typeof mountForTest>;
function opened(): T {
  const t = mountForTest();
  t.snapshot([paper("a", "papers", { note: "n" })], ["papers/a"]);
  t.click(".expand-btn");
  t.files("a", { status: "ready", files: FILES });
  t.sent.length = 0;
  return t;
}
const rowNamed = (t: T, name: string): HTMLElement =>
  [...t.container.querySelectorAll<HTMLElement>('.paper-children [role="row"]')].find((r) => r.querySelector(".file-name")?.textContent === name)!;
const button = (t: T, name: string, label: string): HTMLElement | null => rowNamed(t, name).querySelector<HTMLElement>(`button[aria-label="${label}"]`);
const sentOfType = (t: T, type: string): unknown[] => t.sent.filter((m) => m.type === type);
const contextMenu = (row: HTMLElement): void => { row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const quickInput = (): HTMLInputElement => document.querySelector<HTMLInputElement>(".ls-quick input")!;
const pressOn = (el: Element, key: string): void => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); };

describe("activation", () => {
  it("opens paper.pdf through the PDF open path on click and on Enter", () => {
    const t = opened();
    rowNamed(t, "paper.pdf").click();
    expect(t.sent).toEqual([{ type: "paper.open", id: "a" }]);
    t.sent.length = 0;
    rowNamed(t, "paper.pdf").focus();
    t.key("Enter");
    expect(t.sent).toEqual([{ type: "paper.open", id: "a" }]);
  });

  it("opens another file with paper.openFile", () => {
    const t = opened();
    rowNamed(t, "data.csv").click();
    expect(t.sent).toEqual([{ type: "paper.openFile", id: "a", name: "data.csv" }]);
  });

  it("reveals a folder with paper.revealFile", () => {
    const t = opened();
    rowNamed(t, "code").click();
    expect(t.sent).toEqual([{ type: "paper.revealFile", id: "a", name: "code" }]);
  });
});

describe("hover actions", () => {
  it("posts openFile, revealFile and copyFilePath from the buttons without activating the row", () => {
    const t = opened();
    button(t, "data.csv", "Open to the side")!.click();
    button(t, "data.csv", "Reveal in folder")!.click();
    button(t, "data.csv", "Copy path")!.click();
    expect(t.sent).toEqual([
      { type: "paper.openFile", id: "a", name: "data.csv" },
      { type: "paper.revealFile", id: "a", name: "data.csv" },
      { type: "paper.copyFilePath", id: "a", name: "data.csv" },
    ]);
  });

  it("offers a folder no Open to the side", () => {
    const t = opened();
    expect(button(t, "code", "Open to the side")).toBeNull();
    button(t, "code", "Reveal in folder")!.click();
    button(t, "code", "Copy path")!.click();
    expect(t.sent).toEqual([
      { type: "paper.revealFile", id: "a", name: "code" },
      { type: "paper.copyFilePath", id: "a", name: "code" },
    ]);
  });

  it("keeps the buttons out of the tab order", () => {
    const t = opened();
    const buttons = rowNamed(t, "data.csv").querySelectorAll("button");
    expect(buttons).toHaveLength(3);
    for (const b of buttons) expect(b.getAttribute("tabindex")).toBe("-1");
  });
});

describe("file menu", () => {
  it("opens on contextmenu with Describe… for another file", () => {
    const t = opened();
    contextMenu(rowNamed(t, "data.csv"));
    expect(menuLabels()).toEqual(["Open", "Open to the side", "Reveal in folder", "Copy path", "Describe…"]);
  });

  it("opens on Shift+F10 from a focused tray row", () => {
    const t = opened();
    rowNamed(t, "code").focus();
    t.key("F10", { shiftKey: true });
    expect(menuLabels()).toEqual(["Open", "Reveal in folder", "Copy path", "Describe…"]);
  });

  it("omits Describe… for paper.pdf", () => {
    const t = opened();
    contextMenu(rowNamed(t, "paper.pdf"));
    expect(menuLabels()).toEqual(["Open", "Open to the side", "Reveal in folder", "Copy path"]);
  });

  it("runs the chosen item", () => {
    const t = opened();
    contextMenu(rowNamed(t, "data.csv"));
    [...document.querySelectorAll<HTMLElement>(".ls-menu-item")].find((i) => i.textContent?.includes("Copy path"))!.click();
    expect(t.sent).toEqual([{ type: "paper.copyFilePath", id: "a", name: "data.csv" }]);
  });
});

describe("Describe…", () => {
  async function describeFlow(t: T, name: string): Promise<void> {
    contextMenu(rowNamed(t, name));
    [...document.querySelectorAll<HTMLElement>(".ls-menu-item")].find((i) => i.textContent?.includes("Describe…"))!.click();
    await tick();
  }

  it("prefills the current description", async () => {
    const t = opened();
    await describeFlow(t, "data.csv");
    expect(quickInput().value).toBe("raw runs");
    expect(document.querySelector(".ls-quick-title")?.textContent).toBe("Describe data.csv");
  });

  it("posts the trimmed text", async () => {
    const t = opened();
    await describeFlow(t, "data.csv");
    quickInput().value = "  text ";
    pressOn(quickInput(), "Enter");
    await tick();
    expect(sentOfType(t, "paper.describeFile")).toEqual([{ type: "paper.describeFile", id: "a", name: "data.csv", description: "text" }]);
  });

  it("posts an empty description to remove it", async () => {
    const t = opened();
    await describeFlow(t, "data.csv");
    quickInput().value = "";
    pressOn(quickInput(), "Enter");
    await tick();
    expect(sentOfType(t, "paper.describeFile")).toEqual([{ type: "paper.describeFile", id: "a", name: "data.csv", description: "" }]);
  });

  it("posts nothing when cancelled", async () => {
    const t = opened();
    await describeFlow(t, "code");
    expect(quickInput()).not.toBeNull();
    pressOn(document.body, "Escape");
    await tick();
    expect(sentOfType(t, "paper.describeFile")).toEqual([]);
  });
});
