// Answers core's TeX setup questions for one page build: it never installs TeX and reports package installs as progress.
import type { TexSetupAsk } from "../../../writing/build/index.js";
import { PROTOCOL_VERSION } from "../../index.js";

import type { HelperSend } from "../handlers/index.js";

/** The page shows its own TeX setup on `toolchain-missing`, so the helper declines the install. */
export function createHelperToolchainAsk(id: string, send: HelperSend): TexSetupAsk {
  const report = (message: string): void => send({ v: PROTOCOL_VERSION, id, type: "progress", phase: "installing-package", message });
  return {
    chooseInstall: () => Promise.resolve(undefined),
    progress: (title, run) => {
      report(title);
      return run((message) => { if (message) { report(`${title}: ${message}`); } });
    },
  };
}
