/** Words, wraps and inspects anything that can be thrown. */
import { isRecord } from "../guards/index.js";

/** The text of anything that can be thrown. */
export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The stack is kept only for real errors; a thrown string has no stack worth recording. */
export function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return error.stack ? { message: error.message, stack: error.stack } : { message: error.message };
  }
  return { message: formatError(error) };
}

/** The thrown value as an Error, wrapping anything that is not one. */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** The string `code` of a thrown value (a Node errno such as "ENOENT"), or undefined. */
export function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

/** Whether the value is an abort (a DOMException or any object named AbortError). */
export function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}
