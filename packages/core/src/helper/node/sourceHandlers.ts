// Answers the socket's linked-output source messages: sourcePick opens the system folder dialog, sourceInspect tells whether a folder exists
// and its git remote, sourceList and sourceRead list and read its files (confined to it), sourceRun runs its command and cancelSourceRun aborts a run.
// CONTRACT: documents/contracts/helper.md#messages
import { promises as fs } from "node:fs";

import { formatError } from "../../errors/index.js";
import type { ILogger } from "../../ports/index.js";
import { listSourceFolder, pickFolderNative, readGitRemote, readSourceFile, runSourceCommand } from "../../writing/outputLinks/node/index.js";
import { MAX_SOCKET_MESSAGE_BYTES, MAX_SOURCE_OUTPUT_CHARS, PROTOCOL_VERSION, type ToHelperMessage } from "../helperMessages.js";
import { checkHelperPath } from "../helperPaths.js";
import type { HelperHandler, HelperSend } from "./helperHandlers.js";

const MODULE = "helper-sources";
const NO_FOLDER = "The source folder does not exist on this machine.";

type SourceType = "sourcePick" | "sourceInspect" | "sourceList" | "sourceRead" | "sourceRun" | "cancelSourceRun";

export interface SourceHandlerDeps {
  logger: ILogger;
  /** Replaces the system folder dialog; undefined when cancelled, throws "no folder dialog" when there is none. */
  pickFolder?: () => Promise<string | undefined>;
}

const isDirectory = async (folder: string): Promise<boolean> => (await fs.stat(folder).catch(() => undefined))?.isDirectory() ?? false;

const refuse = (send: HelperSend, id: string, code: string, message: string) => send({ v: PROTOCOL_VERSION, id, type: "error", code, message });

function expect<T extends SourceType>(message: ToHelperMessage, type: T): Extract<ToHelperMessage, { type: T }> {
  if (message.type !== type) { throw new Error(`${type} handler received ${message.type}`); }
  return message as Extract<ToHelperMessage, { type: T }>;
}

/** Runs `answer` when the folder is a directory, else refuses with a `path` error. */
async function inFolder(id: string, folder: string, send: HelperSend, answer: () => Promise<void>): Promise<void> {
  if (!(await isDirectory(folder))) { refuse(send, id, "path", NO_FOLDER); return; }
  await answer();
}

const createSourcePick = ({ logger, pickFolder }: Required<SourceHandlerDeps>): HelperHandler => async (message, send) => {
  const { id } = expect(message, "sourcePick");
  try {
    const folder = await pickFolder();
    send({ v: PROTOCOL_VERSION, id, type: "sourcePicked", ...(folder === undefined ? {} : { folder }) });
  } catch (error) {
    void logger.log("WARN", MODULE, "No folder dialog on this machine", { reason: formatError(error) });
    send({ v: PROTOCOL_VERSION, id, type: "sourcePicked", unavailable: true });
  }
};

const sourceInspect: HelperHandler = async (message, send) => {
  const { id, folder } = expect(message, "sourceInspect");
  if (!(await isDirectory(folder))) { send({ v: PROTOCOL_VERSION, id, type: "sourceInfo", exists: false }); return; }
  const remote = await readGitRemote(folder).catch(() => undefined);
  send({ v: PROTOCOL_VERSION, id, type: "sourceInfo", exists: true, ...(remote === undefined ? {} : { remote }) });
};

const sourceList: HelperHandler = async (message, send) => {
  const { id, folder } = expect(message, "sourceList");
  await inFolder(id, folder, send, async () => {
    // A path the page would refuse (too long, odd characters) is left out rather than failing the whole list.
    const files = (await listSourceFolder(folder)).filter((file) => checkHelperPath(file) === undefined);
    send({ v: PROTOCOL_VERSION, id, type: "sourceFiles", files });
  });
};

const createSourceRead = (logger: ILogger): HelperHandler => async (message, send) => {
  const { id, folder, path } = expect(message, "sourceRead");
  await inFolder(id, folder, send, async () => {
    let bytes: Uint8Array | undefined;
    try {
      bytes = await readSourceFile(folder, path);
    } catch (error) {
      void logger.log("WARN", MODULE, "Source read refused", { reason: formatError(error) });
      refuse(send, id, "path", formatError(error));
      return;
    }
    if (bytes === undefined) { send({ v: PROTOCOL_VERSION, id, type: "sourceBytes", bytes: 0, missing: true }); return; }
    if (bytes.length > MAX_SOCKET_MESSAGE_BYTES) { refuse(send, id, "limit", "The file is too large to read through LabShelf Helper."); return; }
    send({ v: PROTOCOL_VERSION, id, type: "sourceBytes", bytes: bytes.length }, bytes);
  });
};

// INVARIANT: the controller is registered before any await, because the dispatcher runs a cancelSourceRun without waiting for this run.
const createSourceRun = (logger: ILogger, running: Map<string, AbortController>): HelperHandler => async (message, send) => {
  const { id, folder, command, timeoutMs } = expect(message, "sourceRun");
  const controller = new AbortController();
  running.set(id, controller);
  try {
    await inFolder(id, folder, send, async () => {
      void logger.log("INFO", MODULE, "Running a source command", { id });
      const result = await runSourceCommand({ folder, command, signal: controller.signal, timeoutMs });
      if (result.status === "cancelled" || controller.signal.aborted) { send({ v: PROTOCOL_VERSION, id, type: "sourceRan", status: "cancelled" }); return; }
      send({ v: PROTOCOL_VERSION, id, type: "sourceRan", status: "finished", code: result.code, output: result.output.slice(-MAX_SOURCE_OUTPUT_CHARS) });
    });
  } finally {
    running.delete(id);
  }
};

/** The six source handlers over one map of running commands. */
export function createSourceHandlers(deps: SourceHandlerDeps): Record<SourceType, HelperHandler> {
  const { logger } = deps;
  const running = new Map<string, AbortController>();
  const cancelSourceRun: HelperHandler = (message) => {
    running.get(expect(message, "cancelSourceRun").requestId)?.abort();
    return Promise.resolve();
  };
  return {
    sourcePick: createSourcePick({ logger, pickFolder: deps.pickFolder ?? (() => pickFolderNative()) }),
    sourceInspect, sourceList, cancelSourceRun,
    sourceRead: createSourceRead(logger),
    sourceRun: createSourceRun(logger, running),
  };
}
