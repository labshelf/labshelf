// Declares everything the extension needs from its host runtime, so activation code never touches Node directly.
import type { ILogger, LibraryLayout, OpenAiStorage, PathOps, PdfDocumentOpener, PdfTextLayerBuilder, PdfOcrEngine, ProjectDataPort, SidecarPort } from "@labshelf/core";
import type { PdfjsLocator } from "../../pdf-viewer/index.js";
import type { SharedLibraryConfig } from "../../storage/paths/index.js";

/** OCR (absent when the user turned it off) and the step that gives scans a text layer. */
interface PdfTextServices {
  ocr: PdfOcrEngine | undefined;
  textLayerBuilder: PdfTextLayerBuilder;
}

export interface HostAdapters {
  paths: PathOps;
  /** A logger that writes the library's rotating app.log. */
  createLogger(appLogPath: string): ILogger;
  pdfOpener: PdfDocumentOpener;
  createPdfTextServices(logger: ILogger): PdfTextServices;
  createSidecarPort(layout: Pick<LibraryLayout<string>, "paperDataPath" | "tmpDir">, logger: ILogger): SidecarPort;
  openAiStorage: OpenAiStorage;
  /** Project data over the library's writing projects; the logger is the open library's, which changes with it. */
  createProjectData(logger: ILogger): ProjectDataPort;
  sharedLibraryConfig: SharedLibraryConfig;
  reader: {
    locatePdfjs: PdfjsLocator;
    isMac: boolean;
  };
}
