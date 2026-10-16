// Tests the preview store: reading position and theme persist for the panel's life, annotation writes are refused with a notice.
import { createPreviewStore, PREVIEW_ANNOTATION_REFUSAL } from "../../../src/writing/preview/previewStore";

describe("createPreviewStore", () => {
  it("keeps the reading position and theme", async () => {
    const store = createPreviewStore();
    await store.setTheme("preview:p", "sepia");
    await store.setReadingState("preview:p", { page: 3, scaleValue: "1.25", updatedAt: "2026-10-15T00:00:00.000Z" });
    const data = await store.load("preview:p");
    expect(data.theme).toBe("sepia");
    expect(data.reading).toMatchObject({ page: 3 });
  });

  it.each([
    ["addHighlight", (s: ReturnType<typeof createPreviewStore>) => s.addHighlight("preview:p", 1, "text", "yellow")],
    ["addNote", (s: ReturnType<typeof createPreviewStore>) => s.addNote("preview:p", 1, "note")],
    ["updateAnnotation", (s: ReturnType<typeof createPreviewStore>) => s.updateAnnotation("preview:p", "a", "text")],
    ["deleteAnnotation", (s: ReturnType<typeof createPreviewStore>) => s.deleteAnnotation("preview:p", "a")],
  ])("rejects %s and stores nothing", async (_name, write) => {
    const store = createPreviewStore();
    await expect(write(store)).rejects.toThrow(PREVIEW_ANNOTATION_REFUSAL);
    expect(await store.getAnnotations("preview:p")).toEqual([]);
  });
});
