/** @jest-environment jsdom */
/** Tests mountNoteFile: one editor per item in file order, each in its own card with its date, saves through the host, updates from outside, and the first item of an empty file. */
import { mountNoteFile } from "../../../src/qmd/dom/mountNoteFile";

const ID_A = "n-01JABCDEFGHJKMNPQRSTVWXYZ0";
const ID_B = "n-01JABCDEFGHJKMNPQRSTVWXYZ1";
const item = (id: string, body: string, created?: string): string =>
  `::: {#${id} .labshelf-item${created ? ` created="${created}"` : ""}}\n${body}\n:::\n`;
const FILE = `---\ntitle: x\n---\n\n${item(ID_A, "First item", "2026-03-04T10:00:00Z")}\nloose\n\n${item(ID_B, "Second item")}`;

function mount(text: string, extra: Partial<Parameters<typeof mountNoteFile>[1]> = {}) {
  const host = document.body.appendChild(document.createElement("div"));
  const saves: [string, string][] = [];
  const handle = mountNoteFile(host, { text, noteKey: "paper:p1", save: (id, body) => saves.push([id, body]), ...extra });
  return { host, saves, handle };
}

afterEach(() => { document.body.replaceChildren(); jest.useRealTimers(); });

describe("mountNoteFile", () => {
  it("mounts one editor per item, in file order, each in its own card after the note bar", () => {
    const { host, handle } = mount(FILE);
    const cards = [...host.querySelectorAll<HTMLElement>(".qmd-note-file-items > .qmd-note-file-item")];
    expect(cards.map((card) => card.dataset["itemId"])).toEqual([ID_A, ID_B]);
    expect(handle.editors.map((editor) => editor.itemId)).toEqual([ID_A, ID_B]);
    expect(cards[0]!.textContent).toContain("First item");
    expect(cards[1]!.textContent).toContain("Second item");
    expect(cards.every((card) => card.querySelectorAll(".ProseMirror").length === 1)).toBe(true);
    const root = host.querySelector(".qmd-note-file")!;
    expect(root.querySelector(".qmd-note-bar")?.compareDocumentPosition(root.querySelector(".qmd-note-file-items")!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(host.textContent).not.toContain("loose");
  });

  it("shows the item's date in its card header", () => {
    const { host } = mount(FILE);
    expect(host.querySelector(`[data-item-id="${ID_A}"] .qmd-editor-meta`)?.textContent).toBe("2026-03-04");
    expect(host.querySelector(`[data-item-id="${ID_B}"] .qmd-editor-meta`)).toBeNull();
  });

  it("replaces a body changed outside and keeps the editors when the items stay the same", () => {
    const { host, handle } = mount(FILE);
    const before = host.querySelector(`[data-item-id="${ID_B}"]`);
    handle.update(FILE.replace("Second item", "Changed outside"));
    expect(host.querySelector(`[data-item-id="${ID_B}"]`)).toBe(before);
    expect(before!.textContent).toContain("Changed outside");
  });

  it("mounts the items again when their ids change", () => {
    const { host, handle } = mount(FILE);
    handle.update(item(ID_B, "Only B"));
    expect([...host.querySelectorAll<HTMLElement>(".qmd-note-file-item")].map((card) => card.dataset["itemId"])).toEqual([ID_B]);
  });

  it("says the note is empty when the host cannot add items", () => {
    const { host } = mount("");
    expect(host.querySelector(".qmd-note-file-item")).toBeNull();
    expect(host.textContent).toContain("is empty");
  });

  it("offers an editor on an empty file when the host can add items", () => {
    const { host } = mount("", { create: () => undefined });
    expect(host.querySelectorAll(".qmd-note-file-item.is-new .ProseMirror")).toHaveLength(1);
  });

  it("destroy removes everything it mounted", () => {
    const { host, handle } = mount(FILE);
    handle.destroy();
    expect(host.children).toHaveLength(0);
  });
});
