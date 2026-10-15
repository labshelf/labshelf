// Tests reader annotation messages: create, update, delete.
import { setupHost } from "./hostFixture";

const stored = (files: Record<string, string>) => JSON.parse(files.p1!).annotations as Array<Record<string, unknown>>;

describe("reader annotation messages", () => {
  describe("createAnnotation", () => {
    it("stores a highlight, pushes the list and reports the change", async () => {
      const { host, posted, files, changes, ports } = setupHost();
      await host.handle({
        command: "createAnnotation", type: "highlight", pageNumber: 1, content: "quote", color: "green",
        position: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 },
      });
      expect(stored(files)[0]).toMatchObject({ id: "a1", type: "highlight", color: "green", pageNumber: 1, position: { x: 0.1 } });
      expect(posted).toEqual([{ type: "updateAnnotations", annotations: [expect.objectContaining({ id: "a1" })] }]);
      expect(changes).toEqual([{ kind: "annotationCreated", annotation: expect.objectContaining({ id: "a1", content: "quote" }) }]);
    });

    it("defaults a highlight's colour to yellow", async () => {
      const { host, files } = setupHost();
      await host.handle({ command: "createAnnotation", type: "highlight", pageNumber: 2, content: "q" });
      expect(stored(files)[0]).toMatchObject({ color: "yellow" });
    });

    it("creates a highlight when the reader sends a null position", async () => {
      const { host, files } = setupHost();
      await host.handle({ command: "createAnnotation", type: "highlight", pageNumber: 1, content: "x", position: null });
      expect(stored(files)).toHaveLength(1);
      expect(stored(files)[0]).not.toHaveProperty("position");
    });

    it("stores a note", async () => {
      const { host, files } = setupHost();
      await host.handle({ command: "createAnnotation", type: "note", pageNumber: 4, content: "a note" });
      expect(stored(files)[0]).toMatchObject({ type: "note", pageNumber: 4, content: "a note" });
    });

    it("logs and reports an invalid annotation without writing, pushing or reporting a change", async () => {
      const { host, files, ports, posted, changes } = setupHost();
      await host.handle({ command: "createAnnotation", type: "highlight", pageNumber: 1, content: "q", color: "purple" as never });
      expect(files.p1).toBeUndefined();
      expect(ports.notify).toHaveBeenCalledWith(expect.stringMatching(/^Failed to create annotation: Invalid annotation color/), "error");
      expect(ports.logger.error).toHaveBeenCalledWith("reader", expect.any(Error), { paperId: "p1", command: "createAnnotation" });
      expect(posted).toHaveLength(0);
      expect(changes).toHaveLength(0);
    });
  });

  describe("updateAnnotation", () => {
    it("updates an annotation the reader was never sent, pushes the list and reports the change", async () => {
      const { host, posted, files, changes, ports } = setupHost();
      const ann = await ports.store.addNote("p1", 1, "old");
      await host.handle({ command: "updateAnnotation", id: ann.id, content: "edited" });
      expect(stored(files)[0]!.content).toBe("edited");
      expect(posted.at(-1)).toMatchObject({ type: "updateAnnotations" });
      expect(changes).toEqual([{ kind: "annotationUpdated", annotation: expect.objectContaining({ id: ann.id, content: "edited" }) }]);
    });

    it("reports an unknown id as a failed update", async () => {
      const { host, ports, posted, changes } = setupHost();
      await host.handle({ command: "updateAnnotation", id: "missing", content: "x" });
      expect(ports.notify).toHaveBeenCalledWith("Failed to update annotation: Annotation not found: missing", "error");
      expect(posted).toHaveLength(0);
      expect(changes).toHaveLength(0);
    });
  });

  describe("deleteAnnotation", () => {
    it("removes the annotation, pushes the list and reports the deleted id", async () => {
      const { host, posted, files, changes, ports } = setupHost();
      const ann = await ports.store.addHighlight("p1", 1, "to delete", "green");
      await host.handle({ command: "deleteAnnotation", id: ann.id });
      expect(stored(files)).toEqual([]);
      expect(posted).toEqual([{ type: "updateAnnotations", annotations: [] }]);
      expect(changes).toEqual([{ kind: "annotationDeleted", annotationId: ann.id }]);
    });

    it("pushes the list but reports no change for an unknown id", async () => {
      const { host, posted, changes } = setupHost();
      await host.handle({ command: "deleteAnnotation", id: "missing" });
      expect(posted).toEqual([{ type: "updateAnnotations", annotations: [] }]);
      expect(changes).toHaveLength(0);
    });

    it("reports a store failure as a failed delete", async () => {
      const { host, ports, posted } = setupHost();
      (ports.store as unknown as { deleteAnnotation: () => Promise<never> }).deleteAnnotation = async () => { throw new Error("disk full"); };
      await host.handle({ command: "deleteAnnotation", id: "a" });
      expect(ports.notify).toHaveBeenCalledWith("Failed to delete annotation: disk full", "error");
      expect(posted).toHaveLength(0);
    });
  });

  describe("saveReadingState", () => {
    it("saves a normalized reading state without reporting a change, and drops a corrupt one", async () => {
      const { host, files, changes } = setupHost();
      await host.handle({
        command: "saveReadingState",
        state: { page: 3, scaleValue: "1.25", top: 120, sidebar: { open: true, tab: "outline", width: 9999 }, updatedAt: "t" },
      });
      expect(JSON.parse(files.p1!).reading).toMatchObject({ page: 3, scaleValue: "1.25", top: 120, sidebar: { open: true, tab: "outline", width: 480 } });
      await host.handle({ command: "saveReadingState", state: { page: -1 } });
      expect(JSON.parse(files.p1!).reading.page).toBe(3);
      expect(changes).toHaveLength(0);
    });
  });
});
