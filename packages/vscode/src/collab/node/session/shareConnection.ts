// Connects a shared project on the desktop: the core share connection over this library's state dir, folder and Node disk mirror.
import { connectShare, type ILogger, type InviteRelay, type ShareConnection, type ShareStart } from "@labshelf/core";
import { nodeCollabStorage, nodeProjectCatalogContext } from "@labshelf/core/node";
import { desktopMirrorFactory } from "./desktopMirror.js";
import { shareStateDir } from "./shareState.js";

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
    storage: nodeCollabStorage({ dir: shareStateDir(libraryRoot, shareId), shareId }),
    projects: { context: nodeProjectCatalogContext(logger), libraryRoot },
    startMirror: desktopMirrorFactory(logger, (folder, path) => options.isEditorOwned(folder, path)),
  }, start);
}
