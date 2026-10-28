// Connects shared projects on the desktop: the shares connected in this window, the core share connection over this library's state dir, folder and Node disk mirror, the invite keys in SecretStorage and the deletion of a share's state.
import { promises as fs, watch } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import {
  connectShare,
  createShareRegistry,
  describeContentConflict,
  createLeasedMirrorFactory,
  formatInvite,
  parseInvite,
  readConflictDismissals,
  type ILogger,
  type InviteRelay,
  type MirrorFactory,
  type MirrorFileSystem,
  type ShareConnection,
  type ShareConnections,
  type ShareKeyStore,
  type OpenShareRegistry,
  type ShareStart,
  type StoredInvite,
} from "@labshelf/core";
import {
  createNodeCollabStorage,
  createNodeProjectCatalogCompositionRoot,
  resolveConflictDismissalFile,
  createDeviceIdentity,
  createDeviceLocalLayout,
  mergeText,
  NodeLibraryFileSystem,
  createNodeMirrorFileSystem,
} from "@labshelf/core/node";

// CONTRACT: documents/contracts/collaboration.md#device-local-state
const deriveShareDir = (libraryRoot: string, shareId: string): string => path.join(createDeviceLocalLayout(libraryRoot).collabDir, shareId);

export async function removeShareDir(libraryRoot: string, shareId: string): Promise<void> {
  await fs.rm(deriveShareDir(libraryRoot, shareId), { recursive: true, force: true });
}

export function watchConflictDismissals(
  disk: MirrorFileSystem, file: string, candidates: ReadonlySet<string>, logger: ILogger,
): MirrorFileSystem {
  return { ...disk, watch: (onChange) => {
    const watcher = watch(path.dirname(file), (_event, name) => {
      if (name === null || name.toString() === path.basename(file)) candidates.forEach(onChange);
    });
    watcher.on('error', error => { void logger.error('collab.conflicts', error, { file }); });
    try {
      const stop = disk.watch?.(onChange);
      return () => { watcher.close(); stop?.(); };
    } catch (error) {
      watcher.close();
      throw error;
    }
  } };
}

export function createDesktopMirrorFactory(libraryRoot: string, logger: ILogger, isEditorOwned: (folder: string, path: string) => boolean): MirrorFactory {
  const candidates = new Map<string, Set<string>>();
  const held = (folder: string): Set<string> => {
    if (!candidates.has(folder)) candidates.set(folder, new Set());
    return candidates.get(folder)!;
  };
  return createLeasedMirrorFactory({
    identity: createDeviceIdentity(createDeviceLocalLayout(libraryRoot), logger),
    fs: new NodeLibraryFileSystem(), app: "vscode", logger, mergeText,
    disk: (folder) => watchConflictDismissals(createNodeMirrorFileSystem(folder, logger), resolveConflictDismissalFile(libraryRoot), held(folder), logger), isEditorOwned,
    readConflictDismissals: () => readConflictDismissals(new NodeLibraryFileSystem(), resolveConflictDismissalFile(libraryRoot)),
    onConflictCopy: (folder, copy) => {
      held(folder).add(path.relative(folder, copy.copy).split(path.sep).join('/'));
      void vscode.window.showInformationMessage(describeContentConflict(copy), "Resolve").then((choice) => {
        if (choice === "Resolve") { void vscode.commands.executeCommand("labshelf.resolveConflicts"); }
      });
    },
  });
}

interface ConnectOptions {
  libraryRoot: string;
  shareId: string;
  shareKey: Uint8Array;
  /** The invite's relays, tried while the index lists none. */
  relays: readonly InviteRelay[];
  /** This user's name in the presence peers see. */
  name: string;
  logger: ILogger;
  /** True for a path of the folder an open editor holds. */
  isEditorOwned(folder: string, path: string): boolean;
}

export function connectDesktopShare(options: ConnectOptions, start: ShareStart): Promise<ShareConnection> {
  const { libraryRoot, shareId, shareKey, relays, name, logger } = options;
  return connectShare({
    shareId, shareKey, relays, name, logger,
    storage: createNodeCollabStorage({ dir: deriveShareDir(libraryRoot, shareId), shareId }),
    projects: { context: createNodeProjectCatalogCompositionRoot(logger), libraryRoot },
    startMirror: createDesktopMirrorFactory(libraryRoot, logger, (folder, path) => options.isEditorOwned(folder, path)),
  }, start);
}

/** What else runs while a share is connected, such as the editor binding; disposed when it closes. */
type OnOpen = (share: ShareConnection) => vscode.Disposable;

interface OpenShare { share: ShareConnection; attached: vscode.Disposable }

export class ActiveShares implements ShareConnections, vscode.Disposable {
  private readonly registry: OpenShareRegistry<OpenShare> = createShareRegistry<OpenShare>({
    connectionOf: ({ share }) => share,
    close: ({ share }) => share.close(),
    onRelease: ({ attached }) => attached.dispose(),
  });

  constructor(private readonly onOpen: OnOpen) {}

  readonly onDidChange = (listener: () => void): vscode.Disposable => new vscode.Disposable(this.registry.onChange(listener));

  list(): ShareConnection[] { return this.registry.list(); }

  active(shareId: string): ShareConnection | undefined { return this.registry.active(shareId); }

  /** True while a share, join or leave of the share runs; the project list then lags behind and must not be acted on. */
  isBusy(shareId: string): boolean { return this.registry.isBusy(shareId); }

  hold<T>(shareId: string, task: () => Promise<T>): Promise<T> { return this.registry.hold(shareId, task); }

  add(share: ShareConnection): void {
    const fire = () => this.registry.notify();
    // The state covers the session status, the relay, storage health and the mirror.
    const stopState = share.onStateChange(fire);
    const stopPeers = share.session.onPeer(fire);
    const attached = vscode.Disposable.from(this.onOpen(share), { dispose: () => { stopState(); stopPeers(); } });
    this.registry.set(share.shareId, { share, attached });
    fire();
  }

  /** Disconnects the share; its files and stored state stay. Rejects when the close leaves an update unstored. */
  remove(shareId: string): Promise<void> { return this.registry.remove(shareId); }

  dispose(): void {
    this.registry.list().forEach(({ shareId }) => void this.remove(shareId));
    this.registry.clearListeners();
  }
}

const secretName = (shareId: string): string => `labshelf.collab.invite.${shareId}`;

/** Stores each share as its invite link, which holds the share key and the relays. */
export class ShareKeys implements ShareKeyStore {
  constructor(private readonly secrets: vscode.SecretStorage, private readonly logger: ILogger) {}

  async remember({ shareId, shareKey, relays }: StoredInvite): Promise<void> {
    await this.secrets.store(secretName(shareId), await formatInvite({ shareKey, relays }));
  }

  async invite(shareId: string): Promise<StoredInvite | undefined> {
    const link = await this.secrets.get(secretName(shareId));
    if (!link) { return undefined; }
    const parsed = await parseInvite(link);
    if (parsed.ok && parsed.invite.shareId === shareId) { return parsed.invite; }
    void this.logger.log("WARN", "collab", "Dropped a stored invite that does not parse", { shareId, error: parsed.ok ? "otherShare" : parsed.error });
    await this.forget(shareId);
    return undefined;
  }

  async forget(shareId: string): Promise<void> {
    await this.secrets.delete(secretName(shareId));
  }
}
