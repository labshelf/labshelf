// The reader page's "Send to…": picks a project note (or a new one) at the selection bubble and appends the quoted passage with its page link.
import {
  createProjectNoteWriter, createProjectNotesStore, createRecentTargets, deriveSendTargetChoices, sendTo,
  type ILogger, type LibraryFileSystem, type ProjectEntry, type ProjectNotesStore, type SendTarget, type SendTargetChoice,
} from "@labshelf/core";
import { QMD_VOCABULARY, askInputBox, showMenu, showToast, type MenuEntry } from "@labshelf/core/dom";
import { createProjectAssetWriter, createProjectNoteFiles, createRecentSendTargetsStore } from "../../storage";
import { createBrowserProjectContent } from "../../writing";

export type SendToNoteRequest = { key: string; page: number; text: string };
type ProjectNoteTarget = Extract<SendTarget, { kind: "projectNote" }>;
type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

const RECENT_KEY = "sendTo.recent";
const SEPARATOR_AFTER_RECENT = "separator" as const;

async function listReady(fs: LibraryFileSystem, logger: ILogger): Promise<ReadyProject[]> {
  const entries = await createBrowserProjectContent({ fs, logger }).listProjects("");
  return entries.filter((entry): entry is ReadyProject => entry.kind === "ready");
}

// INVARIANT: the menu has no pointer to open at once the bubble hides, so it opens where the user last pressed.
function trackPointer(): () => { x: number; y: number } {
  let at = { x: window.innerWidth / 2, y: window.innerHeight / 3 };
  document.addEventListener("pointerdown", (e) => { at = { x: e.clientX, y: e.clientY }; }, true);
  return () => at;
}

function menuEntries(choices: readonly SendTargetChoice[], pick: (choice: SendTargetChoice) => void): MenuEntry[] {
  const entries: MenuEntry[] = [];
  const isRecent = (choice: SendTargetChoice): boolean => choice.kind === "target" && choice.recent;
  const item = (choice: SendTargetChoice): MenuEntry => ({
    label: choice.label,
    hint: choice.description,
    ...(choice.kind === "newNote" ? { icon: "plus" as const } : {}),
    onSelect: () => pick(choice),
  });
  const recent = choices.filter(isRecent);
  entries.push(...recent.map(item));
  const rest = choices.filter((choice) => !isRecent(choice));
  if (recent.length > 0 && rest.length > 0) entries.push(SEPARATOR_AFTER_RECENT);
  entries.push(...rest.map(item));
  return entries;
}

/** Resolves with the picked choice, or undefined when the menu closes without a pick (Escape, outside click). */
function chooseTarget(at: { x: number; y: number }, choices: readonly SendTargetChoice[]): Promise<SendTargetChoice | undefined> {
  return new Promise((resolve) => {
    // The menu closes before the item's onSelect runs, so a pick settles first.
    showMenu(at, menuEntries(choices, resolve), { onClose: () => { setTimeout(() => resolve(undefined), 0); } });
  });
}

/** The notes store over the library's projects, and the send function that appends to its notes. */
function openProjectNotes(fs: LibraryFileSystem, logger: ILogger): { notes: ProjectNotesStore; send: ReturnType<typeof sendTo> } {
  const folders = new Map<string, string>();
  const folderOf = async (projectId: string): Promise<string> => {
    let folder = folders.get(projectId);
    if (folder === undefined) {
      for (const project of await listReady(fs, logger)) folders.set(project.settings.id, project.folder);
      folder = folders.get(projectId);
    }
    if (folder === undefined) throw new Error(`Project ${projectId} is not in the library folder`);
    return folder;
  };
  const notes = createProjectNotesStore(createProjectNoteFiles(fs, folderOf), logger);
  const send = sendTo(
    { projectNote: createProjectNoteWriter(notes, createProjectAssetWriter(fs, folderOf)) },
    { logger, newItemId: () => crypto.randomUUID() },
  );
  return { notes, send };
}

/** The note a pick stands for: the picked note, or a new note whose title the user types; undefined on a cancel. */
async function resolveTarget(notes: ProjectNotesStore, choice: SendTargetChoice): Promise<ProjectNoteTarget | undefined> {
  if (choice.kind === "target") return choice.target.kind === "projectNote" ? choice.target : undefined;
  const title = await askInputBox({
    title: `New ${QMD_VOCABULARY.item}`, prompt: `${QMD_VOCABULARY.item[0]!.toUpperCase()}${QMD_VOCABULARY.item.slice(1)} title`,
    validate: (value) => (value.trim() === "" ? "Enter a title." : undefined),
  });
  if (!title) return undefined;
  return { kind: "projectNote", projectId: choice.projectId, path: await notes.create(choice.projectId, title) };
}

/**
 * @returns the reader's sendToNote port over the library's projects, or undefined when the library holds no project.
 * Errors propagate so the reader host notifies "Failed to send: …"; a cancel at any step sends nothing.
 */
export async function createReaderSendToNote(
  fs: LibraryFileSystem,
  logger: ILogger,
): Promise<((request: SendToNoteRequest) => Promise<void>) | undefined> {
  if ((await listReady(fs, logger)).length === 0) return undefined;

  const { notes, send } = openProjectNotes(fs, logger);
  const recent = createRecentTargets(createRecentSendTargetsStore(), RECENT_KEY);
  const pointer = trackPointer();

  return async ({ key, page, text }) => {
    const ready = await listReady(fs, logger);
    if (ready.length === 0) { showToast("Send to is not available here", "info"); return; }
    const projects = await Promise.all(ready.map(async (project) => ({
      projectId: project.settings.id,
      name: project.settings.title ?? project.settings.id,
      notes: await notes.list(project.settings.id),
    })));
    const picked = await chooseTarget(pointer(), deriveSendTargetChoices(await recent.list(), projects));
    if (!picked) return;
    const target = await resolveTarget(notes, picked);
    if (!target) return;
    await send({ target, payload: { kind: "quote", key, page, text } });
    await recent.push(target);
    const title = (await notes.list(target.projectId)).find((note) => note.path === target.path)?.title ?? target.path;
    showToast(`Sent to ${title}`, "ok");
  };
}
