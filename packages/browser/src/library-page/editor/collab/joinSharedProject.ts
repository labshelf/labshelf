// Joins a shared project from a pasted invite: connects over its relay, creates the project folder and mirrors the files into it.
import {
  assertInviteHasRelay, indexSettings, joinShare, parseInvite, posixPathOps, readIndexKind,
  type ILogger, type LibraryFileSystem, type ProjectFolderRegistry, type ShareSession,
} from "@labshelf/core";
import { startDocFileWriter } from "./docFileWriter";
import { connectShare, type ConnectShareOptions, type ShareConnection } from "./shareConnection";
import { saveShare } from "./shareKeyStore";

const LOG_MODULE = "collab.join";
const JOIN_TIMEOUT_MS = 30_000;

/** The share is of a kind this version cannot open, so nothing is created for it. */
export class UnknownShareKindError extends Error {
  constructor(readonly kind: unknown) {
    super(`The share is a ${String(kind)}, which this version of LabShelf cannot open. Update LabShelf and join again.`);
    this.name = "UnknownShareKindError";
  }
}

export interface JoinSharedProjectOptions extends Pick<ConnectShareOptions, "createTransport"> {
  inviteText: string;
  fs: LibraryFileSystem;
  logger: ILogger;
}

export interface JoinedSharedProject {
  projectId: string;
  folder: string;
  /** Closing it also writes the files still pending. */
  connection: ShareConnection;
}

// The browser library keeps every project inside the library, so it has no outside folders to register.
const noOutsideFolders: ProjectFolderRegistry = { folders: async () => [], register: async () => undefined, unregister: async () => undefined };

/** Resolves once the index names its kind and holds the shared settings, which is what joinShare reads. */
function waitForProjectIndex(session: ShareSession): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (error?: Error): void => {
      clearTimeout(timer);
      session.index.off("update", check);
      if (error) { reject(error); } else { resolve(); }
    };
    const check = (): void => {
      const kind = readIndexKind(session.index);
      if (!kind.ok && kind.error === "unknownShareKind") { settle(new UnknownShareKindError(kind.kind)); return; }
      if (kind.ok && indexSettings(session.index).size > 0) { settle(); }
    };
    const timer = setTimeout(() => settle(new Error(`No member of the share answered within ${JOIN_TIMEOUT_MS / 1000} s`)), JOIN_TIMEOUT_MS);
    session.index.on("update", check);
    check();
  });
}

export async function joinSharedProject({ inviteText, fs, logger, createTransport }: JoinSharedProjectOptions): Promise<JoinedSharedProject> {
  const parsed = await parseInvite(inviteText);
  if (!parsed.ok) { throw new Error(`The text holds no valid invite: ${parsed.error}`); }
  const { invite } = parsed;
  assertInviteHasRelay(invite);
  const connection = await connectShare({ invite, logger, createTransport });
  const { session } = connection;
  try {
    await waitForProjectIndex(session);
    const context = { fs, paths: posixPathOps, logger, registry: noOutsideFolders };
    const { id, folder } = await joinShare(context, { libraryRoot: "", shareId: invite.shareId, index: session.index });
    const writer = startDocFileWriter({ session, fs, folder, logger });
    await saveShare(invite.shareId, invite.shareKey, invite.relays);
    await logger.log("INFO", LOG_MODULE, "Joined a shared project", { shareId: invite.shareId, folder });
    return { projectId: id, folder, connection: { ...connection, close: async () => { await writer.close(); await connection.close(); } } };
  } catch (error) {
    await logger.error(LOG_MODULE, error, { action: "join shared project", shareId: invite.shareId });
    await connection.close();
    throw error;
  }
}
