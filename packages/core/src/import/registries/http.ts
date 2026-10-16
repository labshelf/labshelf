/** Fetches registry responses on the host's fetch for every client: bounded wait, JSON parsing, and undefined after a WARN on any failure. */
import { errorMessage } from "../../logging/index.js";
import type { ILogger } from "../../ports/index.js";
import { DEFAULT_CONTACT_EMAIL } from "./contactEmail.js";

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
    await env.logger?.log("WARN", REGISTRIES_MODULE, "Registry answered with invalid JSON", { url, message: errorMessage(error) });
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
    await env.logger?.log("WARN", REGISTRIES_MODULE, "Registry lookup failed", { url, message: errorMessage(error) });
    return undefined;
  }
}
