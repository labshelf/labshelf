// Finds a ready project by id: the open one, else the library folder's.
import type { ILogger, LibraryFileSystem, ProjectEntry } from "@labshelf/core";
import { createBrowserProjectContent } from "./browserProjectLibrary";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

const isProject = (entry: ProjectEntry | undefined, projectId: string): entry is ReadyProject =>
  entry?.kind === "ready" && entry.settings.id === projectId;

/** The open project is the usual answer; a tab restored after a reload finds its project in the library folder. */
export async function findProject(fs: LibraryFileSystem, logger: ILogger, open: ProjectEntry | undefined, projectId: string): Promise<ReadyProject> {
  if (isProject(open, projectId)) return open;
  const entries = await createBrowserProjectContent({ fs, logger }).listProjects("");
  const entry = entries.find((candidate) => isProject(candidate, projectId));
  if (!entry) throw new Error(`Project ${projectId} is not in the library folder`);
  return entry;
}
