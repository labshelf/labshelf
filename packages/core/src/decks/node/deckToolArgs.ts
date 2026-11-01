// Reads and checks the arguments of the deck tools and shapes their results, refusing a bad call with a sentence that names the argument.
import { checkRelativePath } from "../../path/relativePath.js";
import type { McpToolResult } from "../../mcp/index.js";
import type { DeckDiagnostic, DeckEdit } from "../index.js";

const MAX_ASSET_BYTES = 5242880;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const RESERVED_FILES = new Set(["deck.html", "theme.css"]);

export interface DeckAsset { path: string; data: Buffer }

/** A refusal of a tool call; the tool returns it as an isError result and writes nothing. */
export class ToolRefusal extends Error {
  constructor(message: string, readonly diagnostics?: DeckDiagnostic[]) {
    super(message);
  }
}

type Args = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function textResult(value: unknown, isError: boolean): McpToolResult {
  const content: McpToolResult["content"] = [{ type: "text", text: JSON.stringify(value, null, 2) }];
  return isError ? { content, isError: true } : { content };
}

/** A successful result: one text content holding the value as JSON. */
export const okResult = (value: unknown): McpToolResult => textResult(value, false);

/** A refused call: {ok: false, error?, diagnostics?} with isError set. */
export function refusalResult(refusal: ToolRefusal): McpToolResult {
  return textResult({ ok: false, ...(refusal.message === "" ? {} : { error: refusal.message }), ...(refusal.diagnostics ? { diagnostics: refusal.diagnostics } : {}) }, true);
}

export function optionalString(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ToolRefusal(`The argument ${key} must be a string.`);
  return value;
}

export function requiredString(args: Args, key: string): string {
  const value = optionalString(args, key);
  if (value === undefined) throw new ToolRefusal(`The argument ${key} is required.`);
  return value;
}

export function optionalEdits(args: Args): DeckEdit[] | undefined {
  const value = args["edits"];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isRecord)) throw new ToolRefusal("The argument edits must be an array of edit objects.");
  return value as unknown as DeckEdit[];
}

function decodeAsset(path: string, base64: string): Buffer {
  const compact = base64.replace(/\s+/g, "");
  if (!BASE64.test(compact) || compact.length % 4 === 1) throw new ToolRefusal(`Asset ${path} is not valid base64.`);
  const data = Buffer.from(compact, "base64");
  if (data.length > MAX_ASSET_BYTES) throw new ToolRefusal(`Asset ${path} is larger than 5 MB.`);
  return data;
}

export function optionalAssets(args: Args): DeckAsset[] | undefined {
  const value = args["assets"];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ToolRefusal("The argument assets must be an array of {path, base64}.");
  return value.map((entry): DeckAsset => {
    if (!isRecord(entry) || typeof entry["path"] !== "string" || typeof entry["base64"] !== "string") {
      throw new ToolRefusal("The argument assets must be an array of {path, base64}.");
    }
    const path = entry["path"];
    const problem = checkRelativePath(path);
    if (problem !== undefined) throw new ToolRefusal(`Asset path ${path} ${problem}.`);
    if (RESERVED_FILES.has(path)) throw new ToolRefusal(`Asset path ${path} is a file the deck tools write themselves.`);
    return { path, data: decodeAsset(path, entry["base64"]) };
  });
}
