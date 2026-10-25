// Pins read-only access until a shared file has a text index entry.
import * as Y from "yjs";
import { indexFiles, type ILogger, type ProjectEntry } from "@labshelf/core";
import type { PageSharing } from "../../../src/collab";
import { sourceFileMode } from "../../../src/libraryUi/editorArea/sourceTab";

const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) } as unknown as ILogger;
const entry = { kind: "ready", folder: "projects/demo", settings: { id: "demo", shared: "s1" } } as unknown as ProjectEntry;

function sharing(state: "observer" | undefined): Pick<PageSharing, "liveShare" | "shares"> {
  return {
    liveShare: async () => undefined,
    shares: { state: () => (state ? { kind: state } : undefined), name: () => "Ada" },
  } as unknown as Pick<PageSharing, "liveShare" | "shares">;
}

describe("sourceFileMode", () => {
  it("opens the file as observing the share when another tab of the profile runs it", async () => {
    expect(await sourceFileMode(sharing("observer"), entry, "main.tex", logger, false)).toEqual({ kind: "observing", shareId: "s1" });
  });

  it("opens the file unresolved when no tab runs the share", async () => {
    expect(await sourceFileMode(sharing(undefined), entry, "main.tex", logger, false)).toEqual({ kind: "unresolved" });
  });

  it("keeps an orphan document read-only until its index entry arrives", async () => {
    const index = new Y.Doc();
    const doc = new Y.Doc();
    const openDoc = jest.fn(() => doc);
    const connected = {
      ...sharing(undefined), liveShare: async () => ({ session: { index, openDoc }, presence: {} }),
    } as unknown as Pick<PageSharing, "liveShare" | "shares">;
    expect(await sourceFileMode(connected, entry, "main.tex", logger, false)).toEqual({ kind: "unresolved" });
    expect(openDoc).not.toHaveBeenCalled();
    indexFiles(index).set("main.tex", { kind: "text" });
    expect((await sourceFileMode(connected, entry, "main.tex", logger, true)).kind).toBe("shared");
    expect(openDoc).toHaveBeenCalledWith("main.tex");
    doc.destroy(); index.destroy();
  });
});
