// Creates the `installTex` and `installAllPackages` handlers that stream install progress and end with `ready` or `error`.
// CONTRACT: documents/contracts/helper.md#messages
import type { ILogger } from "../../ports/index.js";
import { PROTOCOL_VERSION, type HelperHost, type ProgressPhase, type TexToolchain } from "../index.js";

import type { HelperHandler, HelperSend } from "./handlers/index.js";
import { TEX_MODULE, TexInstallError, type ManagedTexProvider, type TexProgress } from "../../latex/toolchain/node/managedTex/index.js";
import { formatError } from "../../logging/index.js";

export interface TexInstallHandlerOptions {
  tex: ManagedTexProvider;
  /** Carried by every `ready`, which the contract requires to be non-empty. */
  helperVersion: string;
  host: HelperHost;
  logger: ILogger;
}

type InstallPhase = Extract<ProgressPhase, "installing-tex" | "installing-package">;

const MESSAGES: Record<InstallPhase, string> = {
  "installing-tex": "Installing TeX",
  "installing-package": "Installing every TeX package",
};

async function runInstall(
  options: TexInstallHandlerOptions, id: string, phase: InstallPhase, send: HelperSend,
  install: (onProgress: TexProgress) => Promise<TexToolchain>,
): Promise<void> {
  const onProgress: TexProgress = (fraction) =>
    send({ v: PROTOCOL_VERSION, id, type: "progress", phase, message: MESSAGES[phase], ...(fraction === null ? {} : { fraction }) });
  try {
    const tex = await install(onProgress);
    send({ v: PROTOCOL_VERSION, id, type: "ready", protocol: PROTOCOL_VERSION, helperVersion: options.helperVersion, host: options.host, tex });
  } catch (error) {
    await options.logger.error(TEX_MODULE, error, { step: phase, id });
    const message = formatError(error);
    const code = error instanceof TexInstallError ? error.code : "tex-install-failed";
    send({ v: PROTOCOL_VERSION, id, type: "error", code, message });
  }
}

export function createTexInstallHandlers(options: TexInstallHandlerOptions): { installTex: HelperHandler; installAllPackages: HelperHandler } {
  const { tex } = options;
  const installTex: HelperHandler = async (message, send) => {
    if (message.type !== "installTex") { throw new Error(`installTex handler received ${message.type}`); }
    await runInstall(options, message.id, "installing-tex", send, (onProgress) => tex.install(message.kind, onProgress));
  };
  const installAllPackages: HelperHandler = async (message, send) => {
    if (message.type !== "installAllPackages") { throw new Error(`installAllPackages handler received ${message.type}`); }
    await runInstall(options, message.id, "installing-package", send, (onProgress) => tex.installAllPackages(onProgress));
  };
  return { installTex, installAllPackages };
}
