// Declares everything the extension needs from its host runtime, so activation code never touches Node directly.
import type {
  ConflictCopy, ILogger, LibraryFileSystem, LibraryLayout, OpenAiStorage, PathOps, PdfDocumentOpener, PdfTextLayerBuilder, PdfOcrEngine, ProjectDataPort,
  ProjectDeviceDirs, SidecarPort,
} from "@labshelf/core";
import type { PdfjsLocator } from "../../pdf-viewer/index.js";
import type { SharedLibraryConfig } from "../../storage/paths/index.js";

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
  /** A logger that writes the library's rotating app.log. */
  createLogger(appLogPath: string): ILogger;
  pdfOpener: PdfDocumentOpener;
  createPdfTextServices(logger: ILogger): PdfTextServices;
  createSidecarPort(layout: Pick<LibraryLayout<string>, "paperDataPath" | "tmpDir">, logger: ILogger): SidecarPort;
  openAiStorage: OpenAiStorage;
  deviceLayout(root: string): HostDeviceLayout;
  /** Project data over the library's writing projects; logger and dirs are the open library's, which change with it. */
  createProjectData(logger: ILogger, deviceDirs: ProjectDeviceDirs): ProjectDataPort;
  /** Lists the unresolved conflict copies a sync tool left in the library, merging against this device's bases. */
  scanLibraryConflicts(root: string, logger: ILogger): Promise<ConflictCopy[]>;
  sharedLibraryConfig: SharedLibraryConfig;
  reader: {
    locatePdfjs: PdfjsLocator;
    isMac: boolean;
  };
}
