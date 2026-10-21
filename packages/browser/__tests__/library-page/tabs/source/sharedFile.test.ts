// How a source tab opens a shared file while another tab of the profile runs the share.
import type { ILogger, ProjectEntry } from "@labshelf/core";
import type { PageSharing } from "../../../../src/library-page/editor/collab";
import { sourceFileMode } from "../../../../src/library-page/tabs/source/sharedFile";

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
});
