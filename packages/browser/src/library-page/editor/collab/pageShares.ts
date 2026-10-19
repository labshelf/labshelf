// Holds the page's one live connection per shared project: opens it on join or after a reload, and hands the editor its session, presence and comments.
import type { ILogger, LibraryFileSystem } from "@labshelf/core";
import type { CommentThreads } from "../../review";
import { startDocFileWriter } from "./docFileWriter";
import { joinSharedProject, type JoinedSharedProject, type JoinSharedProjectOptions } from "./joinSharedProject";
import { createLiveCommentThreads } from "./liveCommentThreads";
import { connectShare, type ShareConnection } from "./shareConnection";
import { loadDisplayName, loadShare, saveDisplayName } from "./shareKeyStore";

const LOG_MODULE = "collab.shares";
const DEFAULT_NAME = "Guest";

export interface ActiveShare extends Pick<ShareConnection, "session" | "presence"> {
  comments: CommentThreads;
}

export interface PageShares {
  join(inviteText: string): Promise<Pick<JoinedSharedProject, "projectId" | "folder">>;
  /** Reconnects a project joined earlier from its stored key and relays; a second call for a connected project does nothing. */
  connect(projectId: string, shareId: string, folder: string): Promise<void>;
  active(projectId: string): ActiveShare | undefined;
  /** The name on this user's comments and cursor. */
  name(): string;
  setName(name: string): Promise<void>;
  /** Called whenever a project's connection opens or closes. */
  onChange(listener: () => void): () => void;
  closeAll(): Promise<void>;
}

export interface PageSharesOptions extends Pick<JoinSharedProjectOptions, "createTransport"> {
  fs: LibraryFileSystem;
  logger: ILogger;
}

interface Entry { connection: ShareConnection; comments: CommentThreads }

export function createPageShares({ fs, logger, createTransport }: PageSharesOptions): PageShares {
  const entries = new Map<string, Entry>();
  const connecting = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  let displayName = DEFAULT_NAME;
  void loadDisplayName().then((stored) => { if (stored !== undefined && stored !== "") { displayName = stored; } }, (error: unknown) => logger.error(LOG_MODULE, error, { action: "read display name" }));
  const notify = (): void => listeners.forEach((listener) => listener());

  const keep = async (projectId: string, connection: ShareConnection): Promise<void> => {
    await entries.get(projectId)?.connection.close();
    const comments = createLiveCommentThreads({ session: connection.session, projectId, author: () => displayName, logger });
    entries.set(projectId, { connection, comments });
    notify();
  };

  const open = async (projectId: string, shareId: string, folder: string): Promise<void> => {
    const stored = await loadShare(shareId);
    if (stored === undefined) { throw new Error(`The key of share ${shareId} is not stored on this device, so project ${projectId} cannot reconnect`); }
    const connection = await connectShare({ invite: { shareId, ...stored }, logger, createTransport });
    const writer = startDocFileWriter({ session: connection.session, fs, folder, logger });
    await keep(projectId, { ...connection, close: async () => { await writer.close(); await connection.close(); } });
  };

  return {
    async join(inviteText) {
      const { projectId, folder, connection } = await joinSharedProject({ inviteText, fs, logger, createTransport });
      await keep(projectId, connection);
      return { projectId, folder };
    },
    connect(projectId, shareId, folder) {
      if (entries.has(projectId)) { return Promise.resolve(); }
      const pending = connecting.get(projectId) ?? open(projectId, shareId, folder).finally(() => connecting.delete(projectId));
      connecting.set(projectId, pending);
      return pending;
    },
    active(projectId) {
      const entry = entries.get(projectId);
      return entry && { session: entry.connection.session, presence: entry.connection.presence, comments: entry.comments };
    },
    name: () => displayName,
    async setName(name) { displayName = name; await saveDisplayName(name); },
    onChange(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async closeAll() {
      const closing = [...entries.values()];
      entries.clear();
      await Promise.all(closing.map(({ connection }) => connection.close()));
      notify();
    },
  };
}
