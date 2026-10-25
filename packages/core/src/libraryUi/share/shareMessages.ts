// Defines the messages between the sharing dialogs and a SharingHost in another context, and validates them on arrival.
import { isLibraryPath } from "../protocol/index.js";
import type { SharingOffers, SharingProgress } from "./shareHost.js";

/** The JSON-able arguments of each SharingHost operation, in order; signals and progress callbacks stay on their side. */
export interface SharingArgs {
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

export type SharingOp = keyof SharingArgs;

type Envelope = { channel: "sharing" };

export type SharingCall =
  | { [K in SharingOp]: Envelope & { type: "call"; id: number; op: K; args: SharingArgs[K] } }[SharingOp]
  | (Envelope & { type: "cancel"; id: number })
  | (Envelope & { type: "hello" });

/** A dialog the host asks the UI to open, with what it already knows filled in. */
export type SharingDialogRequest =
  | { kind: "shareProject"; projectId?: string }
  | { kind: "leaveProject"; projectId?: string }
  | { kind: "joinProject"; invite?: string }
  | { kind: "shareFolder"; path?: string }
  | { kind: "manageLinks" }
  | { kind: "importLink"; link?: string };

export type SharingReply =
  | (Envelope & { type: "result"; id: number; ok: true; value: unknown })
  | (Envelope & { type: "result"; id: number; ok: false; error: string })
  | (Envelope & { type: "progress"; id: number; progress: SharingProgress })
  | (Envelope & { type: "offers"; offers: SharingOffers; place: string })
  | (Envelope & { type: "open"; request: SharingDialogRequest });

type Raw = Record<string, unknown>;
type Check = (v: unknown) => boolean;

const ID_MAX = 4096;
const TEXT_MAX = 16384;

const isObject = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const isCallId = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isCount = isCallId;
const isKey: Check = (v) => typeof v === "string" && v.length > 0 && v.length <= ID_MAX;
const isSecret: Check = (v) => typeof v === "string" && v.length > 0 && v.length <= TEXT_MAX;
const isText: Check = (v) => typeof v === "string" && v.length <= TEXT_MAX;
const isBool: Check = (v) => typeof v === "boolean";
const isFolder: Check = (v) => isLibraryPath(v) && v.length <= ID_MAX;
// Only a web address reaches the host's browser opener, never a script, file or extension URL.
const isWebUrl: Check = (v) =>
  typeof v === "string" && v.length <= TEXT_MAX && URL.canParse(v) && ["https:", "http:"].includes(new URL(v).protocol);

// The checks for each operation's arguments; the array length is the arity.
const ARG_CHECKS: Record<SharingOp, Check[]> = {
  projects: [],
  projectStatus: [isKey],
  shareProject: [isKey],
  inviteLink: [isKey],
  joinProject: [isSecret],
  leaveProject: [isKey],
  openProject: [isKey],
  shareableFolder: [isFolder],
  shareFolder: [isFolder, isBool],
  sharedLinks: [],
  revokeLink: [isKey],
  importLink: [isSecret],
  openFolder: [isFolder],
  copyText: [isText],
  openLink: [isWebUrl],
};

/** True for any object on the sharing channel, valid or not, so other handlers can leave it alone. */
export function isSharingMessage(raw: unknown): boolean {
  return isObject(raw) && raw["channel"] === "sharing";
}

function validArgs(op: unknown, args: unknown): boolean {
  if (typeof op !== "string" || !Object.hasOwn(ARG_CHECKS, op) || !Array.isArray(args)) return false;
  const checks = ARG_CHECKS[op as SharingOp];
  return args.length === checks.length && checks.every((check, i) => check(args[i]));
}

/** @returns the message when it is a sharing call, cancel or hello with valid fields, else null */
export function parseSharingCall(raw: unknown): SharingCall | null {
  if (!isSharingMessage(raw)) return null;
  const message = raw as Raw;
  switch (message["type"]) {
    case "hello": return message as SharingCall;
    case "cancel": return isCallId(message["id"]) ? (message as SharingCall) : null;
    case "call": return isCallId(message["id"]) && validArgs(message["op"], message["args"]) ? (message as SharingCall) : null;
    default: return null;
  }
}

const STAGES: readonly unknown[] = ["reading", "encrypting", "uploading"] satisfies Extract<SharingProgress, { stage: unknown }>["stage"][];

const isProgress = (v: unknown): boolean =>
  isObject(v) && (STAGES.includes(v["stage"]) || (isCount(v["done"]) && isCount(v["total"])));

const isOffers = (v: unknown): boolean => isObject(v) && isBool(v["projects"]) && isBool(v["links"]);

const optional = (check: Check): Check => (v) => v === undefined || check(v);

// The optional field each dialog request may carry.
const REQUEST_FIELDS: Record<SharingDialogRequest["kind"], [string, Check] | null> = {
  shareProject: ["projectId", optional(isKey)],
  leaveProject: ["projectId", optional(isKey)],
  joinProject: ["invite", optional(isText)],
  shareFolder: ["path", optional(isFolder)],
  manageLinks: null,
  importLink: ["link", optional(isText)],
};

function isRequest(v: unknown): boolean {
  if (!isObject(v) || typeof v["kind"] !== "string" || !Object.hasOwn(REQUEST_FIELDS, v["kind"])) return false;
  const field = REQUEST_FIELDS[v["kind"] as SharingDialogRequest["kind"]];
  return field === null || field[1](v[field[0]]);
}

function isResult(m: Raw): boolean {
  if (!isCallId(m["id"])) return false;
  if (m["ok"] === true) return true;
  return m["ok"] === false && typeof m["error"] === "string";
}

/** @returns the message when it is a sharing reply with valid fields, else null */
export function parseSharingReply(raw: unknown): SharingReply | null {
  if (!isSharingMessage(raw)) return null;
  const m = raw as Raw;
  const valid =
    (m["type"] === "result" && isResult(m)) ||
    (m["type"] === "progress" && isCallId(m["id"]) && isProgress(m["progress"])) ||
    (m["type"] === "offers" && isOffers(m["offers"]) && typeof m["place"] === "string") ||
    (m["type"] === "open" && isRequest(m["request"]));
  return valid ? (m as SharingReply) : null;
}
