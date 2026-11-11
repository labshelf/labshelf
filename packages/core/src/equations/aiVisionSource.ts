/** The AI vision sources: send an equation's or a table's PNG with one fixed prompt to the first provider that has a key (Anthropic, then OpenAI) and return only LaTeX or only a pipe table. */
import type { AiCredentialStore, AiProvider } from "../ai/credentials.js";
import { bytesToBase64 } from "../encoding/base64.js";
import type { ILogger } from "../ports/index.js";
import type { EquationSource } from "./extractor.js";

const MODULE = "equations/aiVisionSource";

export type PostFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<Response>;

/** Vision model per provider, checked against the providers' model docs on 2026-11-09. */
export const AI_VISION_MODELS: Readonly<Record<AiProvider, string>> = Object.freeze({
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-6.1-terra",
});

const PROVIDER_ORDER: readonly AiProvider[] = ["anthropic", "openai"];
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 1024;
const TABLE_MAX_TOKENS = 4096;
const ERROR_BODY_CHARS = 200;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export const AI_VISION_PROMPT =
  "The image shows one mathematical equation from a scientific paper. Return only the LaTeX of the equation in the image: " +
  "no $ or \\[ \\] delimiters, no code fences, no equation number, no prose.";

export const AI_VISION_TABLE_PROMPT =
  "The image shows one table from a scientific paper. Return only a Markdown pipe table of the table in the image: " +
  "the header row first, then a separator row of dashes, then one line per row; no caption, no prose, no code fences. " +
  "Keep math as inline $…$ LaTeX.";

/** Strips code fences around a table reply; null when nothing is left. */
export function cleanTableReply(text: string): string | null {
  let current = text.trim();
  for (let fence = /^```[\w-]*[ \t]*\n?([\s\S]*?)\n?[ \t]*```$/.exec(current); fence; fence = /^```[\w-]*[ \t]*\n?([\s\S]*?)\n?[ \t]*```$/.exec(current)) {
    current = fence[1]!.trim();
  }
  return current === "" ? null : current;
}

export function cleanLatexReply(text: string): string {
  let current = text.trim();
  for (;;) {
    const next = stripOnce(current);
    if (next === current) { return current; }
    current = next;
  }
}

function stripOnce(text: string): string {
  const fence = /^```[\w-]*[ \t]*\n?([\s\S]*?)\n?[ \t]*```$/.exec(text);
  if (fence) { return fence[1]!.trim(); }
  const display = /^\$\$([\s\S]*)\$\$$/.exec(text);
  if (display) { return display[1]!.trim(); }
  const inline = /^\$([\s\S]*)\$$/.exec(text);
  if (inline && text.length >= 2) { return inline[1]!.trim(); }
  const bracket = /^\\\[([\s\S]*)\\\]$/.exec(text);
  if (bracket) { return bracket[1]!.trim(); }
  return text;
}

interface ProviderCall { url: string; headers: Record<string, string>; body: unknown; replyText(json: unknown): string }

interface Ask { prompt: string; maxTokens: number }
const EQUATION_ASK: Ask = { prompt: AI_VISION_PROMPT, maxTokens: MAX_TOKENS };
const TABLE_ASK: Ask = { prompt: AI_VISION_TABLE_PROMPT, maxTokens: TABLE_MAX_TOKENS };

function anthropicCall(key: string, data: string, ask: Ask): ProviderCall {
  return {
    url: ANTHROPIC_URL,
    headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
    body: {
      model: AI_VISION_MODELS.anthropic,
      max_tokens: ask.maxTokens,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data } },
        { type: "text", text: ask.prompt },
      ] }],
    },
    replyText(json) {
      const content = (json as { content?: unknown }).content;
      if (!Array.isArray(content)) { return ""; }
      return content
        .filter((block): block is { type: "text"; text: string } => typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
        .map((block) => block.text)
        .join("");
    },
  };
}

function openaiCall(key: string, data: string, ask: Ask): ProviderCall {
  return {
    url: OPENAI_URL,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: {
      model: AI_VISION_MODELS.openai,
      messages: [{ role: "user", content: [
        { type: "text", text: ask.prompt },
        { type: "image_url", image_url: { url: `data:image/png;base64,${data}` } },
      ] }],
    },
    replyText(json) {
      const content = (json as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
      return typeof content === "string" ? content : "";
    },
  };
}

/** Removes every occurrence of the key from text that may reach an error or a log. */
function redact(text: string, key: string): string {
  return key.length === 0 ? text : text.split(key).join("[redacted]");
}

async function post(deps: { fetch: PostFetch; timeoutMs: number }, provider: AiProvider, call: ProviderCall, key: string, outer?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const onOuterAbort = (): void => controller.abort();
  if (outer?.aborted) { controller.abort(); } else { outer?.addEventListener("abort", onOuterAbort); }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`AI vision request to ${provider} timed out after ${deps.timeoutMs} ms`));
    }, deps.timeoutMs);
  });
  try {
    const response = await Promise.race([
      deps.fetch(call.url, { method: "POST", headers: call.headers, body: JSON.stringify(call.body), signal: controller.signal }),
      timedOut,
    ]);
    if (!response.ok) {
      const detail = redact((await response.text().catch(() => "")).slice(0, ERROR_BODY_CHARS), key);
      throw new Error(`AI vision request to ${provider} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return await Promise.race([response.json() as Promise<unknown>, timedOut]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("AI vision request")) { throw error; }
    // The platform's error may quote the request; keep only a redacted message.
    const message = redact(error instanceof Error ? error.message : String(error), key);
    throw new Error(`AI vision request to ${provider} failed: ${message}`);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

export interface AiVisionDeps { credentials: AiCredentialStore; fetch: PostFetch; logger: ILogger; timeoutMs?: number }

async function firstKey(credentials: AiCredentialStore): Promise<{ provider: AiProvider; key: string } | undefined> {
  for (const provider of PROVIDER_ORDER) {
    const key = await credentials.get(provider);
    if (key !== undefined && key.trim() !== "") { return { provider, key }; }
  }
  return undefined;
}

function providerCall(provider: AiProvider, key: string, png: Uint8Array, ask: Ask): ProviderCall {
  const data = bytesToBase64(png);
  return provider === "anthropic" ? anthropicCall(key, data, ask) : openaiCall(key, data, ask);
}

/**
 * Reads a table from its PNG with the first provider that has a key.
 * @returns a pipe table as the model wrote it, fences stripped, or null without a key or with an empty reply; a failed request throws.
 */
export function createAiVisionTableReader(deps: AiVisionDeps): (png: Uint8Array, signal?: AbortSignal) => Promise<string | null> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (png, signal) => {
    const found = await firstKey(deps.credentials);
    if (found === undefined) { return null; }
    const { provider, key } = found;
    const call = providerCall(provider, key, png, TABLE_ASK);
    void deps.logger.log("INFO", MODULE, "AI vision table request", { provider, model: AI_VISION_MODELS[provider], bytes: png.length });
    const json = await post({ fetch: deps.fetch, timeoutMs }, provider, call, key, signal);
    return cleanTableReply(call.replyText(json));
  };
}

export function createAiVisionSource(deps: AiVisionDeps): EquationSource {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    id: "ai",
    async available() {
      return (await firstKey(deps.credentials)) !== undefined;
    },
    async read(request, onProgress, signal) {
      const found = await firstKey(deps.credentials);
      if (found === undefined) { return undefined; }
      const { provider, key } = found;
      const call = providerCall(provider, key, request.png, EQUATION_ASK);
      onProgress(provider === "anthropic" ? "Asking Claude" : "Asking OpenAI");
      void deps.logger.log("INFO", MODULE, "AI vision request", { provider, model: AI_VISION_MODELS[provider], paperId: request.paperId, bytes: request.png.length });
      const json = await post({ fetch: deps.fetch, timeoutMs }, provider, call, key, signal);
      const latex = cleanLatexReply(call.replyText(json));
      return latex === "" ? undefined : { latex, provider };
    },
  };
}
