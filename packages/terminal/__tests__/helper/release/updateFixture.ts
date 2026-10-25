// Builds a temp install dir, a signed release and a routed fetch for the self-update tests.
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ILogger } from "@labshelf/core";

import { LATEST_MANIFEST_URL } from "../../../src/helper/release";

export const NEW_BINARY = Buffer.from("new helper binary");
export const NOW = Date.UTC(2026, 9, 17, 12);
export const DAY_MS = 24 * 60 * 60 * 1000;
const ASSET_URL = "https://example.test/helper-darwin-arm64";

export interface UpdateFixture {
  root: string;
  binaryPath: string;
  dataDir: string;
  publicKey: string;
  logger: { log: jest.Mock; error: jest.Mock };
  fetchImpl: jest.Mock;
  fetchedUrls: () => string[];
  /** Replaces what the fake release serves; unset fields keep their valid value. */
  serve: (release: { version?: string; sha256?: string; manifest?: Buffer; signature?: string }) => void;
  signValid: (bytes: Buffer) => string;
  signWithOtherKey: (bytes: Buffer) => string;
  binaryContent: () => Promise<string>;
  cleanup: () => Promise<void>;
}

function signBytes(bytes: Buffer, key: KeyObject): string {
  return sign(null, bytes, key).toString("base64");
}

function manifestBytes(version: string, sha256: string): Buffer {
  const assets = { "darwin-arm64": { url: ASSET_URL, sha256 }, "win32-x64": { url: ASSET_URL, sha256 } };
  return Buffer.from(JSON.stringify({ version, assets }));
}

export async function createUpdateFixture(): Promise<UpdateFixture> {
  const root = await mkdtemp(join(tmpdir(), "labshelf-update-"));
  const binaryPath = join(root, "labshelf-helper");
  await writeFile(binaryPath, "old helper binary");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519").privateKey;
  const routes = new Map<string, Buffer | string>();
  const urls: string[] = [];
  const serve: UpdateFixture["serve"] = (release) => {
    const manifest = release.manifest ?? manifestBytes(release.version ?? "2.0.0", release.sha256 ?? createHash("sha256").update(NEW_BINARY).digest("hex"));
    routes.set(LATEST_MANIFEST_URL, manifest);
    routes.set(`${LATEST_MANIFEST_URL}.sig`, release.signature ?? signBytes(manifest, privateKey));
    routes.set(ASSET_URL, NEW_BINARY);
  };
  serve({});
  const fetchImpl = jest.fn(async (url: string) => {
    urls.push(url);
    const body = routes.get(url);
    if (body === undefined) { return new Response("missing", { status: 404 }); }
    return new Response(typeof body === "string" ? body : new Uint8Array(body), { status: 200 });
  });
  return {
    root, binaryPath, dataDir: join(root, "data"),
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    logger: { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) },
    fetchImpl, fetchedUrls: () => urls, serve,
    signValid: (bytes) => signBytes(bytes, privateKey),
    signWithOtherKey: (bytes) => signBytes(bytes, other),
    binaryContent: () => readFile(binaryPath, "utf8"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export function asLogger(logger: UpdateFixture["logger"]): ILogger {
  return logger as unknown as ILogger;
}
