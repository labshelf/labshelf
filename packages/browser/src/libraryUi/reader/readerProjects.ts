// The library's ready projects, which the reader page's cite popup lists.
import type { ILogger, LibraryFileSystem, ProjectEntry } from "@labshelf/core";
import { createBrowserProjectContent } from "../../writing";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

export async function listReady(fs: LibraryFileSystem, logger: ILogger): Promise<ReadyProject[]> {
  const entries = await createBrowserProjectContent({ fs, logger }).listProjects("");
  return entries.filter((entry): entry is ReadyProject => entry.kind === "ready");
}
