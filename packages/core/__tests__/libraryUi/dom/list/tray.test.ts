/**
 * @jest-environment jsdom
 */
// Tests the files tray: opening a paper, its rows and facts, the short note, and what a row does.
import { mountForTest, paper, menuLabels } from "../mountHarness";
import type { PaperFile } from "@labshelf/core";
import type { PaperRecord } from "../../../../src/model";
import { deriveTrayEntries } from "../../../../src/libraryUi/dom/list/tray";

const library = [paper("a", "papers", { title: "Alpha" }), paper("b", "papers", { title: "Beta" })];
const PDFS = ["papers/a", "papers/b"];

type T = ReturnType<typeof mountForTest>;
const mounted = (): T => { const t = mountForTest(); t.snapshot(library, PDFS); return t; };
const unit = (t: T, id: string): HTMLElement => t.rows().find((r) => r.dataset["id"] === id)!;
const main = (t: T, id: string): HTMLElement => unit(t, id).querySelector<HTMLElement>(".paper-row-main")!;
const twistie = (t: T, id: string): HTMLElement => unit(t, id).querySelector<HTMLElement>(".expand-btn")!;
const filesRequests = (t: T): unknown[] => t.sent.filter((m) => m.type === "paper.files");
const trayRows = (t: T, id: string): HTMLElement[] => [...unit(t, id).querySelectorAll<HTMLElement>('.paper-children [role="row"]')];

describe("open paper", () => {
  it("opens on a twistie click and closes on a second click", () => {
    const t = mounted();
    twistie(t, "a").click();
    expect(t.lib.store.get().open).toBe("a");
    expect(main(t, "a").getAttribute("aria-expanded")).toBe("true");
    expect(unit(t, "a").classList.contains("expanded")).toBe(true);
    twistie(t, "a").click();
    expect(t.lib.store.get().open).toBeNull();
    expect(main(t, "a").getAttribute("aria-expanded")).toBe("false");
    expect(unit(t, "a").classList.contains("expanded")).toBe(false);
  });

  it("closes the open paper when another opens", () => {
    const t = mounted();
    twistie(t, "a").click();
    twistie(t, "b").click();
    expect(t.lib.store.get().open).toBe("b");
    expect(main(t, "a").getAttribute("aria-expanded")).toBe("false");
    expect(main(t, "b").getAttribute("aria-expanded")).toBe("true");
    expect(t.container.querySelectorAll(".paper-row.expanded")).toHaveLength(1);
  });

  it("opens a collapsed paper on ArrowRight", () => {
    const t = mounted();
    t.key("ArrowDown");
    t.key("ArrowRight");
    expect(t.lib.store.get().open).toBe("a");
    expect(main(t, "a").getAttribute("aria-expanded")).toBe("true");
  });

  it("expands the paper a host reveal names", () => {
    const t = mounted();
    t.host.post({ type: "reveal", id: "b" });
    expect(main(t, "b").getAttribute("aria-expanded")).toBe("true");
    expect(main(t, "a").getAttribute("aria-expanded")).toBe("false");
  });

  it("requests the files once when a paper opens", () => {
    const t = mounted();
    twistie(t, "a").click();
    expect(filesRequests(t)).toEqual([{ type: "paper.files", id: "a" }]);
    t.files("a", { status: "ready", files: [] });
    expect(filesRequests(t)).toHaveLength(1);
  });

  it("shows Loading files… until the reply arrives", () => {
    const t = mounted();
    twistie(t, "a").click();
    expect(trayRows(t, "a")).toHaveLength(1);
    expect(trayRows(t, "a")[0]!.textContent).toContain("Loading files…");
    t.files("a", { status: "ready", files: [{ name: "paper.pdf", kind: "file", size: 10, modified: "2026-10-03T12:00:00Z" }] });
    expect(unit(t, "a").textContent).not.toContain("Loading files…");
    expect(trayRows(t, "a")[0]!.textContent).toContain("paper.pdf");
  });
});

const MOD = "2026-10-03T12:00:00Z";
const file = (name: string, extra: Partial<PaperFile> = {}): PaperFile => ({ name, kind: "file", size: 12698, modified: MOD, ...extra });
const folder = (name: string, extra: Partial<PaperFile> = {}): PaperFile => ({ name, kind: "folder", modified: MOD, ...extra });


type Setup = { record?: Parameters<typeof paper>[2]; notes?: string[] };
function openWith(files: PaperFile[], setup: Setup = {}): T {
  const t = mountForTest();
  t.snapshot([paper("a", "papers", { title: "Alpha", ...setup.record })], ["papers/a"]);
  t.click(".expand-btn");
  if (setup.notes) t.host.post({ type: "details", id: "a", details: { annotations: [], reading: null, pdf: null, notes: setup.notes.map((body, i) => ({ id: `n${i}`, anchor: "", body, created: "", author: "" })) } });
  t.files("a", { status: "ready", files });
  return t;
}
const tray = (t: T): HTMLElement[] => [...t.container.querySelectorAll<HTMLElement>('.paper-children [role="row"]')];
const names = (t: T): string[] => tray(t).map((r) => r.querySelector(".file-name")?.textContent ?? "");
const typeOf = (t: T, name: string): string => rowNamed(t, name).querySelector(".file-type")!.textContent!.trim();
const rowNamed = (t: T, name: string): HTMLElement => tray(t).find((r) => r.querySelector(".file-name")?.textContent === name)!;
const text = (t: T, name: string): string => rowNamed(t, name).textContent ?? "";

describe("tray row order", () => {
  it("lists paper.pdf, the Note, other files, then subfolders", () => {
    const t = openWith([file("paper.pdf"), file("data.csv"), file("zeta.txt"), folder("supplement")], { notes: ["hello"] });
    expect(names(t)).toEqual(["paper.pdf", "Note", "data.csv", "zeta.txt", "supplement"]);
  });

  it("never shows metadata.yaml, even when the host sends it", () => {
    const t = openWith([file("paper.pdf"), file("metadata.yaml"), file("a.txt")]);
    expect(names(t)).not.toContain("metadata.yaml");
    expect(names(t)).toContain("a.txt");
  });
});

describe("tray row shape", () => {
  it("makes each row a level 2 row with a roving tabindex of -1", () => {
    const t = openWith([file("paper.pdf"), file("a.txt"), folder("sub")]);
    expect(tray(t)).toHaveLength(4);
    for (const r of tray(t)) {
      expect(r.getAttribute("role")).toBe("row");
      expect(r.getAttribute("aria-level")).toBe("2");
      expect(r.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("moves into the first tray row on ArrowDown from the open paper", () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers"), paper("b", "papers")], ["papers/a", "papers/b"]);
    t.key("ArrowDown");
    t.key("ArrowRight");
    t.files("a", { status: "ready", files: [file("paper.pdf"), file("a.txt")] });
    t.key("ArrowDown");
    expect(document.activeElement).toBe(tray(t)[0]);
    t.key("ArrowDown");
    expect(document.activeElement).toBe(tray(t)[1]);
  });
});

describe("type labels", () => {
  it("shows PDF, MD, a chevron for folders and the upper-case extension for other files", () => {
    const t = openWith([file("paper.pdf"), file("notes.md"), file("data.csv"), file("README"), folder("sub")]);
    expect(typeOf(t, "paper.pdf")).toBe("PDF");
    expect(typeOf(t, "notes.md")).toBe("MD");
    expect(typeOf(t, "data.csv")).toBe("CSV");
    expect(typeOf(t, "README")).toBe("FILE");
    expect(typeOf(t, "sub")).toBe("");
    expect(rowNamed(t, "sub").querySelector(".file-type svg")).not.toBeNull();
  });

  it("labels the synthetic Note row MD", () => {
    const t = openWith([file("paper.pdf")], { notes: ["x"] });
    expect(typeOf(t, "Note")).toBe("MD");
  });
});

describe("facts", () => {
  it("shows the paper.pdf description, or a placeholder hint when it is empty", () => {
    const described = openWith([file("paper.pdf", { description: "the one about X" })]);
    expect(text(described, "paper.pdf")).toContain("the one about X");
    expect(rowNamed(described, "paper.pdf").querySelector(".file-fact-btn.empty")).toBeNull();
    const bare = openWith([file("paper.pdf")], { record: { summary: "An abstract." } });
    expect(rowNamed(bare, "paper.pdf").querySelector(".file-fact-btn.empty")?.textContent).toBe("Add a short note");
    expect(text(bare, "paper.pdf")).not.toContain("An abstract");
  });

  it("shows the start of the last note, trimmed to its first non-blank line, or Empty", () => {
    const withNote = openWith([file("paper.pdf")], { notes: ["old", "  First line\nsecond line"] });
    expect(text(withNote, "Note")).toContain("First line");
    expect(text(withNote, "Note")).not.toContain("second line");
    expect(rowNamed(withNote, "Note").querySelector(".file-fact-label")).toBeNull();
    const cells = [...rowNamed(withNote, "Note").querySelectorAll('[role="gridcell"]')].map((c) => c.textContent?.trim()).filter(Boolean);
    expect(cells.join(" ")).toBe("MD Note First line");
    const empty = openWith([file("paper.pdf")]);
    expect(text(empty, "Note")).toContain("Empty");
  });

  it("labels a file description Contents and a folder description Source", () => {
    const t = openWith([file("data.csv", { description: "raw runs" }), folder("code", { description: "repo" }), file("plain.txt"), folder("bare")]);
    expect(text(t, "data.csv")).toContain("Contents");
    expect(text(t, "data.csv")).toContain("raw runs");
    expect(text(t, "code")).toContain("Source");
    expect(text(t, "code")).toContain("repo");
    expect(rowNamed(t, "plain.txt").querySelector(".file-fact")?.textContent ?? "").toBe("");
    expect(rowNamed(t, "bare").querySelector(".file-fact")?.textContent ?? "").toBe("");
  });
});

describe("tooltips", () => {
  it("gives a file its size and modified date", () => {
    const t = openWith([file("data.csv")]);
    expect(rowNamed(t, "data.csv").title).toBe("12.4 KB · modified 3 Oct 2026");
  });

  it("gives a folder only the modified date", () => {
    const t = openWith([folder("sub", { size: 99 })]);
    expect(rowNamed(t, "sub").title).toBe("modified 3 Oct 2026");
  });
});

describe("failed listing", () => {
  it("shows the failure message in one row", () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers")], ["papers/a"]);
    t.click(".expand-btn");
    t.files("a", { status: "failed", message: "Cannot read the folder" });
    expect(tray(t)).toHaveLength(1);
    expect(tray(t)[0]!.textContent).toContain("Cannot read the folder");
  });
});

const record = { id: "p", title: "T", summary: "An abstract. More." } as PaperRecord;
const pdf = (description?: string): PaperFile => ({ name: "paper.pdf", kind: "file", size: 1, modified: "2026-01-01T00:00:00.000Z", ...(description ? { description } : {}) });
const pdfEntry = (file: PaperFile) => deriveTrayEntries(record, [file]).find((e) => e.kind === "pdf")!;

describe("paper.pdf fact", () => {
  it("is the description without a label", () => {
    expect(pdfEntry(pdf("the one about X")).fact).toEqual({ label: "", text: "the one about X" });
  });

  it("is a flagged placeholder when there is no description, whatever the abstract says", () => {
    expect(pdfEntry(pdf()).fact).toEqual({ label: "", text: "Add a short note", placeholder: true });
  });
});

const pdfDrawTray = (description?: string): PaperFile => ({ name: "paper.pdf", kind: "file", size: 1, modified: MOD, ...(description ? { description } : {}) });


function opened(description?: string): T {
  const t = mountForTest();
  t.snapshot([paper("a", "papers")], ["papers/a"]);
  t.click(".expand-btn");
  t.files("a", { status: "ready", files: [pdfDrawTray(description)] });
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

const FILES: PaperFile[] = [
  { name: "paper.pdf", kind: "file", size: 100, modified: MOD },
  { name: "data.csv", kind: "file", size: 100, modified: MOD, description: "raw runs" },
  { name: "code", kind: "folder", modified: MOD },
];


function openedTrayActions(): T {
  const t = mountForTest();
  t.snapshot([paper("a", "papers")], ["papers/a"]);
  t.click(".expand-btn");
  t.files("a", { status: "ready", files: FILES });
  t.sent.length = 0;
  return t;
}
const rowNamedTrayActions = (t: T, name: string): HTMLElement =>
  [...t.container.querySelectorAll<HTMLElement>('.paper-children [role="row"]')].find((r) => r.querySelector(".file-name")?.textContent === name)!;
const button = (t: T, name: string, label: string): HTMLElement | null => rowNamedTrayActions(t, name).querySelector<HTMLElement>(`button[aria-label="${label}"]`);
const sentOfType = (t: T, type: string): unknown[] => t.sent.filter((m) => m.type === type);
const contextMenu = (row: HTMLElement): void => { row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const quickInput = (): HTMLInputElement => document.querySelector<HTMLInputElement>(".ls-quick input")!;
const pressOn = (el: Element, key: string): void => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); };

describe("activation", () => {
  it("opens paper.pdf through the PDF open path on click and on Enter", () => {
    const t = openedTrayActions();
    rowNamedTrayActions(t, "paper.pdf").click();
    expect(t.sent).toEqual([{ type: "paper.open", id: "a" }]);
    t.sent.length = 0;
    rowNamedTrayActions(t, "paper.pdf").focus();
    t.key("Enter");
    expect(t.sent).toEqual([{ type: "paper.open", id: "a" }]);
  });

  it("opens another file with paper.openFile", () => {
    const t = openedTrayActions();
    rowNamedTrayActions(t, "data.csv").click();
    expect(t.sent).toEqual([{ type: "paper.openFile", id: "a", name: "data.csv" }]);
  });

  it("reveals a folder with paper.revealFile", () => {
    const t = openedTrayActions();
    rowNamedTrayActions(t, "code").click();
    expect(t.sent).toEqual([{ type: "paper.revealFile", id: "a", name: "code" }]);
  });
});

describe("hover actions", () => {
  it("posts openFile, revealFile and copyFilePath from the buttons without activating the row", () => {
    const t = openedTrayActions();
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
    const t = openedTrayActions();
    expect(button(t, "code", "Open to the side")).toBeNull();
    button(t, "code", "Reveal in folder")!.click();
    button(t, "code", "Copy path")!.click();
    expect(t.sent).toEqual([
      { type: "paper.revealFile", id: "a", name: "code" },
      { type: "paper.copyFilePath", id: "a", name: "code" },
    ]);
  });

  it("keeps the buttons out of the tab order", () => {
    const t = openedTrayActions();
    const buttons = rowNamedTrayActions(t, "data.csv").querySelectorAll("button");
    expect(buttons).toHaveLength(3);
    for (const b of buttons) expect(b.getAttribute("tabindex")).toBe("-1");
  });
});

describe("file menu", () => {
  it("opens on contextmenu with Describe… for another file", () => {
    const t = openedTrayActions();
    contextMenu(rowNamedTrayActions(t, "data.csv"));
    expect(menuLabels()).toEqual(["Open", "Open to the side", "Reveal in folder", "Copy path", "Describe…"]);
  });

  it("opens on Shift+F10 from a focused tray row", () => {
    const t = openedTrayActions();
    rowNamedTrayActions(t, "code").focus();
    t.key("F10", { shiftKey: true });
    expect(menuLabels()).toEqual(["Open", "Reveal in folder", "Copy path", "Describe…"]);
  });

  it("omits Describe… for paper.pdf", () => {
    const t = openedTrayActions();
    contextMenu(rowNamedTrayActions(t, "paper.pdf"));
    expect(menuLabels()).toEqual(["Open", "Open to the side", "Reveal in folder", "Copy path"]);
  });

  it("runs the chosen item", () => {
    const t = openedTrayActions();
    contextMenu(rowNamedTrayActions(t, "data.csv"));
    [...document.querySelectorAll<HTMLElement>(".ls-menu-item")].find((i) => i.textContent?.includes("Copy path"))!.click();
    expect(t.sent).toEqual([{ type: "paper.copyFilePath", id: "a", name: "data.csv" }]);
  });
});

describe("Describe…", () => {
  async function describeFlow(t: T, name: string): Promise<void> {
    contextMenu(rowNamedTrayActions(t, name));
    [...document.querySelectorAll<HTMLElement>(".ls-menu-item")].find((i) => i.textContent?.includes("Describe…"))!.click();
    await tick();
  }

  it("prefills the current description", async () => {
    const t = openedTrayActions();
    await describeFlow(t, "data.csv");
    expect(quickInput().value).toBe("raw runs");
    expect(document.querySelector(".ls-quick-title")?.textContent).toBe("Describe data.csv");
  });

  it("posts the trimmed text", async () => {
    const t = openedTrayActions();
    await describeFlow(t, "data.csv");
    quickInput().value = "  text ";
    pressOn(quickInput(), "Enter");
    await tick();
    expect(sentOfType(t, "paper.describeFile")).toEqual([{ type: "paper.describeFile", id: "a", name: "data.csv", description: "text" }]);
  });

  it("posts an empty description to remove it", async () => {
    const t = openedTrayActions();
    await describeFlow(t, "data.csv");
    quickInput().value = "";
    pressOn(quickInput(), "Enter");
    await tick();
    expect(sentOfType(t, "paper.describeFile")).toEqual([{ type: "paper.describeFile", id: "a", name: "data.csv", description: "" }]);
  });

  it("posts nothing when cancelled", async () => {
    const t = openedTrayActions();
    await describeFlow(t, "code");
    expect(quickInput()).not.toBeNull();
    pressOn(document.body, "Escape");
    await tick();
    expect(sentOfType(t, "paper.describeFile")).toEqual([]);
  });
});
