// Describes one running Tinymist server of a project and names the module its log lines carry.
import type { TinymistProcess } from "../tinymistProcess.js";

export const MODULE = "helper/lsp";

export interface Server { process: TinymistProcess; rootDir: string; opened: Set<string> }
