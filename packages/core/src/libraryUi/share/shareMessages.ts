// Defines the messages between the sharing dialogs and a SharingHost in another context, and validates them on arrival.
import { isBoolean, isCount, isNonEmptyString, isRecord, isStringUpTo } from "../../guards/index.js";
import { isLibraryPath } from "../../path/index.js";
import type { ShareOffers, ShareProgress } from "./shareHost.js";

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
  | (Envelope & { type: "open"; request: ShareDialogRequest });

type Raw = Record<string, unknown>;
type Check = (v: unknown) => boolean;

const ID_MAX = 4096;
const TEXT_MAX = 16384;

const isIdUpTo = isStringUpTo(ID_MAX);
const isCappedText = isStringUpTo(TEXT_MAX);
const isKey: Check = (v) => isNonEmptyString(v) && isIdUpTo(v);
const isSecret: Check = (v) => isNonEmptyString(v) && isCappedText(v);
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
    (m["type"] === "open" && isRequest(m["request"]));
  return valid ? (m as ShareReply) : null;
}
