// Lists, creates, reads, edits and searches the discussion threads of a Space (spaces/<id>/discussions/<slug>.qmd): a topic item, then one item
// per message; the Space chat (discussions/_chat.qmd) has no topic item, every item is a message.
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
import type { SpaceSeen } from "./space.js";
import { replaceMath } from "./discussionText.js";

export type ThreadStatus = "open" | "resolved";

/** A message as read back: `edited` is when its author last edited it from the page, an ISO time. */
export interface SpaceMessageItem extends SpaceQmdItem { edited?: string }
/** What an edit stamps on the item: `edited` for an edit by its author, nothing for a cell output write. */
export interface MessageStamp { readonly edited?: string }

/** The Space chat everyone in the Space shares; slugs are [a-z0-9-], so no topic ever takes this name. */
export const SPACE_CHAT_PATH = `${DISCUSSIONS_DIR}/_chat.qmd`;
const SPACE_CHAT_TITLE = "Space chat";
/** The most hits one search returns. */
const DISCUSSION_SEARCH_LIMIT = 50;
/** How many characters of context a hit's excerpt keeps on each side of the match. */
const EXCERPT_CONTEXT = 60;

/** How many characters of the last message a listed thread carries for its preview. */
const LAST_BODY_LIMIT = 2000;

/** `last` is the file's last item, its body cut to LAST_BODY_LIMIT characters; `unread` is set only when list() has a reader. */
export interface SpaceThreadEntry {
  path: string; title: string; status: ThreadStatus; messages: number; updated: string;
  last?: { body: string; author?: string; created?: string };
  unread?: number;
}

/** Who lists the threads, with the conversations they have opened (space.json `seen`). */
export interface ThreadReader { readonly author: string; readonly seen: readonly Pick<SpaceSeen, "path" | "by" | "at">[] }

/** One message or topic whose text holds the query. */
export interface DiscussionSearchHit { path: string; itemId: string; title: string; excerpt: string; author?: string; created?: string }

export interface SpaceDiscussionsStore {
  /** With `reader`, each entry carries `unread` for that author. */
  list(spaceId: string, reader?: ThreadReader): Promise<SpaceThreadEntry[]>;
  /** @returns the path of the new thread file, relative to the Space folder. The topic is `# title` plus `body`, open. */
  create(spaceId: string, title: string, body: string, author?: string): Promise<string>;
  /** @returns the topic, then the messages, in file order, with `edited` when set; [] when the file does not exist. */
  read(spaceId: string, path: string): Promise<SpaceMessageItem[]>;
  /** @returns the message id: `id` when given, else a new one. */
  addMessage(spaceId: string, path: string, body: string, author?: string, id?: string): Promise<string>;
  /** Rejects, writing nothing, when no item has the id. `stamp.edited` is written as the item's `edited` attribute. */
  editMessage(spaceId: string, path: string, id: string, body: string, stamp?: MessageStamp): Promise<void>;
  /** Rejects, writing nothing, when no item has the id. */
  removeMessage(spaceId: string, path: string, id: string): Promise<void>;
  /** Changes only the `status` value of the topic item. Rejects when the file has no item. */
  setStatus(spaceId: string, path: string, status: ThreadStatus): Promise<void>;
  /** Items of every thread and the chat whose body, or whose thread title for the topic item, holds `query` case-insensitively; at most `limit`. */
  search(spaceId: string, query: string, limit?: number): Promise<DiscussionSearchHit[]>;
}

const STATUS_ATTRIBUTE = "status";
const EDITED_ATTRIBUTE = "edited";
// An attribute `key` with its value, preceded by the space that separates it from the token before.
const attributeToken = (key: string): RegExp => new RegExp(`(\\s${key}=)(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[^\\s{}"']+)`);

function statusOf(topic: ItemSegment | undefined): ThreadStatus {
  const value = topic?.attrs.find(([key]) => key === STATUS_ATTRIBUTE)?.[1];
  return value === "resolved" ? "resolved" : "open";
}

function firstItem(file: ItemFile): ItemSegment | undefined {
  return file.segments.find((segment): segment is ItemSegment => segment.kind === "item");
}

/** The item with attribute `name` set to `value`: only the value changes when the opening line reads back unchanged, else the attribute is replaced in place. */
function withAttribute(segment: ItemSegment, name: string, value: string): ItemSegment {
  const lineEnd = /(?:\r\n|\n|\r)$/.exec(segment.fence)?.[0] ?? "";
  const content = extractLineContent(segment.fence);
  const parsed = parseDivOpener(content);
  const has = segment.attrs.some(([key]) => key === name);
  const attrs: (readonly [string, string])[] = has
    ? segment.attrs.map(([key, old]) => (key === name ? [key, value] as const : [key, old] as const))
    : [...segment.attrs, [name, value] as const];
  let fence: string;
  if (parsed && formatDivOpener(parsed) === content) {
    fence = formatDivOpener({ ...parsed, pairs: attrs }) + lineEnd;
  } else if (has) {
    fence = content.replace(attributeToken(name), `$1"${value}"`) + lineEnd;
  } else {
    throw new Error(`Item ${segment.id}: the opening line cannot take a ${name} attribute`);
  }
  return { ...segment, attrs, fence };
}

/** Sets the body of item `id`, and its `edited` attribute when the stamp has one. */
export function withEditedMessage(file: ItemFile, id: string, body: string, stamp: MessageStamp | undefined): { file: ItemFile; result: undefined } {
  const next = withEditedItem(file, id, body).file;
  const edited = stamp?.edited;
  if (edited === undefined) { return { file: next, result: undefined }; }
  return { file: { segments: next.segments.map((segment) => (segment.kind === "item" && segment.id === id ? withAttribute(segment, EDITED_ATTRIBUTE, edited) : segment)) }, result: undefined };
}

/** The items with the `edited` attribute of those that carry one. */
export function toMessageItems(file: ItemFile): SpaceMessageItem[] {
  const segments = file.segments.filter((segment): segment is ItemSegment => segment.kind === "item");
  return toQmdItems(file).map((item, at) => {
    const edited = segments[at]?.attrs.find(([key]) => key === EDITED_ATTRIBUTE)?.[1];
    return edited === undefined ? item : { ...item, edited };
  });
}

function withTopicStatus(file: ItemFile, status: ThreadStatus): { file: ItemFile; result: undefined } {
  const topic = firstItem(file);
  if (!topic) { throw new Error("The thread has no topic item."); }
  const next = withAttribute(topic, STATUS_ATTRIBUTE, status);
  return { file: { segments: file.segments.map((segment) => (segment === topic ? next : segment)) }, result: undefined };
}

const threadTitle = (file: ItemFile, path: string): string => (path === SPACE_CHAT_PATH ? SPACE_CHAT_TITLE : titleOfItemFile(file, path));

/** The text around the match, EXCERPT_CONTEXT characters each side, on one line. */
function excerptAround(body: string, at: number, length: number): string {
  const start = Math.max(at - EXCERPT_CONTEXT, 0);
  const end = Math.min(at + length + EXCERPT_CONTEXT, body.length);
  const text = body.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${text}${end < body.length ? "…" : ""}`;
}

/** Messages by others created after the reader last opened the conversation; every message by others when they never did. */
export function countUnread(messages: readonly Pick<SpaceQmdItem, "author" | "created">[], path: string, reader: ThreadReader): number {
  const at = reader.seen.find((entry) => entry.by === reader.author && entry.path === path)?.at;
  const since = at === undefined ? undefined : Date.parse(at);
  return messages.filter((item) => item.author !== reader.author
    && (since === undefined || Number.isNaN(since) || (item.created !== undefined && Date.parse(item.created) > since))).length;
}

async function readThreads(ctx: StoreContext, spaceId: string): Promise<Array<{ path: string; name: string; file: ItemFile }>> {
  const names = await listQmdNames(ctx, spaceId, DISCUSSIONS_DIR);
  return Promise.all(names.map(async (name) => {
    const path = `${DISCUSSIONS_DIR}/${name}`;
    return { path, name, file: await readItemFile(ctx, spaceId, DISCUSSIONS_DIR, path) };
  }));
}

async function searchThreads(ctx: StoreContext, spaceId: string, query: string, limit: number): Promise<DiscussionSearchHit[]> {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") { return []; }
  const hits: DiscussionSearchHit[] = [];
  for (const { path, file } of await readThreads(ctx, spaceId)) {
    const title = threadTitle(file, path);
    const items = toQmdItems(file);
    const topic = path === SPACE_CHAT_PATH ? undefined : items[0];
    for (const item of items) {
      if (hits.length >= limit) { return hits; }
      const inBody = item.body.toLocaleLowerCase().includes(needle);
      if (!inBody && !(item === topic && title.toLocaleLowerCase().includes(needle))) { continue; }
      // The excerpt shows math as a placeholder, so a match inside math leaves the excerpt at the start of the message.
      const shown = replaceMath(item.body);
      const at = shown.toLocaleLowerCase().indexOf(needle);
      hits.push({ path, itemId: item.id, title, excerpt: excerptAround(shown, Math.max(at, 0), at < 0 ? 0 : needle.length),
        ...(item.author === undefined ? {} : { author: item.author }), ...(item.created === undefined ? {} : { created: item.created }) });
    }
  }
  return hits;
}

export function createSpaceDiscussionsStore(ctx: StoreContext): SpaceDiscussionsStore {
  return {
    async list(spaceId, reader) {
      return Promise.all((await readThreads(ctx, spaceId)).map(async ({ path, name, file }) => {
        const chat = path === SPACE_CHAT_PATH;
        const all = toQmdItems(file);
        const messages = chat ? all : all.slice(1);
        const last = all.at(-1);
        return {
          path,
          title: threadTitle(file, path),
          status: chat ? "open" : statusOf(firstItem(file)),
          messages: messages.length,
          ...(reader ? { unread: countUnread(messages, path, reader) } : {}),
          updated: await updatedOf(ctx, spaceId, DISCUSSIONS_DIR, name),
          ...(last ? { last: { body: last.body.slice(0, LAST_BODY_LIMIT),
            ...(last.author === undefined ? {} : { author: last.author }), ...(last.created === undefined ? {} : { created: last.created }) } } : {}),
        };
      }));
    },
    create: (spaceId, title, body, author) => createItemFile(ctx, spaceId, DISCUSSIONS_DIR, title, (empty) => {
      const topic = withNewItem(ctx, empty, body === "" ? `# ${title}\n` : `# ${title}\n\n${body}`, author).file;
      return withTopicStatus(topic, "open").file;
    }),
    async read(spaceId, path) { return toMessageItems(await readItemFile(ctx, spaceId, DISCUSSIONS_DIR, path)); },
    addMessage: (spaceId, path, body, author, id) =>
      changeItemFile(ctx, spaceId, DISCUSSIONS_DIR, path, (file) => withNewItem(ctx, file, body, author, id)),
    editMessage: (spaceId, path, id, body, stamp) => changeItemFile(ctx, spaceId, DISCUSSIONS_DIR, path, (file) => withEditedMessage(file, id, body, stamp)),
    removeMessage: (spaceId, path, id) => changeItemFile(ctx, spaceId, DISCUSSIONS_DIR, path, (file) => withRemovedItem(file, id)),
    setStatus: (spaceId, path, status) => changeItemFile(ctx, spaceId, DISCUSSIONS_DIR, path, (file) => withTopicStatus(file, status)),
    search: (spaceId, query, limit = DISCUSSION_SEARCH_LIMIT) => searchThreads(ctx, spaceId, query, limit),
  };
}
