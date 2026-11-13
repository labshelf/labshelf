/**
 * The consult port (plan local-sync D8): what a window that consults another file of the library asks its host and what the host answers.
 * Everything is plain data, safe to structured-clone across a webview boundary; the guards accept exactly these shapes.
 */

import { isRecord, isString } from "../../guards/index.js";
import type { Annotation } from "../../model/index.js";

/** What a consult window can show: a paper's PDF or notes, a project's note or manuscript file, a code file, or a file the user picked. */
export type ConsultRef =
  | { kind: "paper"; paperId: string }
  | { kind: "paperNotes"; paperId: string }
  | { kind: "projectNote"; projectId: string; path: string }
  | { kind: "manuscript"; projectId: string; path: string }
  | { kind: "code"; path: string }
  | { kind: "pickedFile"; id: string; name: string };

/** The lists the chooser offers. */
export type ConsultKind = "paper" | "notes" | "manuscript" | "code";

/** One row of the chooser. */
export interface ConsultEntry {
  ref: ConsultRef;
  label: string;
  detail?: string;
  group?: string;
}

export type ConsultRequest =
  | { kind: "list"; what: ConsultKind }
  | { kind: "paperPdf"; paperId: string }
  | { kind: "paperMarks"; paperId: string }
  | { kind: "browse" }
  | { kind: "open"; ref: ConsultRef };

export type ConsultValue =
  | { kind: "entries"; entries: ConsultEntry[]; canBrowse: boolean }
  | { kind: "pdf"; base64: string }
  | { kind: "marks"; annotations: Annotation[]; notesText: string | null }
  | { kind: "picked"; entry: ConsultEntry | null }
  | { kind: "opened" };

export type ConsultReply = { ok: true; value: ConsultValue } | { ok: false; error: string };

/** What the asking surface is: its project, listed first. */
export interface ConsultContext {
  projectId?: string;
}

const CONSULT_KINDS: readonly string[] = ["paper", "notes", "manuscript", "code"];

function isConsultRef(value: unknown): value is ConsultRef {
  if (!isRecord(value)) { return false; }
  switch (value["kind"]) {
    case "paper":
    case "paperNotes":
      return isString(value["paperId"]);
    case "projectNote":
    case "manuscript":
      return isString(value["projectId"]) && isString(value["path"]);
    case "code":
      return isString(value["path"]);
    case "pickedFile":
      return isString(value["id"]) && isString(value["name"]);
    default:
      return false;
  }
}

function isConsultEntry(value: unknown): value is ConsultEntry {
  if (!isRecord(value)) { return false; }
  const optional = (key: string): boolean => value[key] === undefined || isString(value[key]);
  return isConsultRef(value["ref"]) && isString(value["label"]) && optional("detail") && optional("group");
}

export function isConsultRequest(value: unknown): value is ConsultRequest {
  if (!isRecord(value)) { return false; }
  switch (value["kind"]) {
    case "list":
      return isString(value["what"]) && CONSULT_KINDS.includes(value["what"]);
    case "paperPdf":
    case "paperMarks":
      return isString(value["paperId"]);
    case "browse":
      return true;
    case "open":
      return isConsultRef(value["ref"]);
    default:
      return false;
  }
}

function isConsultValue(value: unknown): value is ConsultValue {
  if (!isRecord(value)) { return false; }
  switch (value["kind"]) {
    case "entries":
      return Array.isArray(value["entries"]) && value["entries"].every(isConsultEntry) && typeof value["canBrowse"] === "boolean";
    case "pdf":
      return isString(value["base64"]);
    case "marks":
      return Array.isArray(value["annotations"]) && value["annotations"].every(isRecord)
        && (value["notesText"] === null || isString(value["notesText"]));
    case "picked":
      return value["entry"] === null || isConsultEntry(value["entry"]);
    case "opened":
      return true;
    default:
      return false;
  }
}

export function isConsultReply(value: unknown): value is ConsultReply {
  if (!isRecord(value)) { return false; }
  if (value["ok"] === true) { return isConsultValue(value["value"]); }
  return value["ok"] === false && isString(value["error"]);
}
