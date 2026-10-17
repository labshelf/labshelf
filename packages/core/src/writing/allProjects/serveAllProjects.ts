// Serves the All projects page from a host's project library: posts the rows and runs the page's actions.
import type { ILogger } from "../../ports/index.js";
import type { AllProjectsEndpoint, AllProjectsToHost } from "./protocol/index.js";
import type { ProjectLibraryPort } from "./projectLibraryPort.js";

const MODULE = "allProjects";

const ACTION_LABELS: Record<AllProjectsToHost["type"], string> = {
  ready: "Loading projects",
  open: "Open",
  create: "Create",
  rename: "Rename",
  duplicate: "Duplicate",
  move: "Move",
  archive: "Archive",
  trash: "Move to trash",
  deleteForever: "Delete forever",
  emptyTrash: "Empty trash",
  command: "Command",
  files: "List files",
  openFile: "Open file",
};

function run(port: ProjectLibraryPort, message: Exclude<AllProjectsToHost, { type: "files" }>): Promise<void> {
  switch (message.type) {
    case "ready": return Promise.resolve();
    case "open": return port.open(message.id);
    case "create": return port.create(message.kind);
    case "rename": return port.rename(message.id, message.title);
    case "duplicate": return port.duplicate(message.id, message.title);
    case "move": return port.move(message.id, message.folder);
    case "archive": return port.setArchived(message.id, message.archived);
    case "trash": return port.setTrashed(message.id, message.trashed);
    case "deleteForever": return port.deleteForever(message.id);
    case "emptyTrash": return emptyTrash(port);
    case "command": return port.runCommand(message.id, message.command);
    case "openFile": return port.openFile(message.id, message.path);
  }
}

async function emptyTrash(port: ProjectLibraryPort): Promise<void> {
  const rows = await port.list();
  await Promise.all(rows.filter((row) => row.place === "trash").map((row) => port.deleteForever(row.id)));
}

/** Returns the function that stops serving. */
export function serveAllProjects(endpoint: AllProjectsEndpoint, port: ProjectLibraryPort, logger: ILogger): () => void {
  let ready = false;

  const logFailure = (action: string, error: unknown, context: Record<string, unknown>): string => {
    const reason = error instanceof Error ? error.message : String(error);
    void logger.log("ERROR", MODULE, `${action} failed`, { ...context, error: reason });
    return reason;
  };
  const fail = (action: string, error: unknown, context: Record<string, unknown>): void => {
    endpoint.post({ type: "error", message: `${action} failed: ${logFailure(action, error, context)}` });
  };
  // The page shows a listing failure inside the expanded row, so it gets no toast.
  const postFiles = async (id: string): Promise<void> => {
    try {
      endpoint.post({ type: "files", id, files: await port.files(id) });
    } catch (error) {
      endpoint.post({ type: "files", id, error: logFailure(ACTION_LABELS.files, error, { type: "files", id }) });
    }
  };

  const post = async (): Promise<void> => {
    if (!ready) { return; }
    try {
      endpoint.post({ type: "projects", rows: await port.list(), commands: port.commands() });
    } catch (error) {
      fail(ACTION_LABELS.ready, error, { type: "projects" });
    }
  };

  const stopMessages = endpoint.subscribe((message) => {
    if (message.type === "ready") { ready = true; void post(); return; }
    if (message.type === "files") { void postFiles(message.id); return; }
    const context = { type: message.type, id: "id" in message ? message.id : undefined };
    run(port, message).catch((error: unknown) => fail(ACTION_LABELS[message.type], error, context));
  });
  const stopChanges = port.onDidChange(() => { void post(); });
  return () => { stopMessages(); stopChanges(); };
}
