// Field readers for the helper protocol: typed fields read from an untrusted message body, throwing a FieldError that names the refused field.
// CONTRACT: documents/contracts/helper.md#messages
import { isRecord } from "../guards/index.js";
import { readRequestParams, type CellParamValue } from "../qmd/item/index.js";
import { MAX_CELL_CODE_BYTES, MAX_NOTE_KEY_LENGTH, MAX_PROJECT_FILES, type ToPageMessage } from "./helperMessages.js";
import { checkHelperPath, isHelperProjectId } from "./helperPaths.js";
import { FieldError } from "./fieldError.js";

export type Body = Record<string, unknown>;

export function readBody(body: Body, key: string): Body {
  const value = body[key];
  if (!isRecord(value)) { throw new FieldError("invalid-field", `${key} is not an object`); }
  return value;
}

export function readString(body: Body, key: string): string {
  const value = body[key];
  if (typeof value !== "string") { throw new FieldError("invalid-field", `${key} is not a string`); }
  return value;
}

export function readText(body: Body, key: string): string {
  const value = readString(body, key);
  if (value === "") { throw new FieldError("invalid-field", `${key} is empty`); }
  return value;
}

export function readBoolean(body: Body, key: string): boolean {
  const value = body[key];
  if (typeof value !== "boolean") { throw new FieldError("invalid-field", `${key} is not a boolean`); }
  return value;
}

export function readNumber(body: Body, key: string, isValid: (n: number) => boolean): number {
  const value = body[key];
  if (typeof value !== "number" || !isValid(value)) { throw new FieldError("invalid-field", `${key} is not a valid number`); }
  return value;
}

export function readChoice<T extends string>(body: Body, key: string, choices: readonly T[]): T {
  const value = body[key];
  if (!choices.includes(value as T)) { throw new FieldError("invalid-field", `${key} is not one of ${choices.join(", ")}`); }
  return value as T;
}

/** Copies `key` through `read` only when the body has it, so absent optionals stay absent. */
export function readOptionalField<T>(body: Body, key: string, read: (body: Body, key: string) => T): { [k: string]: T } {
  return body[key] === undefined ? {} : { [key]: read(body, key) };
}

export function readArray(body: Body, key: string, max = MAX_PROJECT_FILES): unknown[] {
  const value = body[key];
  if (!Array.isArray(value)) { throw new FieldError("invalid-field", `${key} is not an array`); }
  if (value.length > max) { throw new FieldError("limit", `${key} has more than ${max} entries`); }
  return value;
}

function toPath(value: unknown, label: string): string {
  if (typeof value !== "string") { throw new FieldError("invalid-field", `${label} is not a string`); }
  const problem = checkHelperPath(value);
  if (problem) { throw new FieldError("path", `${label}: ${problem}`); }
  return value;
}

export function readPath(body: Body, key: string): string {
  return toPath(body[key], key);
}

export function readPaths(body: Body, key: string): string[] {
  return readArray(body, key).map((value, index) => toPath(value, `${key}[${index}]`));
}

export function readProjectId(body: Body): string {
  const id = readString(body, "projectId");
  if (!isHelperProjectId(id)) { throw new FieldError("project-id", "projectId does not follow the project id rule"); }
  return id;
}

export const isNonNegativeInteger = (n: number): boolean => Number.isInteger(n) && n >= 0;
export const isPositiveInteger = (n: number): boolean => Number.isInteger(n) && n > 0;
const isSha256 = (text: string): boolean => /^[0-9a-f]{64}$/.test(text);

export function readRunParams(body: Body, key: string): Record<string, CellParamValue> {
  const params = readRequestParams(body[key]);
  if (params === undefined) { throw new FieldError("invalid-field", `${key} is not a valid params object`); }
  return params;
}

const CONTROL_KINDS = ["slider", "select", "checkbox"] as const;
const scalar = (value: unknown): number | string => {
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) { return value; }
  throw new FieldError("invalid-field", "a control value is not a finite number or a string");
};

/** The controls a cell result reports: at most 8 sliders, selects and checkboxes named by the parameter rule. */
export function readControls(body: Body, key: string): NonNullable<Extract<ToPageMessage, { type: "cellResult" }>["controls"]> {
  return readArray(body, key, 8).map((entry) => {
    if (!isRecord(entry)) { throw new FieldError("invalid-field", `${key} entry is not an object`); }
    const name = readString(entry, "name");
    if (!readRequestParams({ [name]: 0 })) { throw new FieldError("invalid-field", `${key} entry name is not a valid parameter name`); }
    const kind = readChoice(entry, "kind", CONTROL_KINDS);
    const finite = (k: string) => readNumber(entry, k, Number.isFinite);
    if (kind === "checkbox") { return { name, kind, value: readBoolean(entry, "value") }; }
    if (kind === "select") { return { name, kind, choices: readArray(entry, "choices", 200).map(scalar), value: scalar(entry.value) }; }
    return { name, kind, min: finite("min"), max: finite("max"), ...readOptionalField(entry, "step", (_, k) => finite(k)), ...readOptionalField(entry, "log", (b, k) => readBoolean(b, k)), value: finite("value") };
  }) as NonNullable<Extract<ToPageMessage, { type: "cellResult" }>["controls"]>;
}

/** @returns `{warnings}` when the field is an array of at most 21 strings of at most 500 characters, else `{}` so the field alone is dropped. */
export function readWarningsLeniently(body: Body, key: string): { warnings?: string[] } {
  const value = body[key];
  return Array.isArray(value) && value.length <= 21 && value.every((line) => typeof line === "string" && line.length <= 500) ? { warnings: value as string[] } : {};
}

/** @returns `{capabilities}` with the string entries of an array (unknown names kept, non-strings dropped), else `{}`: a helper without it has none. */
export const readCapabilitiesLeniently = (value: unknown): { capabilities?: string[] } => Array.isArray(value) ? { capabilities: value.filter((entry): entry is string => typeof entry === "string") } : {};

const MAX_CELL_SCOPE_LENGTH = 128;
const PAPER_SCOPE = "paper:";

/** A cell's cwd names a project id or `paper:<paperId>`, never a path; the helper resolves it from what it knows. */
function isCellScope(scope: string): boolean {
  if (isHelperProjectId(scope)) { return true; }
  if (!scope.startsWith(PAPER_SCOPE) || scope.length > MAX_CELL_SCOPE_LENGTH) { return false; }
  const paperId = scope.slice(PAPER_SCOPE.length);
  return paperId !== "" && paperId !== ".." && !/[\\/\u0000]/.test(paperId) && !paperId.startsWith("~");
}

export function readCellScope(body: Body, key: string): string {
  const scope = readString(body, key);
  if (!isCellScope(scope)) { throw new FieldError("project-id", `${key} is neither a project id nor paper:<paperId>`); }
  return scope;
}

export function readCellCode(body: Body, key: string): string {
  const code = readString(body, key);
  // The UTF-8 size is at least the length and at most three times it, so only the middle band needs the encoder.
  const tooLarge = code.length > MAX_CELL_CODE_BYTES || (code.length * 3 > MAX_CELL_CODE_BYTES && new TextEncoder().encode(code).length > MAX_CELL_CODE_BYTES);
  if (tooLarge) { throw new FieldError("limit", `${key} is larger than ${MAX_CELL_CODE_BYTES} bytes`); }
  return code;
}

export function readNoteKey(body: Body, key: string): string {
  const value = readText(body, key);
  if (value.length > MAX_NOTE_KEY_LENGTH) { throw new FieldError("invalid-field", `${key} is longer than ${MAX_NOTE_KEY_LENGTH} characters`); }
  return value;
}

export function readSha256(body: Body, key: string): string {
  const value = readString(body, key);
  if (!isSha256(value)) { throw new FieldError("invalid-field", `${key} is not a lowercase hex SHA-256`); }
  return value;
}

// Template publication fields crossing the helper socket.

export function boundedText(body: Body, key: string): string {
  const value = readString(body, key);
  if (value.length > 20_000) throw new FieldError("limit", `${key} exceeds 20000 characters`);
  return value;
}
