/** Reads typed fields from an untrusted message body, throwing a FieldError that names the refused field. */

import { isRecord } from "../guards/index.js";
import { checkHelperPath, isHelperProjectId } from "./helperPaths.js";
import { MAX_PROJECT_FILES, type HelperRejectionKind } from "./helperMessages.js";

export type Body = Record<string, unknown>;

/** Thrown only inside the parser, which turns it into a HelperRejection. */
export class FieldError extends Error {
  constructor(readonly code: HelperRejectionKind, message: string) {
    super(message);
  }
}

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

export function readSha256(body: Body, key: string): string {
  const value = readString(body, key);
  if (!isSha256(value)) { throw new FieldError("invalid-field", `${key} is not a lowercase hex SHA-256`); }
  return value;
}
