// Keeps the helper's secrets and files private: the start-time check that no other user can change them, and the file logger that redacts every line.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { isGroupOrOtherWritable } from "../../library/node/index.js";
import { Logger } from "../../logging/index.js";
import { type ILogger, type LogSink } from "../../ports/index.js";
import { FileLogSink } from "../../logging/node/index.js";

// --- Start-time privacy check ---

/**
 * Throws, naming each path and its mode, when a path exists and is writable by its group or others; a path that does not exist yet passes.
 * The refusal is the error and is not logged: the helper logger would chmod the folder it refuses.
 * PLATFORM: Windows has no POSIX modes, so the check passes there.
 */
export async function assertPrivatePaths(paths: readonly string[], platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform === "win32") return;
  const loose: string[] = [];
  for (const target of paths) {
    const stat = await fs.stat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (stat && isGroupOrOtherWritable(stat.mode)) loose.push(`${target} (mode ${(stat.mode & 0o777).toString(8)})`);
  }
  if (loose.length > 0) throw new Error(`labshelf helper will not start: ${loose.join(", ")} can be changed by other users; run chmod go-w on it`);
}

export interface HelperPrivatePaths { binaryPath: string; dataDir: string }

// A root-owned folder such as /usr/local/bin may be group-writable by design; only root could tighten it.
async function isRootOwned(folder: string): Promise<boolean> {
  const stat = await fs.stat(folder).catch(() => undefined);
  return stat?.uid === 0;
}

/** Refuses to start the standalone helper when its binary, its folder or its data folder can be changed by another user. */
export async function assertHelperPrivatePaths({ binaryPath, dataDir }: HelperPrivatePaths, platform: NodeJS.Platform = process.platform): Promise<void> {
  const binaryDir = path.dirname(binaryPath);
  const paths = [binaryPath, dataDir, path.join(dataDir, "bin")];
  if (!(await isRootOwned(binaryDir))) { paths.push(binaryDir); }
  await assertPrivatePaths(paths, platform);
}

// --- Redaction: registered values, bearer tokens, key parameters and URL fragments ---

const REDACTED = "[redacted]";
const BEARER = /\bBearer\s+[^\s"',;]+/gi;
const SECRET_PARAM = /([?&](?:key|token)=)[^&\s#"']*/gi;
// Fragments carry share keys in invite links, so everything after the # goes.
const URL_FRAGMENT = /([a-z][a-z0-9+.-]*:\/\/[^\s#"']*)#\S*/gi;

export function removeSecretsFromText(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join(REDACTED);
  return out.replace(BEARER, `Bearer ${REDACTED}`).replace(SECRET_PARAM, `$1${REDACTED}`).replace(URL_FRAGMENT, `$1#${REDACTED}`);
}

/** Redacts every string in a JSON-like value; other values pass through. */
export function removeSecretsFromJson<T>(value: T, secrets: Iterable<string>): T {
  const list = [...secrets];
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return removeSecretsFromText(node, list);
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
    return node;
  };
  return walk(value) as T;
}

// --- File logger: stdout is reserved for frames, and every line passes the redaction step ---

/** A logger that can be told secrets (the socket token) to hide from every later line. */
export interface HelperLogger extends ILogger {
  redact(secret: string): void;
}

export function createHelperLogger(dataDir: string): HelperLogger {
  const logsDir = path.join(dataDir, "logs");
  const file = new FileLogSink(path.join(logsDir, "helper.log"), { privateDirs: [dataDir, logsDir] });
  const secrets = new Set<string>();
  const sink: LogSink = { append: (entry) => file.append(removeSecretsFromJson(entry, secrets)) };
  const logger = new Logger([sink], { onSinkError: () => undefined });
  return {
    log: (...args) => logger.log(...args),
    error: (...args) => logger.error(...args),
    redact: (secret) => { if (secret.length > 0) secrets.add(secret); },
  };
}
