// The state of a Space's Discussions tab: the dashboard and the open conversation as last painted, its timers, and the composer.
import { renderElement } from "../../ui/dom/index.js";
import { createEvalMathBridge, type CellRunGroup, type EvalMathBridge, type QmdEditorHandle } from "../../qmd/dom/index.js";
import { SPACE_CHAT_PATH, type DiscussionSearchHit, type SpaceThreadEntry, type ThreadStatus } from "../spaceDiscussionsStore.js";
import type { SpaceQmdItem } from "../spaceNotesStore.js";
import type { OverviewContext } from "./mountOverview.js";
import { createDeskPreviews, type DeskPreviews } from "./overviewDesk.js";
import { createSpaceCellRuns } from "./mountSpaceNotes.js";
import type { FollowRecord, FollowScope } from "./discussionsFollow.js";
import { buildDiscussionsDom, renderComposerTools, type DiscussionsDom } from "./discussionsViews.js";
import { createConversationPresenceSender, renderOnlineMembers, renderTypingLine, type ConversationPresenceSender } from "./discussionsPresence.js";
import type { SpacePeer } from "../spacesHostPort.js";
import type { OpenProjectChat } from "./discussionsProjectChat.js";

/** The message list counts as at the bottom this close to it, so new messages keep it there. */
const AT_BOTTOM_PX = 40;

/** A message on screen: the item it was painted from, its element, the mount of its read-only editor, and the inline editor while it is edited. */
export interface ShownMessage {
  key: string;
  item: SpaceQmdItem;
  node: HTMLElement;
  mount: HTMLElement;
  editor: QmdEditorHandle;
  edit?: { box: HTMLElement; editor: QmdEditorHandle } | undefined;
}

export interface DiscussionsState extends DiscussionsDom {
  controller: AbortController;
  ctx: OverviewContext;
  threads: SpaceThreadEntry[] | undefined;
  status: ThreadStatus;
  search: string;
  hits: DiscussionSearchHit[] | undefined;
  searchTimer: ReturnType<typeof setTimeout> | undefined;
  selected: string | undefined;
  /** The message to scroll to once the open conversation's items arrive. */
  focusItem: string | undefined;
  following: boolean;
  scope: FollowScope;
  followDetail: FollowRecord | undefined;
  items: SpaceQmdItem[] | undefined;
  /** The items of every conversation read so far, for the authors and the origin of records. */
  read: Map<string, SpaceQmdItem[]>;
  known: Set<string> | undefined;
  /** The messages on screen by item id, kept across repaints while their item is unchanged. */
  shown: Map<string, ShownMessage>;
  /** The day separators on screen by day. */
  days: Map<string, HTMLElement>;
  /** The open conversation's list entry as last read or matched; a different entry reads the items again. */
  entryKey: string | undefined;
  /** A read of the open conversation is in flight, and a change arrived while it was. */
  reading: boolean;
  readAgain: boolean;
  /** Items of the open conversation arrived since the last list snapshot, so that snapshot may only reflect them. */
  fresh: boolean;
  /** The user just sent: the next appended messages scroll to the bottom. */
  sending: boolean;
  /** Shown while new messages arrived below the scrolled-up list. */
  pill: HTMLButtonElement;
  /** The typeset last messages of the Continue cards. */
  previews: DeskPreviews;
  runs: CellRunGroup;
  math: EvalMathBridge;
  reply: QmdEditorHandle | undefined;
  draft: string;
  /** Enables or disables the composer's Σ and emoji buttons. */
  syncTools: () => void;
  /** When the open conversation was last marked seen, and the mark waiting out the throttle. */
  seenAt: number;
  seenTimer: ReturnType<typeof setTimeout> | undefined;
  /** The other members online in the Space, as the host last posted them. */
  peers: SpacePeer[];
  online: HTMLElement;
  typingLine: HTMLElement;
  presence: ConversationPresenceSender;
  /** The Project chat open in place of a conversation. */
  projectChat: OpenProjectChat | undefined;
}

export const discussionsSpaceId = (s: DiscussionsState): string => s.ctx.data.space.id;
export const canWriteDiscussions = (s: DiscussionsState): boolean => !s.ctx.readOnly && !s.ctx.signal?.aborted;
export const isChat = (path: string | undefined): boolean => path === SPACE_CHAT_PATH;

export function buildDiscussionsState(root: HTMLElement, context: OverviewContext & { threads?: SpaceThreadEntry[] }): DiscussionsState {
  const controller = new AbortController();
  const ctx: OverviewContext = { data: context.data, end: context.end, readOnly: context.readOnly, signal: controller.signal };
  const dom = buildDiscussionsDom(root);
  dom.create.disabled = ctx.readOnly;
  const state: DiscussionsState = {
    ...dom, controller, ctx, threads: context.threads, status: "open", search: "", hits: undefined, searchTimer: undefined, selected: undefined,
    focusItem: undefined, following: true, scope: "space", followDetail: undefined, items: undefined, read: new Map(), known: undefined,
    shown: new Map(), days: new Map(), entryKey: undefined, reading: false, readAgain: false, fresh: false, sending: false, pill: renderNewMessagesPill(), previews: createDeskPreviews(), runs: createSpaceCellRuns(ctx), math: createEvalMathBridge(), reply: undefined, draft: "",
    syncTools: () => {}, seenAt: 0, seenTimer: undefined,
    peers: [], online: renderOnlineMembers(), typingLine: renderTypingLine(),
    presence: createConversationPresenceSender(ctx.end, ctx.data.space.id, () => !ctx.readOnly && !controller.signal.aborted),
    projectChat: undefined,
  };
  // The tools reach the composer mounted when they are pressed.
  const tools = renderComposerTools(() => state.reply, () => ctx.readOnly);
  dom.toolsHost.replaceChildren(tools.tools);
  state.syncTools = tools.sync;
  return state;
}

function renderNewMessagesPill(): HTMLButtonElement {
  const pill = renderElement("button", { type: "button", class: "ds-new-pill", text: "New messages" });
  pill.hidden = true;
  return pill;
}

export const atBottom = (list: HTMLElement): boolean => list.scrollHeight - list.scrollTop - list.clientHeight <= AT_BOTTOM_PX;

export function scrollToBottom(s: DiscussionsState): void {
  s.messages.scrollTop = s.messages.scrollHeight;
  s.pill.hidden = true;
}
