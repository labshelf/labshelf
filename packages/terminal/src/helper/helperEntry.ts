// Composition root of LabShelf Helper, the native-messaging host the browser extension launches to build LaTeX projects and, under the labshelf-bridge name, to read the library folder; latexmk also starts it in `--biber` mode.
// CONTRACT: documents/contracts/helper.md#transport
import * as os from "node:os";
import { getAsset } from "node:sea";

import { runBridgeHost } from "@labshelf/core/bridge/node";
import {
  assertHelperPrivatePaths,
  BIBER_FLAG,
  createHelperLogger,
  resolveHelperDir,
  runHelperBiber,
  runHelperHost,
  BIBER_ASSET_FILES,
  parseBiberReleaseManifest,
  type BiberWasmAssets,
} from "@labshelf/core/helper/node";
import { HELPER_VERSION } from "@labshelf/core/helper";
import { createSystemNativeHostEnv } from "@labshelf/core/nativeHost/node";

import { registerStandaloneHosts, detectServedHost, uninstallStandaloneHelper, uninstallStandaloneHosts } from "./nativeHost/index.js";
import { createSelfUpdater } from "./release/index.js";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

// The SEA asset names `build/sea.mjs` packs biber's files under.
const asset = (file: string): string => `biber-wasm/${file}`;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Undefined when the executable was built without biber's WASM. */
function manifestAsset(): string | undefined {
  try {
    return getAsset(asset(BIBER_ASSET_FILES.manifest), "utf8");
  } catch {
    return undefined;
  }
}

// PLATFORM: emscripten reads its preloaded package from a file path in Node, so the asset is materialised once per content hash.
async function cachedDataFile(dataDir: string, expected: string): Promise<string> {
  const file = path.join(dataDir, "biber-wasm", `biber-${expected}.data`);
  const current = await fs.readFile(file).catch(() => undefined);
  if (current && sha256(current) === expected) { return file; }
  const bytes = new Uint8Array(getAsset(asset(BIBER_ASSET_FILES.data)));
  if (sha256(bytes) !== expected) { throw new Error(`The embedded ${BIBER_ASSET_FILES.data} does not match its manifest hash`); }
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const partial = `${file}.${process.pid}.partial`;
  await fs.writeFile(partial, bytes, { mode: 0o600 });
  await fs.rename(partial, file);
  return file;
}

function seaBiberAssets(dataDir: string): BiberWasmAssets | undefined {
  const text = manifestAsset();
  if (text === undefined) { return undefined; }
  const manifest = parseBiberReleaseManifest(text);
  const dataHash = manifest.files[BIBER_ASSET_FILES.data];
  return {
    manifest,
    factorySource: () => Promise.resolve(getAsset(asset(BIBER_ASSET_FILES.factory), "utf8")),
    // PLATFORM: getAsset returns a view of the executable's memory; slice copies it before the module takes it.
    wasm: () => Promise.resolve(new Uint8Array(getAsset(asset(BIBER_ASSET_FILES.wasm)).slice(0))),
    dataFile: () => {
      if (dataHash === undefined) { return Promise.reject(new Error(`The biber manifest has no hash for ${BIBER_ASSET_FILES.data}`)); }
      return cachedDataFile(dataDir, dataHash);
    },
  };
}

// The SEA asset name `build/sea.mjs` packs the compiler WASM under.
const TYPST_WASM_ASSET = "typst_ts_web_compiler_bg.wasm";
const MANAGEMENT_FLAGS = ["--register", "--unregister", "--uninstall"];

async function main(): Promise<number | undefined> {
  const dataDir = resolveHelperDir(process.env, process.platform, os.homedir());
  const flag = process.argv[2];
  const biberAssets = seaBiberAssets(dataDir);
  // latexmk starts this mode as its `$biber` during a build; it speaks no Native Messaging.
  if (flag === BIBER_FLAG) {
    if (!biberAssets) { throw new Error(`${BIBER_FLAG} needs an executable built with biber's WASM`); }
    return runHelperBiber(process.argv.slice(3), biberAssets);
  }
  // PLATFORM: process.execPath resolves the labshelf-bridge symlink to the helper binary; argv0 keeps the name the browser used.
  const host = detectServedHost(process.argv0, process.argv.slice(2));
  const managing = host === "helper" && MANAGEMENT_FLAGS.includes(flag ?? "");
  if (!managing) {
    // INVARIANT: this runs before the logger exists, because the logger's first write would chmod the data folder this check refuses.
    await assertHelperPrivatePaths({ binaryPath: process.execPath, dataDir });
  }
  if (host === "bridge") {
    await runBridgeHost();
    return undefined;
  }
  const logger = createHelperLogger(dataDir);
  if (managing) {
    const env = createSystemNativeHostEnv(logger);
    if (flag === "--register") return registerStandaloneHosts(env, process.execPath);
    if (flag === "--unregister") return uninstallStandaloneHosts(env, process.execPath);
    return uninstallStandaloneHelper(env, process.execPath, dataDir);
  }
  const updater = createSelfUpdater({
    currentVersion: HELPER_VERSION, platform: process.platform, arch: process.arch, binaryPath: process.execPath,
    dataDir, fetchImpl: fetch, now: Date.now, logger,
  });
  await updater.cleanupAfterRestart();
  // The update runs after ready and is throttled to once a day, except after a version refusal; a replaced binary takes effect on the next launch.
  await runHelperHost({ dataDir, logger, helperVersion: HELPER_VERSION, host: "helper", args: process.argv.slice(2),
    // PLATFORM: getAsset returns a view of the executable's memory; slice copies it before the compiler takes it.
    typstWasm: async () => new Uint8Array(getAsset(TYPST_WASM_ASSET).slice(0)),
    ...(biberAssets && { biber: [process.execPath] }),
    afterHello: () => updater.checkInBackground(),
    afterVersionRejected: async () => { await updater.check({ bypassThrottle: true }); } });
  return undefined;
}

main().then(
  (code) => { process.exitCode = code ?? 0; },
  (error: unknown) => {
    // PLATFORM: stdout carries the Native Messaging frames, so failures go to stderr only.
    process.stderr.write(`labshelf helper failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  },
);
