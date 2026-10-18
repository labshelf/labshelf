// Relays one server message to the page, dropping what names files outside the project.
import type { ILogger } from "../../../../../ports/index.js";
import { PROTOCOL_VERSION } from "../../../index.js";
import type { HelperSend } from "../../dispatch/index.js";
import { fileUrisToPage } from "../uriMapping.js";
import { MODULE } from "./server.js";

const SERVER_EDIT = "workspace/applyEdit";
const SERVER_CONFIGURATION = "workspace/configuration";

const isNotification = (message: unknown): boolean => {
  const { method, id } = message as { method?: unknown; id?: unknown };
  return typeof method === "string" && id === undefined;
};

export interface ServerMessage {
  logger: ILogger;
  projectId: string;
  rootDir: string;
  message: unknown;
  /** Writes an answer back to the server. */
  reply(message: unknown): void;
  toPage: HelperSend | undefined;
}

export function relayFromServer({ logger, projectId, rootDir, message, reply, toPage }: ServerMessage): void {
  const { method, id, params } = message as { method?: unknown; id?: unknown; params?: { items?: unknown } };
  if (method === SERVER_CONFIGURATION && id !== undefined) {
    // The helper answers, so the page cannot inject Tinymist settings such as `rootPath` or `typstExtraArgs`.
    const items = Array.isArray(params?.items) ? params.items.length : 0;
    reply({ jsonrpc: "2.0", id, result: Array.from({ length: items }, () => null) });
    return;
  }
  const { payload, outside } = fileUrisToPage(message, rootDir);
  if (outside.length > 0 && (message as { method?: unknown }).method === SERVER_EDIT) {
    // The page applies edits only to its own project; a partial edit would leave files half changed, so none applies.
    void logger.log("WARN", MODULE, "Server edit outside the project dropped", { projectId, count: outside.length });
    const id = (message as { id?: unknown }).id;
    if (id !== undefined) { reply({ jsonrpc: "2.0", id, result: { applied: false, failureReason: "The edit names files outside the project" } }); }
    return;
  }
  if (outside.length > 0) {
    void logger.log("WARN", MODULE, "Server named files outside the project", { projectId, count: outside.length, notification: isNotification(message) });
    if (isNotification(message)) { return; }
  }
  toPage?.({ v: PROTOCOL_VERSION, type: "lsp", projectId, payload: payload as Record<string, unknown> });
}
