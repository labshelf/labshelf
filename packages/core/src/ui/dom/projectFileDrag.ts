// Files dragged onto a drop target that takes them (the compiled deck workspace): LabShelf's own project-file payload, which the browser's
// project file tree sets, and the uri lists VS Code's Explorer and the system give. The drop targets share the reading and the accept test.

export const PROJECT_FILE_DRAG_MIME = "application/x-labshelf-project-file";
/** VS Code's Explorer and the system file managers give dragged files as uri lists, one uri per line. */
const URI_LIST_MIMES = ["application/vnd.code.uri-list", "text/uri-list"] as const;

/** A file of a project: the host's project key and the project-relative "/" path. */
export interface ProjectFileRef { projectId: string; path: string }

/** What a file drop carries: uris from a uri list and the LabShelf project files, both as given. */
export interface FileDrop { uris: string[]; files: ProjectFileRef[] }

export function projectFileDragPayload(file: ProjectFileRef): string {
  return JSON.stringify({ projectId: file.projectId, path: file.path });
}

const isRef = (value: unknown): value is ProjectFileRef => typeof value === "object" && value !== null
  && typeof (value as ProjectFileRef).projectId === "string" && typeof (value as ProjectFileRef).path === "string" && (value as ProjectFileRef).path !== "";

/** The project files of a payload: one object or a list of them; anything malformed gives none. */
export function parseProjectFileDragPayload(raw: string): ProjectFileRef[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  const list = Array.isArray(value) ? value : [value];
  return list.filter(isRef).map(({ projectId, path }) => ({ projectId, path }));
}

/** The uris of a uri list: one per line, blank lines and '#' comments skipped. */
function parseUriList(raw: string): string[] {
  return raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
}

/** Whether a drag's types hold a project file or a uri list. */
export function acceptsFileDrop(types: Iterable<string> | ArrayLike<string> | null | undefined): boolean {
  if (!types) return false;
  const list = Array.from(types as ArrayLike<string>);
  return list.includes(PROJECT_FILE_DRAG_MIME) || URI_LIST_MIMES.some((mime) => list.includes(mime));
}

/** The files a drop carries; the first uri list type that has lines gives the uris. */
export function readFileDrop(transfer: Pick<DataTransfer, "getData" | "types"> | null | undefined): FileDrop {
  if (!transfer) return { uris: [], files: [] };
  const types = Array.from(transfer.types ?? []);
  let uris: string[] = [];
  for (const mime of URI_LIST_MIMES) {
    if (!types.includes(mime)) continue;
    uris = parseUriList(transfer.getData(mime));
    if (uris.length) break;
  }
  const files = types.includes(PROJECT_FILE_DRAG_MIME) ? parseProjectFileDragPayload(transfer.getData(PROJECT_FILE_DRAG_MIME)) : [];
  return { uris, files };
}

/** Starts a drag of one project file: the LabShelf payload, and its path as plain text. */
export function startProjectFileDrag(event: DragEvent, file: ProjectFileRef): void {
  const transfer = event.dataTransfer;
  if (!transfer) return;
  transfer.setData(PROJECT_FILE_DRAG_MIME, projectFileDragPayload(file));
  transfer.setData("text/plain", file.path);
  transfer.effectAllowed = "copy";
}

/**
 * Makes `el` take file drops: a drag that carries files is accepted (preventDefault, dropEffect copy, `is-drop-target` on `el`) and its drop
 * goes to `onDrop` with the event. Without `onDrop` nothing is bound and no drop is accepted.
 */
export function attachFileDrop(el: HTMLElement, onDrop: ((drop: FileDrop, event: DragEvent) => void) | undefined): void {
  if (!onDrop) return;
  const clear = (): void => { el.classList.remove("is-drop-target"); };
  el.addEventListener("dragover", (event) => {
    if (!acceptsFileDrop(event.dataTransfer?.types)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    el.classList.add("is-drop-target");
  });
  el.addEventListener("dragleave", clear);
  el.addEventListener("drop", (event) => {
    clear();
    if (!acceptsFileDrop(event.dataTransfer?.types)) return;
    event.preventDefault();
    event.stopPropagation();
    onDrop(readFileDrop(event.dataTransfer), event);
  });
}
