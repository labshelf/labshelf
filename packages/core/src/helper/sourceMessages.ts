/** Reads the fields of the helper's linked-output source messages: the absolute source folder, a file path confined to it, the command and the replies a page receives. */
// CONTRACT: documents/contracts/helper.md#messages

import {
  MAX_PROJECT_FILES, MAX_SOURCE_COMMAND_BYTES, MAX_SOURCE_FOLDER_LENGTH, MAX_SOURCE_OUTPUT_CHARS, MAX_SOURCE_RUN_TIMEOUT_MS, SOURCE_RUN_STATUSES,
  type ToHelperMessage, type ToPageMessage,
} from "./helperMessages.js";
import { checkHelperPath } from "./helperPaths.js";
import { FieldError } from "./fieldError.js";
import { invalidField, readFlagField, readTextField } from "./evalMath.js";

type Body = Record<string, unknown>;
type Envelope = { v: number; id: string };
type SourceRequest = "sourcePick" | "sourceInspect" | "sourceList" | "sourceRead" | "sourceRun" | "cancelSourceRun";
type SourceReply = "sourcePicked" | "sourceInfo" | "sourceFiles" | "sourceBytes" | "sourceRan";

const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;

/** The reason an absolute folder is refused, or undefined when it is a plain absolute path (POSIX or a Windows drive) without `.` or `..` segments. */
export function checkSourceFolder(folder: string): string | undefined {
  if (folder === "") { return "folder is empty"; }
  if (folder.length > MAX_SOURCE_FOLDER_LENGTH) { return `folder is longer than ${MAX_SOURCE_FOLDER_LENGTH} characters`; }
  if (folder.includes("\u0000")) { return "folder contains NUL"; }
  if (!folder.startsWith("/") && !WINDOWS_ABSOLUTE.test(folder)) { return "folder is not an absolute path"; }
  if (folder.split(/[\\/]/).some((segment) => segment === "." || segment === "..")) { return "folder has a . or .. segment"; }
  return undefined;
}

function folderOf(body: Body): string {
  const folder = readTextField(body, "folder");
  const problem = checkSourceFolder(folder);
  if (problem) { throw new FieldError("path", `folder: ${problem}`); }
  return folder;
}

function pathOf(value: unknown, label: string): string {
  if (typeof value !== "string") { throw invalidField(`${label} is not a string`); }
  const problem = checkHelperPath(value);
  if (problem) { throw new FieldError("path", `${label}: ${problem}`); }
  return value;
}

function command(body: Body): string {
  const value = readTextField(body, "command");
  if (value.trim() === "") { throw invalidField("command is empty"); }
  const tooLarge = value.length > MAX_SOURCE_COMMAND_BYTES || (value.length * 3 > MAX_SOURCE_COMMAND_BYTES && new TextEncoder().encode(value).length > MAX_SOURCE_COMMAND_BYTES);
  if (tooLarge) { throw new FieldError("limit", `command is larger than ${MAX_SOURCE_COMMAND_BYTES} bytes`); }
  return value;
}

function count(body: Body, key: string, max: number, min = 0): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) { throw invalidField(`${key} is not a valid number`); }
  return value;
}

function files(body: Body): string[] {
  const value = body.files;
  if (!Array.isArray(value)) { throw invalidField("files is not an array"); }
  if (value.length > MAX_PROJECT_FILES) { throw new FieldError("limit", `files has more than ${MAX_PROJECT_FILES} entries`); }
  return value.map((entry, index) => pathOf(entry, `files[${index}]`));
}

function exitCode(body: Body): { code?: number | null } {
  const value = body.code;
  if (value === undefined) { return {}; }
  if (value !== null && (typeof value !== "number" || !Number.isInteger(value))) { throw invalidField("code is not an integer or null"); }
  return { code: value };
}

function output(body: Body): { output?: string } {
  if (body.output === undefined) { return {}; }
  const value = readTextField(body, "output");
  if (value.length > MAX_SOURCE_OUTPUT_CHARS) { throw new FieldError("limit", `output is longer than ${MAX_SOURCE_OUTPUT_CHARS} characters`); }
  return { output: value };
}

function status(body: Body): (typeof SOURCE_RUN_STATUSES)[number] {
  const value = body.status;
  if (!SOURCE_RUN_STATUSES.includes(value as (typeof SOURCE_RUN_STATUSES)[number])) { throw invalidField(`status is not one of ${SOURCE_RUN_STATUSES.join(", ")}`); }
  return value as (typeof SOURCE_RUN_STATUSES)[number];
}

export const SOURCE_REQUEST_READERS: { [T in SourceRequest]: (body: Body, envelope: Envelope) => Extract<ToHelperMessage, { type: T }> } = {
  sourcePick: (_body, envelope) => ({ ...envelope, type: "sourcePick" }),
  sourceInspect: (body, envelope) => ({ ...envelope, type: "sourceInspect", folder: folderOf(body) }),
  sourceList: (body, envelope) => ({ ...envelope, type: "sourceList", folder: folderOf(body) }),
  sourceRead: (body, envelope) => ({ ...envelope, type: "sourceRead", folder: folderOf(body), path: pathOf(body.path, "path") }),
  sourceRun: (body, envelope) => ({ ...envelope, type: "sourceRun", folder: folderOf(body), command: command(body), timeoutMs: count(body, "timeoutMs", MAX_SOURCE_RUN_TIMEOUT_MS, 1) }),
  cancelSourceRun: (body, envelope) => {
    const requestId = readTextField(body, "requestId");
    if (requestId === "") { throw invalidField("requestId is empty"); }
    return { ...envelope, type: "cancelSourceRun", requestId };
  },
};

export const SOURCE_REPLY_READERS: { [T in SourceReply]: (body: Body, envelope: Envelope) => Extract<ToPageMessage, { type: T }> } = {
  sourcePicked: (body, envelope) => {
    const folder = body.folder === undefined ? {} : { folder: folderOf(body) };
    return { ...envelope, type: "sourcePicked", ...folder, ...(body.unavailable === undefined ? {} : { unavailable: readFlagField(body, "unavailable") }) };
  },
  sourceInfo: (body, envelope) => ({ ...envelope, type: "sourceInfo", exists: readFlagField(body, "exists"), ...(body.remote === undefined ? {} : { remote: readTextField(body, "remote") }) }),
  sourceFiles: (body, envelope) => ({ ...envelope, type: "sourceFiles", files: files(body) }),
  sourceBytes: (body, envelope) => ({ ...envelope, type: "sourceBytes", bytes: count(body, "bytes", Number.MAX_SAFE_INTEGER), ...(body.missing === undefined ? {} : { missing: readFlagField(body, "missing") }) }),
  sourceRan: (body, envelope) => ({ ...envelope, type: "sourceRan", status: status(body), ...exitCode(body), ...output(body) }),
};
