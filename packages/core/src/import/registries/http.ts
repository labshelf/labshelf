/** Fetches registry responses on the host's fetch for every client: bounded wait, JSON parsing, and undefined after a WARN on any failure; also the record shape, text helpers and contact address they share. */
import { formatError } from "../../errors/index.js";
import type { ILogger } from "../../ports/index.js";
import type { ResolvedMetadata } from "./metadata.js";

/** The contact address the registries' polite pools see when the user has not set one. */
export const DEFAULT_CONTACT_EMAIL = "contact@labshelf.org";

const REGISTRIES_MODULE = "registries";
const REQUEST_TIMEOUT_MS = 12_000;

/** What a registry call runs on; every field falls back to the platform's (global fetch, no log, the default contact). */
export interface RegistryEnv {
  fetch?: typeof fetch;
  logger?: ILogger | undefined;
  /** Identifies the caller to the registries' polite pools. */
  contactEmail?: string;
}

export async function fetchJson<T>(env: RegistryEnv, url: string): Promise<T | undefined> {
  const body = await fetchText(env, url);
  if (!body) {
    return undefined;
  }
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    await env.logger?.log("WARN", REGISTRIES_MODULE, "Registry answered with invalid JSON", { url, message: formatError(error) });
    return undefined;
  }
}

/** A registry that is offline, rate-limited or slow is routine: the caller falls through to the next source. */
export async function fetchText(env: RegistryEnv, url: string): Promise<string | undefined> {
  // A bare reference: a browser's fetch throws "Illegal invocation" when called as a method of another object.
  const doFetch = env.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  try {
    const response = await doFetch(url, {
      headers: { Accept: "application/json", "User-Agent": `LabShelf/0.1 (research paper manager; mailto:${env.contactEmail ?? DEFAULT_CONTACT_EMAIL})` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      await env.logger?.log("WARN", REGISTRIES_MODULE, "Registry lookup failed", { url, status: response.status });
      return undefined;
    }
    return await response.text();
  } catch (error) {
    await env.logger?.log("WARN", REGISTRIES_MODULE, "Registry lookup failed", { url, message: formatError(error) });
    return undefined;
  }
}

/** A registry record plus the kind of work it describes. */
export interface RegistryEntry extends ResolvedMetadata {
  // CrossRef mints separate DOIs for a paper's abstract, figures and tables.
  // Those records carry the wrong title, so callers must be able to skip them.
  isComponent?: boolean;
}

/** Turns a registry record into plain metadata by dropping the registry-only flags. */
export function derivePlainMetadata(record: RegistryEntry | undefined): ResolvedMetadata | undefined {
  if (!record) {
    return undefined;
  }
  const { isComponent: _isComponent, ...metadata } = record;
  return metadata;
}

// Cleans strings and reads payload shapes for the registry mappers.

export function findFirstNonEmpty(values: string[] | undefined): string | undefined {
  return values?.map((value) => value.trim()).find((value) => value.length > 0);
}

/** Normalizes an API field that is one value when singular and a list when not. */
export function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function matchTag(content: string, tagName: string): string | undefined {
  return content.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"))?.[1];
}

export function parseXmlText(value: string | undefined): string | undefined {
  return value?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || undefined;
}
