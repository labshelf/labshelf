// Lists, creates, reads and edits the discussion threads of a Space (spaces/<id>/discussions/<slug>.qmd): a topic item, then one item per message.
// CONTRACT: documents/contracts/qmd-items.md#items
import {
  extractLineContent,
  formatDivOpener,
  parseDivOpener,
  type ItemFile,
  type ItemSegment,
} from "../qmd/item/index.js";
import {
  DISCUSSIONS_DIR,
  changeItemFile,
  createItemFile,
  listQmdNames,
  readItemFile,
  titleOfItemFile,
  toQmdItems,
  updatedOf,
  withEditedItem,
  withNewItem,
  withRemovedItem,
  type SpaceQmdItem,
  type StoreContext,
} from "./spaceNotesStore.js";

export type ThreadStatus = "open" | "resolved";

export interface SpaceThreadEntry { path: string; title: string; status: ThreadStatus; messages: number; updated: string }

export interface SpaceDiscussionsStore {
  list(spaceId: string): Promise<SpaceThreadEntry[]>;
  /** @returns the path of the new thread file, relative to the Space folder. The topic is `# title` plus `body`, open. */
  create(spaceId: string, title: string, body: string, author?: string): Promise<string>;
  /** @returns the topic, then the messages, in file order; [] when the file does not exist. */
  read(spaceId: string, path: string): Promise<SpaceQmdItem[]>;
  /** @returns the message id: `id` when given, else a new one. */
  addMessage(spaceId: string, path: string, body: string, author?: string, id?: string): Promise<string>;
  /** Rejects, writing nothing, when no item has the id. */
  editMessage(spaceId: string, path: string, id: string, body: string): Promise<void>;
  /** Rejects, writing nothing, when no item has the id. */
  removeMessage(spaceId: string, path: string, id: string): Promise<void>;
  /** Changes only the `status` value of the topic item. Rejects when the file has no item. */
  setStatus(spaceId: string, path: string, status: ThreadStatus): Promise<void>;
}

const STATUS_ATTRIBUTE = "status";
// A `status` attribute with its value, preceded by the space that separates it from the token before.
const STATUS_TOKEN = /(\sstatus=)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s{}"']+)/;

function statusOf(topic: ItemSegment | undefined): ThreadStatus {
  const value = topic?.attrs.find(([key]) => key === STATUS_ATTRIBUTE)?.[1];
  return value === "resolved" ? "resolved" : "open";
}

function firstItem(file: ItemFile): ItemSegment | undefined {
  return file.segments.find((segment): segment is ItemSegment => segment.kind === "item");
}

/** The topic item with `status` set: only the value changes when the opening line reads back unchanged, else the attribute is replaced in place. */
function withStatus(segment: ItemSegment, status: ThreadStatus): ItemSegment {
  const lineEnd = /(?:\r\n|\n|\r)$/.exec(segment.fence)?.[0] ?? "";
  const content = extractLineContent(segment.fence);
  const parsed = parseDivOpener(content);
  const has = segment.attrs.some(([key]) => key === STATUS_ATTRIBUTE);
  const attrs: (readonly [string, string])[] = has
    ? segment.attrs.map(([key, value]) => (key === STATUS_ATTRIBUTE ? [key, status] as const : [key, value] as const))
    : [...segment.attrs, [STATUS_ATTRIBUTE, status] as const];
  let fence: string;
  if (parsed && formatDivOpener(parsed) === content) {
    fence = formatDivOpener({ ...parsed, pairs: attrs }) + lineEnd;
  } else if (has) {
    fence = content.replace(STATUS_TOKEN, `$1"${status}"`) + lineEnd;
  } else {
    throw new Error(`Item ${segment.id}: the opening line cannot take a status attribute`);
  }
  return { ...segment, attrs, fence };
}

function withTopicStatus(file: ItemFile, status: ThreadStatus): { file: ItemFile; result: undefined } {
  const topic = firstItem(file);
  if (!topic) { throw new Error("The thread has no topic item."); }
  const next = withStatus(topic, status);
  return { file: { segments: file.segments.map((segment) => (segment === topic ? next : segment)) }, result: undefined };
}

export function createSpaceDiscussionsStore(ctx: StoreContext): SpaceDiscussionsStore {
  return {
    async list(spaceId) {
      const names = await listQmdNames(ctx, spaceId, DISCUSSIONS_DIR);
      return Promise.all(names.map(async (name) => {
        const path = `${DISCUSSIONS_DIR}/${name}`;
        const file = await readItemFile(ctx, spaceId, DISCUSSIONS_DIR, path);
        const items = file.segments.filter((segment) => segment.kind === "item");
        return {
          path,
          title: titleOfItemFile(file, path),
          status: statusOf(firstItem(file)),
          messages: Math.max(items.length - 1, 0),
          updated: await updatedOf(ctx, spaceId, DISCUSSIONS_DIR, name),
        };
      }));
    },
    create: (spaceId, title, body, author) => createItemFile(ctx, spaceId, DISCUSSIONS_DIR, title, (empty) => {
      const topic = withNewItem(ctx, empty, body === "" ? `# ${title}\n` : `# ${title}\n\n${body}`, author).file;
      return withTopicStatus(topic, "open").file;
    }),
    async read(spaceId, path) { return toQmdItems(await readItemFile(ctx, spaceId, DISCUSSIONS_DIR, path)); },
    addMessage: (spaceId, path, body, author, id) =>
      changeItemFile(ctx, spaceId, DISCUSSIONS_DIR, path, (file) => withNewItem(ctx, file, body, author, id)),
    editMessage: (spaceId, path, id, body) => changeItemFile(ctx, spaceId, DISCUSSIONS_DIR, path, (file) => withEditedItem(file, id, body)),
    removeMessage: (spaceId, path, id) => changeItemFile(ctx, spaceId, DISCUSSIONS_DIR, path, (file) => withRemovedItem(file, id)),
    setStatus: (spaceId, path, status) => changeItemFile(ctx, spaceId, DISCUSSIONS_DIR, path, (file) => withTopicStatus(file, status)),
  };
}
