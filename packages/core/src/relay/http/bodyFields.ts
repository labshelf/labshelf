// Checks the version and the fields of an untrusted relay JSON body before anyone reads it.

import { parseRelayVersion, RELAY_PROTOCOL_MAJOR } from "../protocolVersion.js";

export type Fields = Record<string, unknown>;

/** A decoder copies only the fields it knows, so keys of a newer minor never reach the caller. */
export type BodyReader<T> = (body: Fields) => Omit<T, "v"> | undefined;

/** Reads `v`, then the fields; another major is reported apart, since it needs an update and not a fix. */
export function readBody<T>(value: unknown, read: BodyReader<T>): { ok: true; value: T } | { ok: false; error: "malformed" } | { ok: false; major: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) { return { ok: false, error: "malformed" }; }
  const body = value as Fields;
  const version = typeof body.v === "string" ? parseRelayVersion(body.v) : undefined;
  if (!version) { return { ok: false, error: "malformed" }; }
  if (version.major !== RELAY_PROTOCOL_MAJOR) { return { ok: false, major: body.v as string }; }
  const fields = read(body);
  return fields ? { ok: true, value: { v: body.v, ...fields } as T } : { ok: false, error: "malformed" };
}

export const isShareId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
export const isSha256Hex = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
/** 32 bytes in base64url without padding. */
export const isRelayToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export const isTicket = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
export const isUnixTime = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
