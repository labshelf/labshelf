// Parses a labshelf-project: URI into the library root, a project, or a file inside a project.
import { ProjectFileSystemError } from "./fileSystemError";
import type { ProjectUri } from "./types";

export const PROJECT_SCHEME = "labshelf-project";

export type ParsedProjectUri =
  | { kind: "root" }
  | { kind: "project"; projectId: string }
  | { kind: "path"; projectId: string; segments: string[]; path: string };

/** The URI path is `/<projectId>/<relative path>`; the store validates the relative path itself. */
export function parseProjectUri(uri: ProjectUri): ParsedProjectUri {
  if (uri.scheme !== PROJECT_SCHEME) {
    throw new ProjectFileSystemError("Unavailable", `Not a ${PROJECT_SCHEME}: URI: ${uri.scheme}:${uri.path}`);
  }
  const [projectId, ...segments] = uri.path.split("/").filter((segment) => segment !== "");
  if (projectId === undefined) return { kind: "root" };
  if (segments.length === 0) return { kind: "project", projectId };
  return { kind: "path", projectId, segments, path: segments.join("/") };
}
