/**
 * The channel that carries the sharing host between contexts: the messages and their guards, the client that forwards calls,
 * and the end that serves them over a host.
 */
import { isBoolean, isCount, isNonEmptyString, isRecord, isStringUpTo } from "../guards/index.js";
import { isLibraryPath } from "../path/index.js";
import type { ContactView, InvitationView, ShareOffers, ShareProgress, ShareHost } from "./libraryShareHost.js";
import type { MessageEnd } from "../libraryUi/protocol/index.js";
import { formatError } from "../errors/index.js";
import type { ILogger } from "../ports/index.js";

/** The JSON-able arguments of each SharingHost operation, in order; signals and progress callbacks stay on their side. */
export interface ShareArgs {
  projects: [];
  projectStatus: [projectId: string];
  shareProject: [projectId: string];
  inviteLink: [projectId: string];
  joinProject: [invite: string];
  leaveProject: [projectId: string];
  openProject: [projectId: string];
  shareableFolder: [path: string];
  shareFolder: [path: string, withAnnotations: boolean];
  sharedLinks: [];
  revokeLink: [id: string];
  importLink: [text: string];
  openFolder: [path: string];
  copyText: [text: string];
  openLink: [url: string];
  invitations: [];
  acceptInvitation: [id: string];
  declineInvitation: [id: string];
  inviteByEmail: [projectId: string, email: string];
  contacts: [];
  invitationsEnabled: [];
  setInvitationsEnabled: [on: boolean];
}

export type ShareOp = keyof ShareArgs;

type Envelope = { channel: "sharing" };

export type ShareCall =
  | { [K in ShareOp]: Envelope & { type: "call"; id: number; op: K; args: ShareArgs[K] } }[ShareOp]
  | (Envelope & { type: "cancel"; id: number })
  | (Envelope & { type: "hello" });

/** A dialog the host asks the UI to open, with what it already knows filled in. */
export type ShareDialogRequest =
  | { kind: "shareProject"; projectId?: string }
  | { kind: "leaveProject"; projectId?: string }
  | { kind: "joinProject"; invite?: string }
  | { kind: "shareFolder"; path?: string }
  | { kind: "manageLinks" }
  | { kind: "importLink"; link?: string };

export type ShareReply =
  | (Envelope & { type: "result"; id: number; ok: true; value: unknown })
  | (Envelope & { type: "result"; id: number; ok: false; error: string })
  | (Envelope & { type: "progress"; id: number; progress: ShareProgress })
  | (Envelope & { type: "offers"; offers: ShareOffers; place: string })
  | (Envelope & { type: "invitations"; invitations: InvitationView[] })
  | (Envelope & { type: "open"; request: ShareDialogRequest });

type Raw = Record<string, unknown>;
type Check = (v: unknown) => boolean;

const ID_MAX = 4096;
const TEXT_MAX = 16384;
// RFC 5321 caps an address at 254 characters; a little room stays for what the directory refuses itself.
const EMAIL_MAX = 320;

const isIdUpTo = isStringUpTo(ID_MAX);
const isCappedText = isStringUpTo(TEXT_MAX);
const isKey: Check = (v) => isNonEmptyString(v) && isIdUpTo(v);
const isSecret: Check = (v) => isNonEmptyString(v) && isCappedText(v);
const isEmail: Check = (v) => isStringUpTo(EMAIL_MAX)(v) && /^[^\s@]+@[^\s@]+$/.test(v as string);
const isFolder: Check = (v) => isLibraryPath(v) && v.length <= ID_MAX;
// Only a web address reaches the host's browser opener, never a script, file or extension URL.
const isWebUrl: Check = (v) =>
  isCappedText(v) && URL.canParse(v) && ["https:", "http:"].includes(new URL(v).protocol);

// The checks for each operation's arguments; the array length is the arity.
const ARG_CHECKS: Record<ShareOp, Check[]> = {
  projects: [],
  projectStatus: [isKey],
  shareProject: [isKey],
  inviteLink: [isKey],
  joinProject: [isSecret],
  leaveProject: [isKey],
  openProject: [isKey],
  shareableFolder: [isFolder],
  shareFolder: [isFolder, isBoolean],
  sharedLinks: [],
  revokeLink: [isKey],
  importLink: [isSecret],
  openFolder: [isFolder],
  copyText: [isCappedText],
  openLink: [isWebUrl],
  invitations: [],
  acceptInvitation: [isKey],
  declineInvitation: [isKey],
  inviteByEmail: [isKey, isEmail],
  contacts: [],
  invitationsEnabled: [],
  setInvitationsEnabled: [isBoolean],
};

/** True for any object on the sharing channel, valid or not, so other handlers can leave it alone. */
export function isShareMessage(raw: unknown): boolean {
  return isRecord(raw) && raw["channel"] === "sharing";
}

function validArgs(op: unknown, args: unknown): boolean {
  if (typeof op !== "string" || !Object.hasOwn(ARG_CHECKS, op) || !Array.isArray(args)) return false;
  const checks = ARG_CHECKS[op as ShareOp];
  return args.length === checks.length && checks.every((check, i) => check(args[i]));
}

/** @returns the message when it is a sharing call, cancel or hello with valid fields, else null */
export function parseShareCall(raw: unknown): ShareCall | null {
  if (!isShareMessage(raw)) return null;
  const message = raw as Raw;
  switch (message["type"]) {
    case "hello": return message as ShareCall;
    case "cancel": return isCount(message["id"]) ? (message as ShareCall) : null;
    case "call": return isCount(message["id"]) && validArgs(message["op"], message["args"]) ? (message as ShareCall) : null;
    default: return null;
  }
}

const STAGES: readonly unknown[] = ["reading", "encrypting", "uploading"] satisfies Extract<ShareProgress, { stage: unknown }>["stage"][];

const isProgress = (v: unknown): boolean =>
  isRecord(v) && (STAGES.includes(v["stage"]) || (isCount(v["done"]) && isCount(v["total"])));

const isOffers = (v: unknown): boolean => isRecord(v) && isBoolean(v["projects"]) && isBoolean(v["links"]);

const optional = (check: Check): Check => (v) => v === undefined || check(v);

const isInvitation = (v: unknown): boolean =>
  isRecord(v) && typeof v["id"] === "string" && typeof v["title"] === "string" && isRecord(v["from"]) && typeof v["from"]["fingerprint"] === "string"
  && optional((x) => typeof x === "string")(v["from"]["name"]) && optional((x) => typeof x === "string")(v["from"]["email"])
  && typeof v["created"] === "number" && typeof v["expires"] === "number";

const isContactView = (v: unknown): v is ContactView =>
  isRecord(v) && typeof v["name"] === "string" && typeof v["fingerprint"] === "string" && optional((x) => typeof x === "string")(v["email"]);

/** Keeps the three fields of the view, so a host that returns more (an inbox token, keys) never sends them across the channel. */
const toContactView = ({ name, email, fingerprint }: ContactView): ContactView => ({ name, ...(email === undefined ? {} : { email }), fingerprint });

// The optional field each dialog request may carry.
const REQUEST_FIELDS: Record<ShareDialogRequest["kind"], [string, Check] | null> = {
  shareProject: ["projectId", optional(isKey)],
  leaveProject: ["projectId", optional(isKey)],
  joinProject: ["invite", optional(isCappedText)],
  shareFolder: ["path", optional(isFolder)],
  manageLinks: null,
  importLink: ["link", optional(isCappedText)],
};

function isRequest(v: unknown): boolean {
  if (!isRecord(v) || typeof v["kind"] !== "string" || !Object.hasOwn(REQUEST_FIELDS, v["kind"])) return false;
  const field = REQUEST_FIELDS[v["kind"] as ShareDialogRequest["kind"]];
  return field === null || field[1](v[field[0]]);
}

function isResult(m: Raw): boolean {
  if (!isCount(m["id"])) return false;
  if (m["ok"] === true) return true;
  return m["ok"] === false && typeof m["error"] === "string";
}

/** @returns the message when it is a sharing reply with valid fields, else null */
export function parseShareReply(raw: unknown): ShareReply | null {
  if (!isShareMessage(raw)) return null;
  const m = raw as Raw;
  const valid =
    (m["type"] === "result" && isResult(m)) ||
    (m["type"] === "progress" && isCount(m["id"]) && isProgress(m["progress"])) ||
    (m["type"] === "offers" && isOffers(m["offers"]) && typeof m["place"] === "string") ||
    (m["type"] === "invitations" && Array.isArray(m["invitations"]) && m["invitations"].every(isInvitation)) ||
    (m["type"] === "open" && isRequest(m["request"]));
  return valid ? (m as ShareReply) : null;
}

export type ShareClient = ShareHost & {
  /** Calls `handler` whenever the host asks for a dialog; returns the function that stops it. */
  onOpen(handler: (request: ShareDialogRequest) => void): () => void;
  /** Stops listening and rejects every call still waiting for its result. */
  dispose(): void;
};

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  onProgress: ((progress: ShareProgress) => void) | undefined;
}

type Call = <K extends ShareOp>(op: K, args: ShareArgs[K], signal?: AbortSignal, onProgress?: (progress: ShareProgress) => void) => Promise<never>;

// Numbers each call and keeps it waiting until its result arrives.
function callTable(port: MessageEnd<ShareCall, ShareReply>) {
  const pending = new Map<number, Pending>();
  let nextId = 0;
  // After an abort the call keeps waiting: the host settles it with its own cancellation error.
  const call: Call = (op, args, signal, onProgress) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: resolve as Pending["resolve"], reject, onProgress });
      port.post({ channel: "sharing", type: "call", id, op, args } as ShareCall);
      if (!signal) return;
      const cancel = () => port.post({ channel: "sharing", type: "cancel", id });
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
    });
  };
  return {
    call,
    progress(id: number, progress: ShareProgress) { pending.get(id)?.onProgress?.(progress); },
    settle(reply: Extract<ShareReply, { type: "result" }>) {
      const waiting = pending.get(reply.id);
      pending.delete(reply.id);
      if (reply.ok) waiting?.resolve(reply.value);
      else waiting?.reject(new Error(reply.error));
    },
    rejectAll(error: Error) {
      for (const waiting of pending.values()) waiting.reject(error);
      pending.clear();
    },
  };
}

type Operations = Omit<ShareHost, "place" | "offers" | "onOffersChange" | "onInvitationsChange">;

function forwardedOperations(call: Call): Operations {
  return {
    projects: () => call("projects", []),
    projectStatus: (projectId) => call("projectStatus", [projectId]),
    shareProject: (projectId, signal) => call("shareProject", [projectId], signal),
    inviteLink: (projectId) => call("inviteLink", [projectId]),
    joinProject: (invite, signal) => call("joinProject", [invite], signal),
    leaveProject: (projectId) => call("leaveProject", [projectId]),
    openProject: (projectId) => call("openProject", [projectId]),
    shareableFolder: (path) => call("shareableFolder", [path]),
    shareFolder: (path, withAnnotations, onProgress) => call("shareFolder", [path, withAnnotations], undefined, onProgress),
    // A deck is shared from the editor that holds it, with a path only that editor's host can read, so the sharing views never call it.
    shareDeck: () => Promise.reject(new Error("A deck is shared from its editor, not from this view.")),
    sharedLinks: () => call("sharedLinks", []),
    revokeLink: (id) => call("revokeLink", [id]),
    importLink: (text, onProgress) => call("importLink", [text], undefined, onProgress),
    openFolder: (path) => call("openFolder", [path]),
    copyText: (text) => call("copyText", [text]),
    openLink: (url) => call("openLink", [url]),
    invitations: () => call("invitations", []),
    acceptInvitation: (id, signal) => call("acceptInvitation", [id], signal),
    declineInvitation: (id) => call("declineInvitation", [id]),
    inviteByEmail: (projectId, email) => call("inviteByEmail", [projectId, email]),
    contacts: async () => {
      const value: unknown = await call("contacts", []);
      if (!Array.isArray(value) || !value.every(isContactView)) { throw new Error("The host answered the contacts with an unexpected shape."); }
      return value.map(toContactView);
    },
    invitationsEnabled: () => call("invitationsEnabled", []),
    setInvitationsEnabled: (on) => call("setInvitationsEnabled", [on]),
  };
}

/** Wraps the UI end of the sharing channel; posts `hello` so the host answers with its offers. */
export function createShareClient(port: MessageEnd<ShareCall, ShareReply>): ShareClient {
  const calls = callTable(port);
  const offerListeners = new Set<() => void>();
  const invitationListeners = new Set<(invitations: InvitationView[]) => void>();
  const openHandlers = new Set<(request: ShareDialogRequest) => void>();
  let offers: ShareOffers = { projects: false, links: false };
  let place = "";

  const unsubscribe = port.subscribe((raw: unknown) => {
    const reply = parseShareReply(raw);
    if (!reply) return;
    if (reply.type === "offers") {
      offers = reply.offers;
      place = reply.place;
      for (const listener of [...offerListeners]) listener();
    } else if (reply.type === "invitations") {
      for (const listener of [...invitationListeners]) listener(reply.invitations);
    } else if (reply.type === "open") {
      for (const handler of [...openHandlers]) handler(reply.request);
    } else if (reply.type === "progress") calls.progress(reply.id, reply.progress);
    else calls.settle(reply);
  });
  port.post({ channel: "sharing", type: "hello" });

  return {
    ...forwardedOperations(calls.call),
    get place() { return place; },
    offers: () => offers,
    onOffersChange(listener) { offerListeners.add(listener); return () => { offerListeners.delete(listener); }; },
    onInvitationsChange(listener) { invitationListeners.add(listener); return () => { invitationListeners.delete(listener); }; },
    onOpen(handler) { openHandlers.add(handler); return () => { openHandlers.delete(handler); }; },
    dispose() {
      unsubscribe();
      calls.rejectAll(new Error("The sharing channel closed"));
      offerListeners.clear();
      invitationListeners.clear();
      openHandlers.clear();
    },
  };
}

const LOG_MODULE = "sharing";

type Invocation = Extract<ShareCall, { type: "call" }>;

function invoke(host: ShareHost, call: Invocation, signal: AbortSignal, onProgress: (p: ShareProgress) => void): Promise<unknown> {
  switch (call.op) {
    case "projects": return host.projects();
    case "projectStatus": return host.projectStatus(...call.args);
    case "shareProject": return host.shareProject(call.args[0], signal);
    case "inviteLink": return host.inviteLink(...call.args);
    case "joinProject": return host.joinProject(call.args[0], signal);
    case "leaveProject": return host.leaveProject(...call.args);
    case "openProject": return host.openProject(...call.args);
    case "shareableFolder": return host.shareableFolder(...call.args);
    case "shareFolder": return host.shareFolder(call.args[0], call.args[1], onProgress);
    case "sharedLinks": return host.sharedLinks();
    case "revokeLink": return host.revokeLink(...call.args);
    case "importLink": return host.importLink(call.args[0], onProgress);
    case "openFolder": return host.openFolder(...call.args);
    case "copyText": return host.copyText(...call.args);
    case "openLink": return host.openLink(...call.args);
    case "invitations": return host.invitations();
    case "acceptInvitation": return host.acceptInvitation(call.args[0], signal);
    case "declineInvitation": return host.declineInvitation(...call.args);
    case "inviteByEmail": return host.inviteByEmail(...call.args);
    case "contacts": return host.contacts().then((contacts) => contacts.map(toContactView));
    case "invitationsEnabled": return host.invitationsEnabled();
    case "setInvitationsEnabled": return host.setInvitationsEnabled(...call.args);
  }
}

/** Serves the host end of the sharing channel; messages of other channels pass by untouched. Returns the function that stops it. */
export function serveShare(host: ShareHost, port: MessageEnd<ShareReply, unknown>, logger: ILogger): () => void {
  const running = new Map<number, AbortController>();
  let stopped = false;
  const post = (reply: ShareReply) => { if (!stopped) port.post(reply); };
  const postOffers = () => post({ channel: "sharing", type: "offers", offers: host.offers(), place: host.place });

  async function run(call: Invocation): Promise<void> {
    const controller = new AbortController();
    running.set(call.id, controller);
    const onProgress = (progress: ShareProgress) => post({ channel: "sharing", type: "progress", id: call.id, progress });
    try {
      const value = await invoke(host, call, controller.signal, onProgress);
      post({ channel: "sharing", type: "result", id: call.id, ok: true, value });
    } catch (error) {
      // TRAP: never log the arguments; invites and links carry the share's secret key.
      void logger.error(LOG_MODULE, error, { op: call.op, id: call.id });
      post({ channel: "sharing", type: "result", id: call.id, ok: false, error: formatError(error) });
    } finally {
      running.delete(call.id);
    }
  }

  const unsubscribe = port.subscribe((raw) => {
    if (!isShareMessage(raw)) return;
    const call = parseShareCall(raw);
    if (!call) {
      const type = (raw as Record<string, unknown>)["type"];
      void logger.log("WARN", LOG_MODULE, "Dropped a malformed sharing message", { type: typeof type === "string" ? type.slice(0, 32) : typeof type });
      return;
    }
    if (call.type === "hello") postOffers();
    else if (call.type === "cancel") running.get(call.id)?.abort();
    else void run(call);
  });
  const stopOffers = host.onOffersChange(postOffers);
  const stopInvitations = host.onInvitationsChange((invitations) => post({ channel: "sharing", type: "invitations", invitations }));

  return () => {
    stopped = true;
    unsubscribe();
    stopOffers();
    stopInvitations();
    for (const controller of running.values()) controller.abort();
    running.clear();
  };
}
