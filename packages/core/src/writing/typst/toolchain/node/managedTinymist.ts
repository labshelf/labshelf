// Resolves Tinymist (managed pinned binary, then PATH) and installs the pinned binary under the folder's lock.
// CONTRACT: documents/contracts/managed-tools.md#tinymist
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ILogger } from "../../../../ports/index.js";
import { findExecutable, sharedToolsRoot, withToolLock } from "../../../latex/toolchain/node/index.js";
import { tinymistAsset } from "../index.js";

import { installTinymist, TINYMIST_MODULE } from "./installTinymist.js";

export type TinymistProgress = (p: { message: string; fraction?: number }) => void;

export interface ManagedTinymistDeps {
  logger: ILogger;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  /** The shared tools folder; Tinymist lives in its `tinymist/` subfolder. Defaults to sharedToolsRoot. */
  root?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ManagedTinymist {
  /** The managed pinned binary, else `tinymist` on PATH, else undefined; never downloads. */
  resolve(): Promise<string | undefined>;
  /** Installs the pinned binary when it is missing, then resolves; throws TinymistInstallError. */
  ensure(onProgress?: TinymistProgress): Promise<string>;
}

export class TinymistInstallError extends Error {
  constructor(message: string, readonly context: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TinymistInstallError";
  }
}

async function executable(file: string): Promise<boolean> {
  return access(file, constants.X_OK).then(() => true, () => false);
}

export function createManagedTinymist(deps: ManagedTinymistDeps): ManagedTinymist {
  const { logger, platform = process.platform, arch = process.arch, env = process.env } = deps;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const folder = join(deps.root ?? sharedToolsRoot(env, platform, homedir()), "tinymist");
  const asset = tinymistAsset(platform, arch);
  const managed = asset ? join(folder, asset.version, asset.binaryName) : undefined;
  const findManaged = async () => (managed && (await executable(managed)) ? managed : undefined);
  const resolve = async () => (await findManaged()) ?? (await findExecutable("tinymist", env));

  async function install(onProgress: TinymistProgress): Promise<string> {
    if (!asset) {
      const onPath = await findExecutable("tinymist", env);
      if (onPath) { return onPath; }
      throw new TinymistInstallError(`No managed Tinymist exists for ${platform}-${arch} and tinymist is not on PATH`, { platform, arch });
    }
    const context = { version: asset.version, url: asset.url, folder };
    try {
      return await withToolLock(folder, `install Tinymist ${asset.version}`, logger, async () =>
        // INVARIANT: another app may have installed it while this one waited for the lock.
        (await findManaged()) ?? installTinymist({ folder, asset, fetchImpl, logger, onProgress }));
    } catch (error) {
      await logger.error(TINYMIST_MODULE, error, { step: "install Tinymist", ...context });
      const reason = error instanceof Error ? error.message : String(error);
      throw new TinymistInstallError(`Installing Tinymist ${asset.version} from ${asset.url} failed: ${reason}`, context, { cause: error });
    }
  }

  return {
    resolve,
    async ensure(onProgress = () => undefined) {
      const found = await findManaged();
      if (found) { return found; }
      const binary = await install(onProgress);
      await logger.log("INFO", TINYMIST_MODULE, "Tinymist is ready", { binary });
      return binary;
    },
  };
}
