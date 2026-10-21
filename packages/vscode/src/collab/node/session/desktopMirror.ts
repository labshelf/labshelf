// Starts a desktop share's Node disk mirror only while this window holds the project folder's lease.
// CONTRACT: documents/contracts/collaboration.md#mirror-ownership
import { leasedMirrorFactory, type ILogger, type MirrorFactory } from "@labshelf/core";
import { mergeText, NodeLibraryFileSystem, nodeMirrorDisk } from "@labshelf/core/node";

export function desktopMirrorFactory(logger: ILogger, isEditorOwned: (folder: string, path: string) => boolean): MirrorFactory {
  return leasedMirrorFactory({
    fs: new NodeLibraryFileSystem(), app: "vscode", logger, mergeText, disk: (folder) => nodeMirrorDisk(folder, logger), isEditorOwned,
  });
}
