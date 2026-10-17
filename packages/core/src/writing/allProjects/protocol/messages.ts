// Declares the messages between the All projects page and its host, and the channel that carries them.
import type { MessageEnd } from "../../../library-ui/protocol/index.js";
import type { NewProjectKind, ProjectMenuCommand, ProjectRow } from "../projectRow.js";

export type AllProjectsToHost =
  | { type: "ready" }
  | { type: "open"; id: string }
  | { type: "create"; kind: NewProjectKind }
  | { type: "rename"; id: string; title: string }
  | { type: "duplicate"; id: string; title: string }
  /** `folder` is "/"-joined; absent moves the project to the top level. */
  | { type: "move"; id: string; folder?: string }
  | { type: "archive"; id: string; archived: boolean }
  | { type: "trash"; id: string; trashed: boolean }
  | { type: "deleteForever"; id: string }
  | { type: "emptyTrash" }
  /** Runs one of the host's own `commands` on the project. */
  | { type: "command"; id: string; command: string }
  /** Asks for the project's file listing each time its row expands. */
  | { type: "files"; id: string }
  /** `path` is one of the listed files: relative and "/"-separated. */
  | { type: "openFile"; id: string; path: string };

export type HostToAllProjects =
  | { type: "projects"; rows: ProjectRow[]; commands: ProjectMenuCommand[] }
  | { type: "error"; message: string }
  | { type: "files"; id: string; files: string[] }
  | { type: "files"; id: string; error: string };

/** The page side of the channel. */
export type AllProjectsTransport = MessageEnd<AllProjectsToHost, HostToAllProjects>;

/** The host side of the channel. */
export type AllProjectsEndpoint = MessageEnd<HostToAllProjects, AllProjectsToHost>;
