// Declares everything the extension needs from its host runtime, so activation code never touches Node directly.
import type {
  ConflictCopy, ConflictResolution, ILogger, LibraryFileSystem, LibraryLayout, OpenAiStorage, PathOps, PdfOpener, PdfjsLoader,
  PdfTextLayerBuilder, PdfOcrEngine, ProjectContentPort, ProjectDeviceDirs, ProjectSaveTracking, SidecarPort,
} from "@labshelf/core";
import type { PdfjsLocator } from "../reader/index.js";
import type { UriOfPath } from "../storage/index.js";
import type { SharedLibraryConfig } from "../storage/paths/index.js";
import type { ConvertDocument } from "../writing/index.js";

/** OCR (absent when the user turned it off) and the step that gives scans a text layer. */
interface PdfTextServices {
  ocr: PdfOcrEngine | undefined;
  textLayerBuilder: PdfTextLayerBuilder;
}

/** The per-device places of one library that the extension writes outside the library folder. */
export type HostDeviceLayout = ProjectDeviceDirs & {
  readonly appLogPath: string;
  readonly aiDatabasePath: string;
  readonly openAlexCacheDir: string;
};

export interface HostAdapters {
  paths: PathOps;
  /** The disk the library and the writing projects live on. */
  fs: LibraryFileSystem;
  /** The URI the VS Code file system opens for a path. */
  uriOf: UriOfPath;
  /** A logger that writes the library's rotating app.log. */
  createLogger(appLogPath: string): ILogger;
  pdfOpener: PdfOpener;
  /** The extension host's one pdf.js. */
  pdfjs: PdfjsLoader;
  createPdfTextServices(logger: ILogger): PdfTextServices;
  createSidecarPort(layout: Pick<LibraryLayout<string>, "paperDataPath" | "tmpDir">, logger: ILogger): SidecarPort;
  openAiStorage: OpenAiStorage;
  deviceLayout(root: string): HostDeviceLayout;
  /** Project data over the library's writing projects; logger and dirs are the open library's, which change with it. */
  createProjectSaveTracking(root: () => string | undefined, logger: ILogger): ProjectSaveTracking;
  createProjectData(logger: ILogger, deviceDirs: ProjectDeviceDirs, fs: LibraryFileSystem): ProjectContentPort;
  /** Lists the unresolved conflict copies a sync tool left in the library, merging against this device's bases. */
  scanLibraryConflicts(root: string, logger: ILogger): Promise<ConflictCopy[]>;
  resolveConflictCopy(copy: ConflictCopy, resolution: ConflictResolution, logger: ILogger, root: string): Promise<void>;
  /** Absent where documents cannot be converted (no pandoc on the web). */
  convertDocument?: ConvertDocument;
  sharedLibraryConfig: SharedLibraryConfig;
  reader: {
    locatePdfjs: PdfjsLocator;
    isMac: boolean;
  };
}
