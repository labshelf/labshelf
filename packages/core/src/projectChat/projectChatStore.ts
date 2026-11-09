// Reads and changes the chat of a writing project (<project>/.labshelf/chat.qmd): one item per message, added by anyone with write
// access, edited or removed only by its author, one serial load-modify-save per project.
// CONTRACT: documents/contracts/qmd-items.md#project-chat
import { KeyedQueue } from "../async/index.js";
import { PROJECT_CHAT_PATH } from "../collab/sharedFiles.js";
import { formatError } from "../errors/index.js";
import type { IFileSystem, ILogger } from "../ports/index.js";
import { addItem, newItemId, parseItemFile, removeItem, serializeItemFile, type ItemFile } from "../qmd/item/index.js";
import { countUnread, toMessageItems, withEditedMessage } from "../spaces/spaceDiscussionsStore.js";
import type { ProjectChatMessage } from "./projectChatSource.js";

export interface ProjectChatStoreContext {
  readonly fs: Pick<IFileSystem, "exists" | "readText" | "writeText" | "ensureDir">;
  readonly logger: ILogger;
  /** The ISO time stamped as `created` on a new message. */
  readonly now: () => string;
}

export interface ProjectChatStore {
  /** The messages oldest first, in file order; [] when the file does not exist. */
  read(projectDir: string): Promise<ProjectChatMessage[]>;
  /** Appends a message by `author`, creating `.labshelf/` and the file when missing. @returns the new message id. */
  add(projectDir: string, body: string, author: string): Promise<string>;
  /** Replaces the body and stamps `edited`. Rejects, writing nothing, when no message has the id or `author` did not write it. */
  edit(projectDir: string, id: string, body: string, author: string, editedAt: string): Promise<void>;
  /** Rejects, writing nothing, when no message has the id or `author` did not write it. */
  remove(projectDir: string, id: string, author: string): Promise<void>;
  /** Calls `listener` with the project folder after each write of this store; returns the unsubscribe. */
  onChange(listener: (projectDir: string) => void): () => void;
}

const LOG_MODULE = "projectChat/store";

/** The chat file of a project folder, with the folder's own separator. */
export function projectChatFilePath(projectDir: string): string {
  const separator = projectDir.includes("\\") && !projectDir.includes("/") ? "\\" : "/";
  return `${projectDir.replace(/[\\/]+$/, "")}${separator}${PROJECT_CHAT_PATH.split("/").join(separator)}`;
}

const toolDirOf = (file: string): string => file.replace(/[\\/][^\\/]+$/, "");

function ownedBy(file: ItemFile, id: string, author: string): ItemFile {
  const message = toMessageItems(file).find((item) => item.id === id);
  if (!message) { throw new Error(`No chat message has the id ${id}.`); }
  if (message.author !== author) { throw new Error("Only the author of a message can change it."); }
  return file;
}

/** The body without the line ending the item file closes it with, so a message reads back as it was sent. */
const toChatMessage = (item: ReturnType<typeof toMessageItems>[number]): ProjectChatMessage => ({
  id: item.id, author: item.author ?? "", created: item.created ?? "", body: item.body.replace(/\r?\n$/, ""),
  ...(item.edited === undefined ? {} : { edited: item.edited }),
});

export function createProjectChatStore(ctx: ProjectChatStoreContext): ProjectChatStore {
  const queue = new KeyedQueue();
  const listeners = new Set<(projectDir: string) => void>();

  const readFile = async (file: string): Promise<ItemFile> => parseItemFile((await ctx.fs.exists(file)) ? await ctx.fs.readText(file) : "");

  /** Re-reads the file inside the project's queue, applies `change` and writes the result. */
  const change = <T>(projectDir: string, apply: (file: ItemFile) => { file: ItemFile; result: T }): Promise<T> => {
    const file = projectChatFilePath(projectDir);
    return queue.run(file, async () => {
      const { file: next, result } = apply(await readFile(file));
      try {
        await ctx.fs.ensureDir(toolDirOf(file));
        await ctx.fs.writeText(file, serializeItemFile(next));
      } catch (error) {
        await ctx.logger.log("ERROR", LOG_MODULE, "Writing the project chat failed", { path: file, error: formatError(error) });
        throw error;
      }
      listeners.forEach((listener) => listener(projectDir));
      return result;
    });
  };

  return {
    async read(projectDir) { return toMessageItems(await readFile(projectChatFilePath(projectDir))).map(toChatMessage); },
    add: (projectDir, body, author) => change(projectDir, (file) => {
      const id = newItemId();
      return { file: addItem(file, { id, body, created: ctx.now(), author }), result: id };
    }),
    edit: (projectDir, id, body, author, editedAt) =>
      change(projectDir, (file) => withEditedMessage(ownedBy(file, id, author), id, body, { edited: editedAt })),
    remove: (projectDir, id, author) =>
      change(projectDir, (file) => ({ file: removeItem(ownedBy(file, id, author), id), result: undefined })),
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** When the user last opened each project's chat on this device, by a project key the host chooses (D5). */
export type ProjectChatSeen = Readonly<Record<string, string>>;

/** Messages by others created after `seenAt`; every message by others when the chat was never opened here. */
export function countProjectChatUnread(messages: readonly Pick<ProjectChatMessage, "author" | "created">[], author: string, seenAt: string | undefined): number {
  return countUnread(messages, PROJECT_CHAT_PATH, { author, seen: seenAt === undefined ? [] : [{ path: PROJECT_CHAT_PATH, by: author, at: seenAt }] });
}

/** The seen map with `projectKey` opened at `at`; an earlier `at` never moves it back. */
export function markProjectChatSeen(seen: ProjectChatSeen, projectKey: string, at: string): ProjectChatSeen {
  const known = seen[projectKey];
  return known !== undefined && Date.parse(known) >= Date.parse(at) ? seen : { ...seen, [projectKey]: at };
}
