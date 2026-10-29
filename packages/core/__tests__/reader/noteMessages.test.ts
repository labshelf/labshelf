// Tests the reader host's note messages: writes through PaperNotesStore, the pushed list, the preview refusal and init.
import { PaperNotesStore, parseItemFile, type HostToWebview, type ItemSegment } from "@labshelf/core";
import { setupHost, sidecar } from "./hostFixture";

const ID_A = "n-01JB2QN0000000000000000000";
const ID_B = "n-01JB2QP0000000000000000000";

const ITEM_A = `::: {#${ID_A} .labshelf-item anchor="p1 box 0.1 0.2 0.3 0.4" author="Ana" created="2026-10-01T00:00:00.000Z" color="red"}\nFirst note\n:::\n`;
const ITEM_B = `::: {#${ID_B} .labshelf-item anchor="hl:a1" author="Ana" created="2026-10-02T00:00:00.000Z"}\nSecond note\n:::\n`;
const LOOSE = "Loose heading text\n\n";
const SEED = `${LOOSE}${ITEM_A}\n${ITEM_B}`;

type UpdateNotes = Extract<HostToWebview, { type: "updateNotes" }>;
type Init = Extract<HostToWebview, { type: "init" }>;
type ReaderNoteShape = UpdateNotes["items"][number];

/** A host with a notes store over an in-memory file port. `writes` records each text written. */
function setupNotesHost(options: { seed?: string; failWrites?: boolean } = {}) {
  const base = setupHost();
  const files: Record<string, string> = options.seed !== undefined ? { p1: options.seed } : {};
  const writes: string[] = [];
  const port = {
    read: async (id: string) => files[id] ?? null,
    write: async (id: string, text: string) => {
      if (options.failWrites) { throw new Error("disk full"); }
      files[id] = text;
      writes.push(text);
    },
  };
  const notes = new PaperNotesStore(port, { logger: base.ports.logger });
  Object.assign(base.ports, { notes });
  const updates = (): UpdateNotes[] => base.posted.filter((m): m is UpdateNotes => m.type === "updateNotes");
  return { ...base, notes, notesFiles: files, writes, updates };
}

const items = (text: string): ItemSegment[] =>
  parseItemFile(text).segments.filter((s): s is ItemSegment => s.kind === "item");

describe("reader note messages", () => {
  describe("addNote, editNote and removeNote", () => {
    it("7.3a addNote writes a new item through the store and pushes the full list", async () => {
      const { host, notesFiles, updates } = setupNotesHost({ seed: SEED });
      await host.handle({ command: "addNote", anchor: "hl:a9", body: "Added body" });
      const stored = items(notesFiles.p1!);
      expect(stored).toHaveLength(3);
      const added = stored.find((s) => s.id !== ID_A && s.id !== ID_B)!;
      expect(added.body).toContain("Added body");
      expect(added.anchor).toEqual({ kind: "highlight", annotationId: "a9" });
      expect(notesFiles.p1!.startsWith(`${LOOSE}${ITEM_A}`)).toBe(true);
      expect(updates()).toHaveLength(1);
      const sent = updates()[0]!.items;
      expect(sent.map((n) => n.id).sort()).toEqual([ID_A, ID_B, added.id].sort());
      expect(sent.find((n) => n.id === added.id)).toMatchObject({ anchor: "hl:a9", body: expect.stringContaining("Added body") });
    });

    it("7.3a addNote creates notes.qmd content for a paper without notes and accepts an empty anchor", async () => {
      const { host, notesFiles, updates } = setupNotesHost();
      await host.handle({ command: "addNote", anchor: "", body: "Loose idea" });
      expect(items(notesFiles.p1!)).toHaveLength(1);
      expect(updates()).toHaveLength(1);
      expect(updates()[0]!.items).toEqual([expect.objectContaining({ anchor: "", body: expect.stringContaining("Loose idea") })]);
    });

    it("7.3a the pushed note carries id, anchor, body, created and author as strings", async () => {
      const { host, updates } = setupNotesHost({ seed: SEED });
      await host.handle({ command: "addNote", anchor: "", body: "x" });
      for (const note of updates()[0]!.items as ReaderNoteShape[]) {
        expect(typeof note.id).toBe("string");
        expect(typeof note.anchor).toBe("string");
        expect(typeof note.body).toBe("string");
        expect(typeof note.created).toBe("string");
        expect(typeof note.author).toBe("string");
      }
    });

    it("7.3a editNote changes only that item's body and pushes the full list", async () => {
      const { host, notesFiles, updates } = setupNotesHost({ seed: SEED });
      await host.handle({ command: "editNote", id: ID_B, body: "Edited body" });
      const stored = items(notesFiles.p1!);
      expect(stored.find((s) => s.id === ID_B)!.body).toContain("Edited body");
      expect(stored.find((s) => s.id === ID_A)!.body).toBe("First note\n");
      expect(notesFiles.p1!.startsWith(`${LOOSE}${ITEM_A}`)).toBe(true);
      expect(updates()).toHaveLength(1);
      const sent = updates()[0]!.items;
      expect(sent).toHaveLength(2);
      expect(sent.find((n) => n.id === ID_B)!.body).toContain("Edited body");
      expect(sent.find((n) => n.id === ID_A)!.body).toContain("First note");
    });

    it("7.3a removeNote deletes only that item and pushes the remaining list", async () => {
      const { host, notesFiles, updates } = setupNotesHost({ seed: SEED });
      await host.handle({ command: "removeNote", id: ID_A });
      expect(items(notesFiles.p1!).map((s) => s.id)).toEqual([ID_B]);
      expect(notesFiles.p1!).toContain(LOOSE);
      expect(notesFiles.p1!).toContain(ITEM_B);
      expect(updates()).toHaveLength(1);
      expect(updates()[0]!.items.map((n) => n.id)).toEqual([ID_B]);
    });

    it("7.3a a failed write is logged and shown as a notice, and nothing is pushed", async () => {
      const { host, ports, posted, writes } = setupNotesHost({ seed: SEED, failWrites: true });
      await host.handle({ command: "editNote", id: ID_A, body: "never saved" });
      expect(writes).toHaveLength(0);
      expect(ports.logger.error).toHaveBeenCalled();
      expect(ports.notify).toHaveBeenCalledWith(expect.any(String), "error");
      expect(posted.filter((m) => m.type === "updateNotes")).toHaveLength(0);
    });

    it("7.3a a failed add is logged and shown as a notice, and nothing is pushed", async () => {
      const { host, ports, posted } = setupNotesHost({ failWrites: true });
      await host.handle({ command: "addNote", anchor: "", body: "never saved" });
      expect(ports.logger.error).toHaveBeenCalled();
      expect(ports.notify).toHaveBeenCalledWith(expect.any(String), "error");
      expect(posted.filter((m) => m.type === "updateNotes")).toHaveLength(0);
    });

    it("7.3a editing an unknown item shows an error notice and writes nothing", async () => {
      const { host, ports, writes, updates } = setupNotesHost({ seed: SEED });
      await host.handle({ command: "editNote", id: "n-01JB2QZ0000000000000000000", body: "x" });
      expect(writes).toHaveLength(0);
      expect(ports.notify).toHaveBeenCalledWith(expect.any(String), "error");
      expect(updates()).toHaveLength(0);
    });
  });

  describe("moveNote", () => {
    it("7.3b changes only the anchor attribute of the item and pushes the list", async () => {
      const { host, notesFiles, updates } = setupNotesHost({ seed: SEED });
      await host.handle({ command: "moveNote", id: ID_A, anchor: "p2 box 0.5 0.5 0.25 0.25" });
      const before = items(SEED).find((s) => s.id === ID_A)!;
      const after = items(notesFiles.p1!).find((s) => s.id === ID_A)!;
      expect(after.anchor).toEqual({ kind: "box", page: 2, x: 0.5, y: 0.5, w: 0.25, h: 0.25 });
      expect(after.body).toBe(before.body);
      expect(after.close).toBe(before.close);
      expect(after.author).toBe(before.author);
      expect(after.created).toBe(before.created);
      expect(after.classes).toEqual(before.classes);
      expect(after.attrs.filter(([k]) => k !== "anchor")).toEqual(before.attrs.filter(([k]) => k !== "anchor"));
      expect(after.attrs).toContainEqual(["color", "red"]);
      expect(updates()).toHaveLength(1);
      expect(updates()[0]!.items.find((n) => n.id === ID_A)!.anchor).toBe("p2 box 0.5 0.5 0.25 0.25");
    });

    it("7.3b leaves the other items and the loose text byte for byte", async () => {
      const { host, notesFiles, updates } = setupNotesHost({ seed: SEED });
      await host.handle({ command: "moveNote", id: ID_A, anchor: "p2 box 0.5 0.5 0.25 0.25" });
      expect(notesFiles.p1!.startsWith(LOOSE)).toBe(true);
      expect(notesFiles.p1!.endsWith(`\n${ITEM_B}`)).toBe(true);
      const sent = updates()[0]!.items;
      expect(sent).toHaveLength(2);
      expect(sent.find((n) => n.id === ID_B)).toMatchObject({ anchor: "hl:a1", body: expect.stringContaining("Second note") });
    });

    it("7.3b a failed move is logged and shown as a notice, and nothing is pushed", async () => {
      const { host, ports, posted } = setupNotesHost({ seed: SEED, failWrites: true });
      await host.handle({ command: "moveNote", id: ID_A, anchor: "p2 box 0.5 0.5 0.25 0.25" });
      expect(ports.logger.error).toHaveBeenCalled();
      expect(ports.notify).toHaveBeenCalledWith(expect.any(String), "error");
      expect(posted.filter((m) => m.type === "updateNotes")).toHaveLength(0);
    });
  });

  describe("a host without the notes port", () => {
    const writeMessages = [
      { command: "addNote", anchor: "", body: "x" },
      { command: "editNote", id: ID_A, body: "x" },
      { command: "moveNote", id: ID_A, anchor: "p1 box 0.1 0.1 0.2 0.2" },
      { command: "removeNote", id: ID_A },
    ] as const;

    it.each(writeMessages)("7.3c refuses $command with a notice and sends an empty list", async (message) => {
      const { host, ports, posted, files } = setupHost();
      await host.handle(message);
      expect(ports.notify).toHaveBeenCalledTimes(1);
      expect(ports.notify).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/^(info|error)$/));
      expect(files).toEqual({});
      const updates = posted.filter((m): m is UpdateNotes => m.type === "updateNotes");
      expect(updates).toEqual([{ type: "updateNotes", items: [] }]);
    });

    it("7.3c sends an empty list in init", async () => {
      const { host, posted } = setupHost({ seed: sidecar });
      await host.handle({ command: "ready-for-init" });
      expect((posted[0] as Init).notes).toEqual([]);
    });
  });

  describe("init and the sidecar without addNote", () => {
    it("7.3d init carries the notes of the paper", async () => {
      const { host, posted } = setupNotesHost({ seed: SEED });
      await host.handle({ command: "ready-for-init" });
      const init = posted.find((m): m is Init => m.type === "init")!;
      expect(init.notes.map((n) => n.id).sort()).toEqual([ID_A, ID_B]);
      expect(init.notes.find((n) => n.id === ID_A)).toMatchObject({
        anchor: "p1 box 0.1 0.2 0.3 0.4", body: expect.stringContaining("First note"), author: "Ana", created: "2026-10-01T00:00:00.000Z",
      });
    });

    it("7.3d init carries an empty list for a paper without notes", async () => {
      const { host, posted } = setupNotesHost();
      await host.handle({ command: "ready-for-init" });
      expect((posted.find((m): m is Init => m.type === "init")!).notes).toEqual([]);
    });

    it("7.3d init does not read annotations of type note from an old data.json", async () => {
      const { host, posted } = setupHost({ seed: sidecar });
      await host.handle({ command: "ready-for-init" });
      expect((posted[0] as Init).annotations.map((a) => a.id)).toEqual(["a"]);
    });

    it("7.3d a sidecar write does not rewrite annotations of type note", async () => {
      const { host, files } = setupHost({ seed: sidecar });
      await host.handle({ command: "createAnnotation", type: "highlight", pageNumber: 3, content: "q", color: "green" });
      const types = (JSON.parse(files.p1!).annotations as Array<{ type: string }>).map((a) => a.type);
      expect(types).toHaveLength(2);
      expect(types).not.toContain("note");
    });

    it("7.3d the sidecar store no longer has addNote", () => {
      const { ports } = setupHost();
      expect((ports.store as unknown as { addNote?: unknown }).addNote).toBeUndefined();
    });

    it("7.3d highlights still go through the sidecar and are pushed as annotations", async () => {
      const { host, posted, files } = setupHost();
      await host.handle({ command: "createAnnotation", type: "highlight", pageNumber: 1, content: "q" });
      expect(JSON.parse(files.p1!).annotations).toHaveLength(1);
      expect(posted).toEqual([{ type: "updateAnnotations", annotations: [expect.objectContaining({ type: "highlight" })] }]);
    });
  });
});
